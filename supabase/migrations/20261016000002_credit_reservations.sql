-- 크레딧 예약 → 정산 (blueprint 10장 축소판)
-- 원칙: 외부 생성 호출 전에 예약(available→reserved), 성공한 만큼만 차감(CAPTURE), 나머지는 해제(RELEASE).
-- 모든 변경은 wallet 행 잠금 + event_key 멱등. 사용자 직접 호출 불가(service_role 전용).
--
-- 장부 규칙: amount는 항상 양수 크기, type이 방향을 정한다.
--   GRANT   : 총잔액(available+reserved) 증가
--   RESERVE : available → reserved 이동 (총잔액 불변)
--   CAPTURE : reserved 감소 (총잔액 감소, 실제 차감)
--   RELEASE : reserved → available 이동 (총잔액 불변)
--   ADJUST  : 운영자 조정(양수 = 증가). 사유를 note에 남긴다.

create table public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ref_key text not null,                       -- 예: 작업/장면 단위 멱등 키
  amount bigint not null check (amount > 0),
  captured bigint not null default 0 check (captured >= 0),
  status text not null default 'reserved' check (status in ('reserved','settled')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (workspace_id, ref_key),
  check (captured <= amount)
);
alter table public.credit_reservations enable row level security;
create policy resv_sel on public.credit_reservations for select to authenticated using (private.is_member(workspace_id));
revoke all on public.credit_reservations from anon, authenticated;
grant select on public.credit_reservations to authenticated;

-- 예약. 같은 ref_key로 다시 호출하면 기존 예약을 그대로 인정(멱등). 잔액 부족이면 'insufficient_credits'.
create or replace function private.reserve_credits(p_ws uuid, p_amount bigint, p_ref text)
returns void language plpgsql security definer set search_path = '' as $$
declare w public.wallet_accounts;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into w from public.wallet_accounts where workspace_id = p_ws for update;
  if not found then raise exception 'wallet_not_found'; end if;

  if exists (select 1 from public.credit_reservations where workspace_id = p_ws and ref_key = p_ref) then
    return;                                       -- 이미 처리된 요청(더블클릭/재시도)
  end if;
  if w.available < p_amount then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  update public.wallet_accounts
     set available = available - p_amount, reserved = reserved + p_amount, version = version + 1, updated_at = now()
   where workspace_id = p_ws;
  insert into public.credit_reservations(workspace_id, ref_key, amount) values (p_ws, p_ref, p_amount);
  insert into public.credit_ledger(workspace_id, event_key, type, amount, note)
  values (p_ws, p_ref || ':reserve', 'RESERVE', p_amount, p_ref);
end $$;

-- 정산: p_captured만큼 차감 확정, 나머지는 해제. 이미 정산됐으면 아무 일도 하지 않는다(멱등).
create or replace function private.settle_credits(p_ws uuid, p_ref text, p_captured bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.credit_reservations; rest bigint;
begin
  perform 1 from public.wallet_accounts where workspace_id = p_ws for update;   -- 잠금 순서 고정: wallet 먼저
  select * into r from public.credit_reservations where workspace_id = p_ws and ref_key = p_ref for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if r.status = 'settled' then return; end if;
  if p_captured < 0 or p_captured > r.amount then raise exception 'invalid_capture_amount'; end if;

  rest := r.amount - p_captured;
  update public.wallet_accounts
     set reserved = reserved - r.amount, available = available + rest, version = version + 1, updated_at = now()
   where workspace_id = p_ws;
  update public.credit_reservations set captured = p_captured, status = 'settled', settled_at = now() where id = r.id;

  if p_captured > 0 then
    insert into public.credit_ledger(workspace_id, event_key, type, amount, note)
    values (p_ws, p_ref || ':capture', 'CAPTURE', p_captured, p_ref);
  end if;
  if rest > 0 then
    insert into public.credit_ledger(workspace_id, event_key, type, amount, note)
    values (p_ws, p_ref || ':release', 'RELEASE', rest, p_ref);
  end if;
end $$;

-- 원장과 지갑 캐시 대조 (운영 점검용). ok=true 여야 정상.
create or replace function private.wallet_reconcile(p_ws uuid)
returns table (ok boolean, ledger_total bigint, wallet_total bigint, ledger_reserved bigint, wallet_reserved bigint)
language sql stable security definer set search_path = '' as $$
  with l as (
    select
      coalesce(sum(case type when 'GRANT' then amount when 'ADJUST' then amount when 'CAPTURE' then -amount else 0 end), 0) as total,
      coalesce(sum(case type when 'RESERVE' then amount when 'CAPTURE' then -amount when 'RELEASE' then -amount else 0 end), 0) as reserved
    from public.credit_ledger where workspace_id = p_ws
  ), w as (
    select available + reserved as total, reserved from public.wallet_accounts where workspace_id = p_ws
  )
  select (l.total = w.total and l.reserved = w.reserved), l.total, w.total, l.reserved, w.reserved from l, w;
$$;

revoke all on function private.reserve_credits(uuid, bigint, text), private.settle_credits(uuid, text, bigint),
  private.wallet_reconcile(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 서버 전용 호출 경로
-- supabase-js(PostgREST)는 노출된 스키마(public)의 함수만 호출할 수 있다.
-- 로직은 비노출 private에 두고, public에는 service_role만 실행 가능한 얇은 래퍼만 둔다.
-- (anon/authenticated는 EXECUTE 권한이 없어 브라우저에서 호출 불가. service_role 키는 서버에서만 사용)
grant usage on schema private to service_role;
grant execute on function private.grant_credits(uuid, bigint, text, text),
  private.reserve_credits(uuid, bigint, text),
  private.settle_credits(uuid, text, bigint),
  private.wallet_reconcile(uuid) to service_role;

create or replace function public.svc_grant_credits(p_ws uuid, p_amount bigint, p_event_key text, p_note text)
returns void language sql as $$ select private.grant_credits(p_ws, p_amount, p_event_key, p_note) $$;

create or replace function public.svc_reserve_credits(p_ws uuid, p_amount bigint, p_ref text)
returns void language sql as $$ select private.reserve_credits(p_ws, p_amount, p_ref) $$;

create or replace function public.svc_settle_credits(p_ws uuid, p_ref text, p_captured bigint)
returns void language sql as $$ select private.settle_credits(p_ws, p_ref, p_captured) $$;

create or replace function public.svc_wallet_reconcile(p_ws uuid)
returns table (ok boolean, ledger_total bigint, wallet_total bigint, ledger_reserved bigint, wallet_reserved bigint)
language sql as $$ select * from private.wallet_reconcile(p_ws) $$;

revoke all on function public.svc_grant_credits(uuid, bigint, text, text), public.svc_reserve_credits(uuid, bigint, text),
  public.svc_settle_credits(uuid, text, bigint), public.svc_wallet_reconcile(uuid) from public, anon, authenticated;
grant execute on function public.svc_grant_credits(uuid, bigint, text, text), public.svc_reserve_credits(uuid, bigint, text),
  public.svc_settle_credits(uuid, text, bigint), public.svc_wallet_reconcile(uuid) to service_role;

-- 서버(service_role)가 워커/API에서 읽고 쓰는 테이블 권한 (RLS는 bypassrls로 우회하므로 서버 코드가 workspace 소속을 직접 검증해야 한다)
grant select, insert, update on public.jobs, public.generation_attempts, public.assets, public.scenes,
  public.creative_versions, public.deliverables, public.briefs, public.concepts, public.parts, public.projects to service_role;
grant select on public.wallet_accounts, public.credit_ledger, public.credit_reservations, public.workspaces,
  public.memberships, public.brands, public.products to service_role;
