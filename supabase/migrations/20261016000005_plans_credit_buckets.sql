-- 5: 플랜·권한(entitlement)·한도 / 만료 있는 크레딧 버킷 / 월 한도 카운터
-- 기준: blueprint v1.5 3장(플랜표), 9~10장(버킷·예약·정산), 26장(한도), 54장(포함량).
-- 원칙: 기존 wallet_accounts는 "캐시"로 유지하고, 진실은 credit_ledger + credit_buckets. 모든 변경은 wallet 행 잠금 → 멱등 event_key.
-- 결제는 연결하지 않는다(billing disabled). 플랜 변경은 운영자 베타 배정으로만 일어난다.

-- ---------------------------------------------------------------- 플랜 (불변 버전)
create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code in ('trial','starter','growth','studio')),
  version int not null default 1,
  name text not null,
  price_krw int not null default 0 check (price_krw >= 0),         -- VAT 포함 표시가 (제안값, 결제 연결 전 확정 아님)
  monthly_credits int not null default 0 check (monthly_credits >= 0),
  limits_json jsonb not null default '{}',                          -- brands/products/seats/storage_gb/concurrent_jobs/pending_jobs/exports_month/proposals_month ...
  status text not null default 'draft' check (status in ('draft','published','retired')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (code, version)
);

create or replace function private.plan_version_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then raise exception 'published plan_versions cannot be deleted'; end if;
    return old;
  end if;
  if old.status = 'published' and (new.price_krw, new.monthly_credits, new.limits_json, new.name, new.code, new.version)
       is distinct from (old.price_krw, old.monthly_credits, old.limits_json, old.name, old.code, old.version) then
    raise exception 'published plan_versions are immutable; create a new version';
  end if;
  return new;
end $$;
create trigger plan_versions_immutable before update or delete on public.plan_versions
for each row execute function private.plan_version_immutable();

insert into public.plan_versions (code, version, name, price_krw, monthly_credits, limits_json, status, published_at) values
 ('trial',   1, '체험',    0,      0,    '{"brands":1,"products":1,"seats":1,"storage_gb":0.5,"concurrent_jobs":1,"pending_jobs":1,"exports_month":3,"proposals_month":1,"planning_calls_month":10,"trial_credits":30,"trial_days":7}', 'published', now()),
 ('starter', 1, 'Starter', 49000,  500,  '{"brands":1,"products":5,"seats":1,"storage_gb":10,"concurrent_jobs":1,"pending_jobs":5,"exports_month":100,"proposals_month":10,"planning_calls_month":150}',  'published', now()),
 ('growth',  1, 'Growth',  99000,  1100, '{"brands":5,"products":30,"seats":3,"storage_gb":50,"concurrent_jobs":2,"pending_jobs":15,"exports_month":300,"proposals_month":30,"planning_calls_month":400}', 'published', now()),
 ('studio',  1, 'Studio',  199000, 2300, '{"brands":20,"products":150,"seats":10,"storage_gb":150,"concurrent_jobs":4,"pending_jobs":30,"exports_month":800,"proposals_month":60,"planning_calls_month":1000}', 'published', now());

-- ---------------------------------------------------------------- 워크스페이스 권한 (현재 적용 플랜)
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_version_id uuid not null references public.plan_versions(id),
  source text not null default 'trial' check (source in ('trial','beta_admin','paid')),
  status text not null default 'active' check (status in ('active','ended')),
  period_start timestamptz not null default now(),
  period_end timestamptz,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index entitlements_one_active on public.entitlements(workspace_id) where status = 'active';
create index entitlements_ws_idx on public.entitlements(workspace_id, created_at desc);

create or replace function private.current_plan(p_ws uuid)
returns table (code text, name text, price_krw int, monthly_credits int, limits jsonb, source text, plan_version_id uuid)
language sql stable security definer set search_path = '' as $$
  select pv.code, pv.name, pv.price_krw, pv.monthly_credits, pv.limits_json, e.source, pv.id
    from public.entitlements e join public.plan_versions pv on pv.id = e.plan_version_id
   where e.workspace_id = p_ws and e.status = 'active'
   limit 1;
$$;

-- 플랜 변경(운영자 베타 배정 등). 이전 권한을 종료하고 새 권한을 연다. 크레딧 지급은 별도 호출(grant)로 분리한다.
create or replace function private.set_plan(p_ws uuid, p_plan_code text, p_source text, p_reason text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pv uuid; eid uuid;
begin
  select id into pv from public.plan_versions where code = p_plan_code and status = 'published' order by version desc limit 1;
  if pv is null then raise exception 'plan_not_found'; end if;
  perform 1 from public.workspaces where id = p_ws for update;           -- 동일 워크스페이스의 동시 변경 직렬화
  update public.entitlements set status = 'ended', ended_at = now() where workspace_id = p_ws and status = 'active';
  insert into public.entitlements(workspace_id, plan_version_id, source, reason, created_by)
  values (p_ws, pv, p_source, p_reason, p_actor) returning id into eid;
  return eid;
end $$;

-- 신규 가입 시 체험 권한 자동 부여 (기존 handle_new_user 확장)
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  insert into public.workspaces(name, owner_id)
  values (coalesce(split_part(new.email,'@',1),'내 워크스페이스'), new.id)
  returning id into ws;
  insert into public.memberships(workspace_id, user_id, role) values (ws, new.id, 'owner');
  insert into public.wallet_accounts(workspace_id) values (ws);
  perform private.set_plan(ws, 'trial', 'trial', 'signup', new.id);
  return new;
end $$;

-- 기존 워크스페이스 백필
insert into public.entitlements(workspace_id, plan_version_id, source, reason)
select w.id, (select id from public.plan_versions where code = 'trial' and version = 1), 'trial', 'backfill'
  from public.workspaces w
 where not exists (select 1 from public.entitlements e where e.workspace_id = w.id and e.status = 'active');

-- ---------------------------------------------------------------- 한도 강제 (브랜드/제품 수)
create or replace function private.enforce_plan_count()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lim numeric; cnt bigint; k text := tg_argv[0];
begin
  if new.status <> 'active' then return new; end if;
  select (limits ->> k)::numeric into lim from private.current_plan(new.workspace_id);
  if lim is null then return new; end if;
  execute format('select count(*) from public.%I where workspace_id = $1 and status = ''active''', tg_table_name) into cnt using new.workspace_id;
  if tg_op = 'UPDATE' and old.status = 'active' then return new; end if;     -- 이미 센 항목의 수정은 통과
  if cnt >= lim then
    raise exception 'plan_limit_exceeded:%', k using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger brands_plan_limit   before insert or update of status on public.brands   for each row execute function private.enforce_plan_count('brands');
create trigger products_plan_limit before insert or update of status on public.products for each row execute function private.enforce_plan_count('products');

-- ---------------------------------------------------------------- 크레딧 버킷 (만료·소모 순서)
alter table public.credit_ledger drop constraint credit_ledger_type_check;
alter table public.credit_ledger add constraint credit_ledger_type_check
  check (type in ('GRANT','RESERVE','CAPTURE','RELEASE','ADJUST','EXPIRE','REVOKE'));

create table public.credit_buckets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null default 'admin' check (source in ('trial','plan_monthly','pack','beta_grant','admin','restore','legacy')),
  grant_key text not null unique,
  granted bigint not null check (granted > 0),
  remaining bigint not null check (remaining >= 0),               -- 예약분 포함 (차감·만료 전까지의 잔량)
  reserved bigint not null default 0 check (reserved >= 0),
  expires_at timestamptz,                                          -- null = 만료 없음
  created_at timestamptz not null default now(),
  check (reserved <= remaining)
);
create index credit_buckets_spend_idx on public.credit_buckets(workspace_id, expires_at nulls last, created_at) where remaining > 0;
alter table public.credit_buckets enable row level security;
create policy buckets_sel on public.credit_buckets for select to authenticated using (private.is_member(workspace_id));
revoke all on public.credit_buckets from anon, authenticated;
grant select on public.credit_buckets to authenticated;
grant select on public.credit_buckets to service_role;

create table public.credit_reservation_allocations (
  reservation_id uuid not null references public.credit_reservations(id) on delete cascade,
  bucket_id uuid not null references public.credit_buckets(id),
  amount bigint not null check (amount > 0),
  primary key (reservation_id, bucket_id)
);
alter table public.credit_reservation_allocations enable row level security;
revoke all on public.credit_reservation_allocations from anon, authenticated;
grant select on public.credit_reservation_allocations to service_role;

-- 기존 잔액 이전 (legacy 버킷). 진행 중 예약도 legacy 버킷에 배정.
insert into public.credit_buckets(workspace_id, source, grant_key, granted, remaining, reserved)
select workspace_id, 'legacy', 'legacy:' || workspace_id, available + reserved, available + reserved, reserved
  from public.wallet_accounts where available + reserved > 0;
insert into public.credit_reservation_allocations(reservation_id, bucket_id, amount)
select r.id, b.id, r.amount - r.captured
  from public.credit_reservations r
  join public.credit_buckets b on b.workspace_id = r.workspace_id and b.source = 'legacy'
 where r.status = 'reserved';

-- ---- 지급 (버킷 생성)
drop function if exists public.svc_grant_credits(uuid, bigint, text, text);
drop function if exists private.grant_credits(uuid, bigint, text, text);
create or replace function private.grant_credits(p_ws uuid, p_amount bigint, p_event_key text, p_note text,
                                                 p_source text default 'admin', p_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  perform 1 from public.wallet_accounts where workspace_id = p_ws for update;
  if not found then raise exception 'wallet_not_found'; end if;
  if exists (select 1 from public.credit_ledger where event_key = p_event_key) then return; end if;   -- 멱등: 같은 지급 키는 한 번만
  insert into public.credit_buckets(workspace_id, source, grant_key, granted, remaining, expires_at)
  values (p_ws, p_source, p_event_key, p_amount, p_amount, p_expires_at);
  insert into public.credit_ledger(workspace_id, event_key, type, amount, note) values (p_ws, p_event_key, 'GRANT', p_amount, p_note);
  update public.wallet_accounts set available = available + p_amount, version = version + 1, updated_at = now() where workspace_id = p_ws;
end $$;

-- ---- 예약 (만료 임박 버킷부터 배정)
create or replace function private.reserve_credits(p_ws uuid, p_amount bigint, p_ref text)
returns void language plpgsql security definer set search_path = '' as $$
declare w public.wallet_accounts; rid uuid; need bigint := p_amount; b record; take bigint;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into w from public.wallet_accounts where workspace_id = p_ws for update;
  if not found then raise exception 'wallet_not_found'; end if;
  if exists (select 1 from public.credit_reservations where workspace_id = p_ws and ref_key = p_ref) then return; end if;

  -- 만료된 버킷은 먼저 정리(가용에서 제외)
  perform private.expire_credits(p_ws);
  select * into w from public.wallet_accounts where workspace_id = p_ws;
  if w.available < p_amount then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;

  insert into public.credit_reservations(workspace_id, ref_key, amount) values (p_ws, p_ref, p_amount) returning id into rid;
  for b in
    select id, remaining - reserved as free from public.credit_buckets
     where workspace_id = p_ws and remaining - reserved > 0 and (expires_at is null or expires_at > now())
     order by expires_at nulls last, created_at, id
     for update
  loop
    exit when need = 0;
    take := least(b.free, need);
    update public.credit_buckets set reserved = reserved + take where id = b.id;
    insert into public.credit_reservation_allocations(reservation_id, bucket_id, amount) values (rid, b.id, take);
    need := need - take;
  end loop;
  if need > 0 then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;   -- 지갑 캐시와 버킷 불일치 방어

  update public.wallet_accounts set available = available - p_amount, reserved = reserved + p_amount, version = version + 1, updated_at = now() where workspace_id = p_ws;
  insert into public.credit_ledger(workspace_id, event_key, type, amount, note) values (p_ws, p_ref || ':reserve', 'RESERVE', p_amount, p_ref);
end $$;

-- ---- 정산 (앞쪽 배정분부터 차감, 나머지 해제)
create or replace function private.settle_credits(p_ws uuid, p_ref text, p_captured bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.credit_reservations; rest bigint; left_cap bigint; a record; cap bigint;
begin
  perform 1 from public.wallet_accounts where workspace_id = p_ws for update;            -- 잠금 순서: wallet → reservation → bucket
  select * into r from public.credit_reservations where workspace_id = p_ws and ref_key = p_ref for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if r.status = 'settled' then return; end if;
  if p_captured < 0 or p_captured > r.amount then raise exception 'invalid_capture_amount'; end if;

  rest := r.amount - p_captured;
  left_cap := p_captured;
  for a in
    select al.bucket_id, al.amount from public.credit_reservation_allocations al
      join public.credit_buckets b on b.id = al.bucket_id
     where al.reservation_id = r.id
     order by b.expires_at nulls last, b.created_at, b.id
  loop
    cap := least(a.amount, left_cap);
    left_cap := left_cap - cap;
    update public.credit_buckets set reserved = reserved - a.amount, remaining = remaining - cap where id = a.bucket_id;
  end loop;

  update public.wallet_accounts set reserved = reserved - r.amount, available = available + rest, version = version + 1, updated_at = now() where workspace_id = p_ws;
  update public.credit_reservations set captured = p_captured, status = 'settled', settled_at = now() where id = r.id;
  if p_captured > 0 then
    insert into public.credit_ledger(workspace_id, event_key, type, amount, note) values (p_ws, p_ref || ':capture', 'CAPTURE', p_captured, p_ref);
  end if;
  if rest > 0 then
    insert into public.credit_ledger(workspace_id, event_key, type, amount, note) values (p_ws, p_ref || ':release', 'RELEASE', rest, p_ref);
  end if;
  perform private.expire_credits(p_ws);                                                    -- 해제된 몫이 이미 만료된 버킷이면 즉시 소멸
end $$;

-- ---- 만료 처리: 예약되지 않은 잔량만 소멸 (예약분은 정산 시점에 정리)
create or replace function private.expire_credits(p_ws uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare b record; amt bigint; total bigint := 0;
begin
  for b in select id, remaining, reserved from public.credit_buckets
            where workspace_id = p_ws and expires_at is not null and expires_at <= now() and remaining - reserved > 0
            order by id for update
  loop
    amt := b.remaining - b.reserved;
    update public.credit_buckets set remaining = remaining - amt where id = b.id;
    insert into public.credit_ledger(workspace_id, event_key, type, amount, note)
    values (p_ws, 'expire:' || b.id || ':' || b.remaining, 'EXPIRE', amt, 'bucket ' || b.id);
    update public.wallet_accounts set available = available - amt, version = version + 1, updated_at = now() where workspace_id = p_ws;
    total := total + amt;
  end loop;
  return total;
end $$;

-- ---- 회수(운영자): 사용하지 않은 해당 버킷 잔량 범위 안에서만
create or replace function private.revoke_credits(p_ws uuid, p_bucket uuid, p_amount bigint, p_event_key text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.credit_buckets;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  perform 1 from public.wallet_accounts where workspace_id = p_ws for update;
  if exists (select 1 from public.credit_ledger where event_key = p_event_key) then return; end if;
  select * into b from public.credit_buckets where id = p_bucket and workspace_id = p_ws for update;
  if not found then raise exception 'bucket_not_found'; end if;
  if p_amount > b.remaining - b.reserved then raise exception 'revoke_exceeds_unused'; end if;
  update public.credit_buckets set remaining = remaining - p_amount where id = b.id;
  update public.wallet_accounts set available = available - p_amount, version = version + 1, updated_at = now() where workspace_id = p_ws;
  insert into public.credit_ledger(workspace_id, event_key, type, amount, note) values (p_ws, p_event_key, 'REVOKE', p_amount, p_note);
end $$;

-- ---- 원장 ↔ 지갑 ↔ 버킷 3자 대조
create or replace function private.wallet_reconcile(p_ws uuid)
returns table (ok boolean, ledger_total bigint, wallet_total bigint, ledger_reserved bigint, wallet_reserved bigint)
language sql stable security definer set search_path = '' as $$
  with l as (
    select
      coalesce(sum(case type when 'GRANT' then amount when 'ADJUST' then amount when 'CAPTURE' then -amount when 'EXPIRE' then -amount when 'REVOKE' then -amount else 0 end), 0) as total,
      coalesce(sum(case type when 'RESERVE' then amount when 'CAPTURE' then -amount when 'RELEASE' then -amount else 0 end), 0) as reserved
    from public.credit_ledger where workspace_id = p_ws
  ), w as (
    select available + reserved as total, reserved from public.wallet_accounts where workspace_id = p_ws
  ), bk as (
    select coalesce(sum(remaining), 0) as total, coalesce(sum(reserved), 0) as reserved from public.credit_buckets where workspace_id = p_ws
  )
  select (l.total = w.total and l.reserved = w.reserved and bk.total = w.total and bk.reserved = w.reserved),
         l.total, w.total, l.reserved, w.reserved
    from l, w, bk;
$$;

revoke all on function private.grant_credits(uuid, bigint, text, text, text, timestamptz), private.reserve_credits(uuid, bigint, text),
  private.settle_credits(uuid, text, bigint), private.expire_credits(uuid), private.revoke_credits(uuid, uuid, bigint, text, text),
  private.wallet_reconcile(uuid), private.set_plan(uuid, text, text, text, uuid), private.current_plan(uuid) from public, anon, authenticated;
grant execute on function private.grant_credits(uuid, bigint, text, text, text, timestamptz), private.reserve_credits(uuid, bigint, text),
  private.settle_credits(uuid, text, bigint), private.expire_credits(uuid), private.revoke_credits(uuid, uuid, bigint, text, text),
  private.wallet_reconcile(uuid), private.set_plan(uuid, text, text, text, uuid), private.current_plan(uuid) to service_role;

create or replace function public.svc_grant_credits(p_ws uuid, p_amount bigint, p_event_key text, p_note text,
                                                    p_source text default 'admin', p_expires_at timestamptz default null)
returns void language sql as $$ select private.grant_credits(p_ws, p_amount, p_event_key, p_note, p_source, p_expires_at) $$;
create or replace function public.svc_revoke_credits(p_ws uuid, p_bucket uuid, p_amount bigint, p_event_key text, p_note text)
returns void language sql as $$ select private.revoke_credits(p_ws, p_bucket, p_amount, p_event_key, p_note) $$;
create or replace function public.svc_set_plan(p_ws uuid, p_plan_code text, p_source text, p_reason text, p_actor uuid)
returns uuid language sql as $$ select private.set_plan(p_ws, p_plan_code, p_source, p_reason, p_actor) $$;
create or replace function public.svc_expire_credits(p_ws uuid)
returns bigint language sql as $$ select private.expire_credits(p_ws) $$;

revoke all on function public.svc_grant_credits(uuid, bigint, text, text, text, timestamptz), public.svc_revoke_credits(uuid, uuid, bigint, text, text),
  public.svc_set_plan(uuid, text, text, text, uuid), public.svc_expire_credits(uuid) from public, anon, authenticated;
grant execute on function public.svc_grant_credits(uuid, bigint, text, text, text, timestamptz), public.svc_revoke_credits(uuid, uuid, bigint, text, text),
  public.svc_set_plan(uuid, text, text, text, uuid), public.svc_expire_credits(uuid) to service_role;

-- ---------------------------------------------------------------- 월 한도 카운터 (오늘의 제안·추가 출력 등)
create table public.usage_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period_start date not null,                                     -- 한국 시간 기준 월 시작
  key text not null,
  used bigint not null default 0 check (used >= 0),
  primary key (workspace_id, period_start, key)
);
create table public.usage_events (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_key text not null,                                      -- 같은 요청은 한 번만 소비
  key text not null,
  qty bigint not null check (qty > 0),
  created_at timestamptz not null default now(),
  primary key (workspace_id, request_key)
);
alter table public.usage_counters enable row level security;
alter table public.usage_events enable row level security;
create policy usage_counters_sel on public.usage_counters for select to authenticated using (private.is_member(workspace_id));
revoke all on public.usage_counters, public.usage_events from anon, authenticated;
grant select on public.usage_counters to authenticated;
grant select on public.usage_counters, public.usage_events to service_role;

-- 한도 안에서만 소비. 같은 request_key 재호출은 소비 없이 true. 초과면 allowance_exceeded.
create or replace function private.consume_allowance(p_ws uuid, p_key text, p_qty bigint, p_limit bigint, p_request_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare per date := (date_trunc('month', now() at time zone 'Asia/Seoul'))::date; cur bigint;
begin
  if p_qty <= 0 then raise exception 'qty must be positive'; end if;
  perform 1 from public.workspaces where id = p_ws for update;            -- 워크스페이스 단위 직렬화(짧은 트랜잭션)
  if exists (select 1 from public.usage_events where workspace_id = p_ws and request_key = p_request_key) then return true; end if;
  insert into public.usage_counters(workspace_id, period_start, key) values (p_ws, per, p_key) on conflict do nothing;
  select used into cur from public.usage_counters where workspace_id = p_ws and period_start = per and key = p_key for update;
  if cur + p_qty > p_limit then raise exception 'allowance_exceeded:%', p_key using errcode = 'P0001'; end if;
  update public.usage_counters set used = used + p_qty where workspace_id = p_ws and period_start = per and key = p_key;
  insert into public.usage_events(workspace_id, request_key, key, qty) values (p_ws, p_request_key, p_key, p_qty);
  return true;
end $$;
revoke all on function private.consume_allowance(uuid, text, bigint, bigint, text) from public, anon, authenticated;
grant execute on function private.consume_allowance(uuid, text, bigint, bigint, text) to service_role;
create or replace function public.svc_consume_allowance(p_ws uuid, p_key text, p_qty bigint, p_limit bigint, p_request_key text)
returns boolean language sql as $$ select private.consume_allowance(p_ws, p_key, p_qty, p_limit, p_request_key) $$;
revoke all on function public.svc_consume_allowance(uuid, text, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.svc_consume_allowance(uuid, text, bigint, bigint, text) to service_role;

-- plan_versions / entitlements 조회 권한
alter table public.plan_versions enable row level security;
alter table public.entitlements enable row level security;
create policy plans_sel on public.plan_versions for select to authenticated using (status = 'published');
create policy entitlements_sel on public.entitlements for select to authenticated using (private.is_member(workspace_id));
revoke all on public.plan_versions, public.entitlements from anon, authenticated;
grant select on public.plan_versions, public.entitlements to authenticated;
grant select, insert, update on public.plan_versions to service_role;
grant select on public.entitlements to service_role;

-- 서버가 현재 플랜 한도를 한 번에 읽는 래퍼 (service_role 전용)
create or replace function public.current_plan_limits(p_ws uuid)
returns jsonb language sql stable as $$ select limits from private.current_plan(p_ws) $$;
revoke all on function public.current_plan_limits(uuid) from public, anon, authenticated;
grant execute on function public.current_plan_limits(uuid) to service_role;

-- 만료된 크레딧을 일괄 정리 (sweeper 가 호출). 워크스페이스별로 처리하고 한 번에 p_limit 곳까지만 한다.
create or replace function private.expire_all_credits(p_limit int default 200)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select distinct workspace_id from public.credit_buckets
           where remaining > 0 and expires_at is not null and expires_at <= now() limit p_limit loop
    perform private.expire_credits(r.workspace_id);
    n := n + 1;
  end loop;
  return n;
end $$;
create or replace function public.svc_expire_all_credits(p_limit int default 200)
returns int language sql as $$ select private.expire_all_credits(p_limit) $$;
revoke all on function private.expire_all_credits(int), public.svc_expire_all_credits(int) from public, anon, authenticated;
grant execute on function private.expire_all_credits(int), public.svc_expire_all_credits(int) to service_role;
