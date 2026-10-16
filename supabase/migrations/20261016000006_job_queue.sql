-- 6: DB 기반 작업 큐 (jobs 테이블이 곧 outbox) + 목록 projection
-- 원칙(blueprint 10~11장): 웹 요청은 "접수(예약+작업 생성)"만 하고 외부 호출은 워커가 한다.
--  - 접수는 한 트랜잭션: 한도 확인 → 크레딧 예약 → job 생성. (예약만 남고 job이 없는 고아 상태 방지)
--  - 워커는 claim(임대) → 실행 → complete(정산+상태)를 한다. 같은 job을 두 워커가 동시에 잡지 못한다.
--  - 임대 만료된 job은 자동으로 다시 실행하지 않는다. 외부 제출 흔적이 있으면 provider_unknown(조회·대조 대상)으로 넘긴다.

alter table public.jobs alter column deliverable_id drop not null;
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('plan','image','video','render','analysis'));
alter table public.jobs
  add column payload jsonb not null default '{}',
  add column payload_hash text,
  add column stage text,
  add column attempts int not null default 0,
  add column max_attempts int not null default 2,
  add column next_run_at timestamptz not null default now(),
  add column lease_until timestamptz,
  add column locked_by text,
  add column last_error text,
  add column reservation_ref text,
  add column finished_at timestamptz;

drop index if exists public.jobs_queue_idx;
create index jobs_claim_idx on public.jobs(next_run_at, created_at) where status = 'queued';
create index jobs_lease_idx on public.jobs(lease_until) where status = 'running';
create index jobs_ws_active_idx on public.jobs(workspace_id, status) where status in ('queued','running','provider_unknown');
create index jobs_ws_recent_idx on public.jobs(workspace_id, created_at desc, id desc);

-- ---------------------------------------------------------------- 접수: 예약 + job 생성 (원자적, 멱등)
create or replace function private.enqueue_job(
  p_ws uuid, p_kind text, p_deliverable uuid, p_request_key text, p_payload jsonb, p_credits bigint)
returns table (job_id uuid, created boolean, status text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare j public.jobs; pend bigint; lim numeric; h text := md5(coalesce(p_payload::text, ''));
begin
  -- 같은 request_key: 같은 내용이면 기존 job 반환, 다른 내용이면 충돌
  select * into j from public.jobs where workspace_id = p_ws and request_key = p_request_key;
  if found then
    if j.payload_hash is distinct from h then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return query select j.id, false, j.status; return;
  end if;

  perform 1 from public.wallet_accounts where workspace_id = p_ws for update;     -- 잠금 순서: wallet 먼저 (reserve/settle과 동일)
  -- 위 잠금 이후 한 번 더 확인 (잠금 대기 중 다른 요청이 같은 키로 들어온 경우)
  select * into j from public.jobs where workspace_id = p_ws and request_key = p_request_key;
  if found then return query select j.id, false, j.status; return; end if;

  select (limits ->> 'pending_jobs')::numeric into lim from private.current_plan(p_ws);
  if lim is not null then
    select count(*) into pend from public.jobs where workspace_id = p_ws and status in ('queued','running','provider_unknown');
    if pend >= lim then raise exception 'too_many_pending' using errcode = 'P0001'; end if;
  end if;

  if p_credits > 0 then perform private.reserve_credits(p_ws, p_credits, 'job:' || p_request_key); end if;
  insert into public.jobs(workspace_id, deliverable_id, kind, status, request_key, estimated_credits, payload, payload_hash, reservation_ref)
  values (p_ws, p_deliverable, p_kind, 'queued', p_request_key, p_credits, p_payload, h,
          case when p_credits > 0 then 'job:' || p_request_key end)
  returning * into j;
  return query select j.id, true, j.status;
end $$;

-- ---------------------------------------------------------------- 워커: claim (임대, 동시성 상한, 공정 분배)
-- p_per_ws : 워크스페이스별 동시 실행 상한 기본값(플랜 concurrent_jobs가 있으면 그 값 사용)
-- p_global : 전체 동시 실행 상한 (공급사 쿼터 보호)
create or replace function private.claim_jobs(p_worker text, p_limit int, p_lease_seconds int default 300,
                                              p_per_ws int default 2, p_global int default 10, p_kinds text[] default null)
returns setof public.jobs language plpgsql security definer set search_path = '' as $$
declare running_total int; slots int;
begin
  perform pg_advisory_xact_lock(hashtext('claim_jobs'));                        -- claim은 짧으므로 직렬화해 상한을 정확히 지킨다
  select count(*) into running_total from public.jobs where status = 'running' and lease_until > now();
  slots := least(p_limit, p_global - running_total);
  if slots <= 0 then return; end if;

  return query
  with running as (
    select workspace_id, count(*) c from public.jobs where status = 'running' and lease_until > now() group by workspace_id
  ), cand as (
    select j.id, j.workspace_id,
           row_number() over (partition by j.workspace_id order by j.created_at) rn,
           coalesce((select (limits ->> 'concurrent_jobs')::int from private.current_plan(j.workspace_id)), p_per_ws) cap,
           coalesce(r.c, 0) run_c,
           j.next_run_at, j.created_at
      from public.jobs j left join running r on r.workspace_id = j.workspace_id
     where j.status = 'queued' and j.next_run_at <= now() and (p_kinds is null or j.kind = any(p_kinds))
  ), pick as (
    select id from cand where rn <= greatest(cap - run_c, 0)
     order by rn, next_run_at, created_at                                        -- 워크스페이스별 1번째 작업부터 라운드로빈 → 대량 접수 고객이 다른 고객을 굶기지 않음
     limit slots
  ), locked as (
    select j.id from public.jobs j join pick on pick.id = j.id where j.status = 'queued' for update of j skip locked
  )
  update public.jobs j
     set status = 'running', locked_by = p_worker, lease_until = now() + make_interval(secs => p_lease_seconds),
         attempts = j.attempts + 1, state_version = j.state_version + 1, updated_at = now()
    from locked where j.id = locked.id
  returning j.*;
end $$;

create or replace function private.job_heartbeat(p_job uuid, p_worker text, p_lease_seconds int default 300)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.jobs set lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where id = p_job and status = 'running' and locked_by = p_worker;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- 완료: 정산(성공한 만큼만 차감)과 상태 변경을 한 트랜잭션에서. 임대를 잃은(다른 워커/스위퍼가 가져간) 워커는 아무것도 바꾸지 못한다.
create or replace function private.complete_job(p_job uuid, p_worker text, p_status text, p_captured bigint, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if p_status not in ('ready','failed','review') then raise exception 'invalid_status'; end if;
  select * into j from public.jobs where id = p_job;
  if not found then raise exception 'job_not_found'; end if;
  perform 1 from public.wallet_accounts where workspace_id = j.workspace_id for update;    -- wallet → job 순서
  select * into j from public.jobs where id = p_job for update;
  if j.status <> 'running' or j.locked_by is distinct from p_worker then return false; end if;
  if j.reservation_ref is not null then
    perform private.settle_credits(j.workspace_id, j.reservation_ref, case when p_status = 'failed' then 0 else least(p_captured, j.estimated_credits) end);
  end if;
  update public.jobs set status = p_status, last_error = left(p_error, 500), finished_at = now(), lease_until = null,
         state_version = state_version + 1, updated_at = now() where id = p_job;
  return true;
end $$;

-- 재시도(안전한 경우만): 아직 외부 제출 전이거나 순수 내부 오류. 남은 횟수가 없으면 실패 처리(크레딧 복구).
create or replace function private.retry_job(p_job uuid, p_worker text, p_delay_seconds int, p_error text)
returns text language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or j.status <> 'running' or j.locked_by is distinct from p_worker then return 'lost'; end if;
  if j.attempts >= j.max_attempts then
    perform private.complete_job(p_job, p_worker, 'failed', 0, p_error);
    return 'failed';
  end if;
  update public.jobs set status = 'queued', locked_by = null, lease_until = null, last_error = left(p_error, 500),
         next_run_at = now() + make_interval(secs => p_delay_seconds), state_version = state_version + 1, updated_at = now()
   where id = p_job;
  return 'queued';
end $$;

-- 스위퍼: 임대 만료 job 정리. 외부 제출 시도 기록이 있으면 재실행하지 않고 provider_unknown으로.
create or replace function private.sweep_jobs()
returns table (requeued int, unknown int) language plpgsql security definer set search_path = '' as $$
declare r int := 0; u int := 0; j record;
begin
  for j in select id, exists (select 1 from public.generation_attempts a where a.job_id = jobs.id) as had_attempt
             from public.jobs where status = 'running' and lease_until < now() order by id for update skip locked
  loop
    if j.had_attempt then
      update public.jobs set status = 'provider_unknown', locked_by = null, lease_until = null, last_error = 'lease_expired_after_submit', state_version = state_version + 1, updated_at = now() where id = j.id;
      u := u + 1;
    else
      update public.jobs set status = 'queued', locked_by = null, lease_until = null, last_error = 'lease_expired', next_run_at = now(), state_version = state_version + 1, updated_at = now() where id = j.id;
      r := r + 1;
    end if;
  end loop;
  perform private.expire_credits(w.workspace_id) from (select distinct workspace_id from public.credit_buckets where expires_at is not null and expires_at <= now() and remaining - reserved > 0) w;
  return query select r, u;
end $$;

-- 운영자 복구: provider_unknown 해소. 확인 결과 '실패'면 크레딧 전액 복구, '성공'이면 지정 금액 차감.
create or replace function private.resolve_unknown_job(p_job uuid, p_outcome text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if p_outcome not in ('failed','ready') then raise exception 'invalid_outcome'; end if;
  select * into j from public.jobs where id = p_job;
  if not found then raise exception 'job_not_found'; end if;
  perform 1 from public.wallet_accounts where workspace_id = j.workspace_id for update;
  select * into j from public.jobs where id = p_job for update;
  if j.status <> 'provider_unknown' then raise exception 'job_not_unknown'; end if;
  if j.reservation_ref is not null then
    perform private.settle_credits(j.workspace_id, j.reservation_ref, case when p_outcome = 'failed' then 0 else j.estimated_credits end);
  end if;
  update public.jobs set status = p_outcome, last_error = left(coalesce(p_note, 'resolved by operator'), 500), finished_at = now(),
         state_version = state_version + 1, updated_at = now() where id = p_job;
end $$;

revoke all on function private.enqueue_job(uuid, text, uuid, text, jsonb, bigint), private.claim_jobs(text, int, int, int, int, text[]),
  private.job_heartbeat(uuid, text, int), private.complete_job(uuid, text, text, bigint, text), private.retry_job(uuid, text, int, text),
  private.sweep_jobs(), private.resolve_unknown_job(uuid, text, text) from public, anon, authenticated;
grant execute on function private.enqueue_job(uuid, text, uuid, text, jsonb, bigint), private.claim_jobs(text, int, int, int, int, text[]),
  private.job_heartbeat(uuid, text, int), private.complete_job(uuid, text, text, bigint, text), private.retry_job(uuid, text, int, text),
  private.sweep_jobs(), private.resolve_unknown_job(uuid, text, text) to service_role;

create or replace function public.svc_enqueue_job(p_ws uuid, p_kind text, p_deliverable uuid, p_request_key text, p_payload jsonb, p_credits bigint)
returns table (job_id uuid, created boolean, status text) language sql as $$ select * from private.enqueue_job(p_ws, p_kind, p_deliverable, p_request_key, p_payload, p_credits) $$;
create or replace function public.svc_claim_jobs(p_worker text, p_limit int, p_lease_seconds int default 300, p_per_ws int default 2, p_global int default 10, p_kinds text[] default null)
returns setof public.jobs language sql as $$ select * from private.claim_jobs(p_worker, p_limit, p_lease_seconds, p_per_ws, p_global, p_kinds) $$;
create or replace function public.svc_job_heartbeat(p_job uuid, p_worker text, p_lease_seconds int default 300)
returns boolean language sql as $$ select private.job_heartbeat(p_job, p_worker, p_lease_seconds) $$;
create or replace function public.svc_complete_job(p_job uuid, p_worker text, p_status text, p_captured bigint, p_error text default null)
returns boolean language sql as $$ select private.complete_job(p_job, p_worker, p_status, p_captured, p_error) $$;
create or replace function public.svc_retry_job(p_job uuid, p_worker text, p_delay_seconds int, p_error text)
returns text language sql as $$ select private.retry_job(p_job, p_worker, p_delay_seconds, p_error) $$;
create or replace function public.svc_sweep_jobs()
returns table (requeued int, unknown int) language sql as $$ select * from private.sweep_jobs() $$;
create or replace function public.svc_resolve_unknown_job(p_job uuid, p_outcome text, p_note text)
returns void language sql as $$ select private.resolve_unknown_job(p_job, p_outcome, p_note) $$;

revoke all on function public.svc_enqueue_job(uuid, text, uuid, text, jsonb, bigint), public.svc_claim_jobs(text, int, int, int, int, text[]),
  public.svc_job_heartbeat(uuid, text, int), public.svc_complete_job(uuid, text, text, bigint, text), public.svc_retry_job(uuid, text, int, text),
  public.svc_sweep_jobs(), public.svc_resolve_unknown_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.svc_enqueue_job(uuid, text, uuid, text, jsonb, bigint), public.svc_claim_jobs(text, int, int, int, int, text[]),
  public.svc_job_heartbeat(uuid, text, int), public.svc_complete_job(uuid, text, text, bigint, text), public.svc_retry_job(uuid, text, int, text),
  public.svc_sweep_jobs(), public.svc_resolve_unknown_job(uuid, text, text) to service_role;

grant select, insert, update on public.jobs to service_role;

-- ---------------------------------------------------------------- 목록 projection (JOIN·COUNT 없이 목록 표시)
alter table public.deliverables
  add column scene_total int not null default 0,
  add column scene_ready int not null default 0,
  add column cover_asset_id uuid;
alter table public.deliverables add constraint deliverables_cover_fk foreign key (workspace_id, cover_asset_id) references public.assets(workspace_id, id);

create or replace function private.refresh_deliverable_projection(p_deliverable uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; tot int; rdy int; cover uuid;
begin
  select * into d from public.deliverables where id = p_deliverable;
  if not found or d.current_version_id is null then return; end if;
  select count(*), count(*) filter (where s.status = 'ready' and s.asset_id is not null) into tot, rdy
    from public.scenes s where s.creative_version_id = d.current_version_id;
  select s.asset_id into cover from public.scenes s
   where s.creative_version_id = d.current_version_id and s.asset_id is not null
   order by nullif(regexp_replace(s.scene_key, '\D', '', 'g'), '')::int nulls last, s.scene_key limit 1;
  update public.deliverables set scene_total = tot, scene_ready = rdy, cover_asset_id = cover
   where id = p_deliverable and (scene_total, scene_ready, cover_asset_id) is distinct from (tot, rdy, cover);
  update public.projects set thumbnail_asset_id = cover, updated_at = now()
   where id = d.project_id and workspace_id = d.workspace_id and thumbnail_asset_id is distinct from cover and cover is not null;
end $$;

create or replace function private.scenes_projection_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dv uuid;
begin
  select cv.deliverable_id into dv from public.creative_versions cv where cv.id = coalesce(new.creative_version_id, old.creative_version_id);
  if dv is not null then perform private.refresh_deliverable_projection(dv); end if;
  return null;
end $$;
create trigger scenes_projection after insert or update of status, asset_id or delete on public.scenes
for each row execute function private.scenes_projection_trigger();

create or replace function private.deliverables_projection_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.projects set deliverable_count = deliverable_count + 1, updated_at = now() where id = new.project_id and workspace_id = new.workspace_id;
  elsif tg_op = 'DELETE' then
    update public.projects set deliverable_count = greatest(deliverable_count - 1, 0) where id = old.project_id and workspace_id = old.workspace_id;
  elsif new.current_version_id is distinct from old.current_version_id then
    perform private.refresh_deliverable_projection(new.id);
  end if;
  return null;
end $$;
create trigger deliverables_projection after insert or delete or update of current_version_id on public.deliverables
for each row execute function private.deliverables_projection_trigger();

-- 백필
update public.projects p set deliverable_count = (select count(*) from public.deliverables d where d.project_id = p.id and d.workspace_id = p.workspace_id);
do $$ declare d record; begin
  for d in select id from public.deliverables where current_version_id is not null loop perform private.refresh_deliverable_projection(d.id); end loop;
end $$;

create index deliverables_ws_recent_idx on public.deliverables(workspace_id, updated_at desc, id desc);
