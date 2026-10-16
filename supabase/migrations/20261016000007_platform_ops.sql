-- 7: 운영(/ops)·문의·알림·감사·팀 초대·체험 지급·사이트 설정
-- 기준: blueprint v1.5 16, 25~29장. 결제 제외. 고객 워크스페이스 권한과 플랫폼 운영자 권한은 완전히 분리한다.

-- ---------------------------------------------------------------- 플랫폼 운영자 (고객 membership과 별개)
create table public.platform_admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','billing','support','readonly')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now()
);
alter table public.platform_admin_roles enable row level security;
create policy padmin_self on public.platform_admin_roles for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.platform_admin_roles from anon, authenticated;
grant select on public.platform_admin_roles to authenticated;
grant select, insert, update on public.platform_admin_roles to service_role;

create or replace function private.is_platform_admin(p_roles text[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admin_roles r
                  where r.user_id = (select auth.uid()) and r.status = 'active' and (p_roles is null or r.role = any(p_roles)));
$$;
revoke all on function private.is_platform_admin(text[]) from public, anon;
grant execute on function private.is_platform_admin(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------- 감사 로그 (append-only)
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  actor_id uuid,
  actor_kind text not null default 'user' check (actor_kind in ('user','admin','system')),
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}',
  trace_id text,
  created_at timestamptz not null default now()
);
create index audit_ws_idx on public.audit_events(workspace_id, created_at desc);
create index audit_action_idx on public.audit_events(action, created_at desc);
create or replace function private.audit_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'audit_events is append-only'; end $$;
create trigger audit_no_update before update or delete on public.audit_events for each row execute function private.audit_immutable();
alter table public.audit_events enable row level security;
-- 고객은 자기 워크스페이스 감사 기록 중 owner/admin만 조회
create policy audit_sel on public.audit_events for select to authenticated
  using (workspace_id is not null and exists (select 1 from public.memberships m where m.workspace_id = audit_events.workspace_id
          and m.user_id = (select auth.uid()) and m.status = 'active' and m.role in ('owner','admin')));
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
grant select, insert on public.audit_events to service_role;

-- ---------------------------------------------------------------- 문의 (작성자 ACL)
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requester_id uuid not null default auth.uid() references auth.users(id),
  category text not null check (category in ('signup','quality','credits','files','team','error','other')),
  subject text not null check (char_length(subject) between 1 and 120),
  status text not null default 'open' check (status in ('open','triaged','waiting_customer','in_progress','resolved','closed')),
  priority text not null default 'normal' check (priority in ('normal','urgent')),
  assignee_id uuid,
  related jsonb not null default '{}',                           -- {project_id, deliverable_id, job_id} (고객 동의 하에 연결)
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index tickets_requester_idx on public.support_tickets(requester_id, last_message_at desc);
create index tickets_queue_idx on public.support_tickets(status, priority, last_message_at) where status in ('open','triaged','in_progress','waiting_customer');

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid,
  author_kind text not null check (author_kind in ('customer','staff')),
  visibility text not null default 'customer' check (visibility in ('customer','internal')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index support_messages_ticket_idx on public.support_messages(ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
create policy tickets_sel on public.support_tickets for select to authenticated using (requester_id = (select auth.uid()));
create policy tickets_ins on public.support_tickets for insert to authenticated
  with check (requester_id = (select auth.uid()) and private.is_member(workspace_id));
create policy msgs_sel on public.support_messages for select to authenticated
  using (visibility = 'customer' and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.requester_id = (select auth.uid())));
create policy msgs_ins on public.support_messages for insert to authenticated
  with check (author_kind = 'customer' and visibility = 'customer' and author_id = (select auth.uid())
              and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.requester_id = (select auth.uid()) and t.status <> 'closed'));
revoke all on public.support_tickets, public.support_messages from anon, authenticated;
grant select, insert on public.support_tickets, public.support_messages to authenticated;
grant select, insert, update on public.support_tickets, public.support_messages to service_role;

-- 고객 답변이 달리면 티켓을 다시 연다 / 마지막 메시지 시각 갱신
create or replace function private.support_message_after() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.support_tickets set last_message_at = new.created_at, updated_at = now(),
         status = case when new.author_kind = 'customer' and status in ('waiting_customer','resolved') then 'open'
                       when new.author_kind = 'staff' and new.visibility = 'customer' and status in ('open','triaged') then 'waiting_customer'
                       else status end
   where id = new.ticket_id;
  return null;
end $$;
create trigger support_messages_after after insert on public.support_messages for each row execute function private.support_message_after();
create trigger support_tickets_touch before update on public.support_tickets for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- 알림
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  kind text not null default 'info' check (kind in ('info','success','warning','error')),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)                                      -- 같은 사건의 중복 알림 방지
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;
alter table public.notifications enable row level security;
create policy notif_sel on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notif_upd on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update on public.notifications to service_role;

-- ---------------------------------------------------------------- 사이트 설정 / 기능 플래그 / 연결 상태
create table public.site_settings (
  key text primary key,
  value_json jsonb not null,
  version int not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;               -- 정책 없음 = 서버(service_role) 전용
revoke all on public.site_settings from anon, authenticated;
grant select, insert, update on public.site_settings to service_role;
insert into public.site_settings(key, value_json) values
  ('trial', '{"enabled": true, "credits": 30, "days": 7, "require_phone": false}'),
  ('billing', '{"mode": "disabled"}'),
  ('signup', '{"enabled": true}'),
  ('maintenance', '{"banner": ""}'),
  ('features', '{"image": true, "carousel": true, "video": false, "analysis": true, "explore": true, "team": true}'),
  ('limits', '{"worker_global_concurrency": 6, "daily_provider_budget_usd": 20}');

create table public.integration_status (
  provider text primary key check (provider in ('gemini','higgsfield','elevenlabs','email','captcha','sms','supabase','storage')),
  status text not null default 'unconfigured' check (status in ('unconfigured','configured','verified','error')),
  last_verified_at timestamptz,
  last_error text,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.integration_status enable row level security;
revoke all on public.integration_status from anon, authenticated;
grant select, insert, update on public.integration_status to service_role;
insert into public.integration_status(provider) values ('gemini'),('higgsfield'),('elevenlabs'),('email'),('captcha'),('sms'),('supabase'),('storage');

-- ---------------------------------------------------------------- 동의 기록 / 체험 지급
create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  policy_type text not null check (policy_type in ('terms','privacy','marketing')),
  version text not null,
  accepted boolean not null default true,
  created_at timestamptz not null default now()
);
create index consent_user_idx on public.consent_records(user_id, policy_type, created_at desc);
alter table public.consent_records enable row level security;
create policy consent_sel on public.consent_records for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.consent_records from anon, authenticated;
grant select on public.consent_records to authenticated;
grant select, insert on public.consent_records to service_role;

create table public.trial_redemptions (
  user_id uuid primary key references auth.users(id) on delete cascade,        -- 계정당 1회
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade, -- 워크스페이스당 1회
  grant_key text not null unique,
  policy_version int not null default 1,
  created_at timestamptz not null default now()
);
alter table public.trial_redemptions enable row level security;
create policy trial_sel on public.trial_redemptions for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.trial_redemptions from anon, authenticated;
grant select on public.trial_redemptions to authenticated;
grant select on public.trial_redemptions to service_role;

-- 체험 지급: 자격 기록 고유성 → 버킷(만료 7일) → 원장이 한 트랜잭션. 동시 20요청이어도 1번만 지급.
create or replace function private.claim_trial(p_ws uuid, p_user uuid, p_credits bigint, p_days int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare gk text := 'trial:' || p_user;
begin
  perform 1 from public.wallet_accounts where workspace_id = p_ws for update;
  if not found then raise exception 'wallet_not_found'; end if;
  if not exists (select 1 from public.memberships where workspace_id = p_ws and user_id = p_user and role = 'owner' and status = 'active') then
    raise exception 'not_workspace_owner' using errcode = 'P0001';
  end if;
  begin
    insert into public.trial_redemptions(user_id, workspace_id, grant_key) values (p_user, p_ws, gk);
  exception when unique_violation then
    return false;                                                -- 이미 받음
  end;
  perform private.grant_credits(p_ws, p_credits, gk, 'trial', 'trial', now() + make_interval(days => p_days));
  return true;
end $$;
revoke all on function private.claim_trial(uuid, uuid, bigint, int) from public, anon, authenticated;
grant execute on function private.claim_trial(uuid, uuid, bigint, int) to service_role;
create or replace function public.svc_claim_trial(p_ws uuid, p_user uuid, p_credits bigint, p_days int)
returns boolean language sql as $$ select private.claim_trial(p_ws, p_user, p_credits, p_days) $$;
revoke all on function public.svc_claim_trial(uuid, uuid, bigint, int) from public, anon, authenticated;
grant execute on function public.svc_claim_trial(uuid, uuid, bigint, int) to service_role;

-- ---------------------------------------------------------------- 팀 초대
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('admin','editor','viewer')),
  token_hash text not null unique,                                -- 토큰 원문은 저장하지 않는다
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_pending_uidx on public.invitations(workspace_id, email) where status = 'pending';
create index invitations_ws_idx on public.invitations(workspace_id, created_at desc);
alter table public.invitations enable row level security;
create policy inv_sel on public.invitations for select to authenticated
  using (exists (select 1 from public.memberships m where m.workspace_id = invitations.workspace_id and m.user_id = (select auth.uid())
          and m.status = 'active' and m.role in ('owner','admin')));
revoke all on public.invitations from anon, authenticated;
grant select on public.invitations to authenticated;
grant select, insert, update on public.invitations to service_role;

-- 좌석 한도(미수락 유효 초대 포함)를 지키며 초대 생성
create or replace function private.create_invitation(p_ws uuid, p_email text, p_role text, p_token_hash text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare seats numeric; used bigint; iid uuid;
begin
  perform 1 from public.workspaces where id = p_ws for update;
  if not exists (select 1 from public.memberships where workspace_id = p_ws and user_id = p_actor and status = 'active' and role in ('owner','admin')) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  update public.invitations set status = 'expired' where workspace_id = p_ws and status = 'pending' and expires_at <= now();
  select (limits ->> 'seats')::numeric into seats from private.current_plan(p_ws);
  select (select count(*) from public.memberships where workspace_id = p_ws and status = 'active')
       + (select count(*) from public.invitations where workspace_id = p_ws and status = 'pending') into used;
  if seats is not null and used >= seats then raise exception 'plan_limit_exceeded:seats' using errcode = 'P0001'; end if;
  insert into public.invitations(workspace_id, email, role, token_hash, invited_by) values (p_ws, lower(p_email), p_role, p_token_hash, p_actor) returning id into iid;
  return iid;
end $$;

-- 수락: 토큰 해시 + 로그인 이메일 일치 + 만료/상태 + 좌석 재검사. 한 번만 수락된다.
create or replace function private.accept_invitation(p_token_hash text, p_user uuid, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invitations; seats numeric; used bigint;
begin
  select * into inv from public.invitations where token_hash = p_token_hash for update;
  if not found then raise exception 'invitation_not_found' using errcode = 'P0001'; end if;
  perform 1 from public.workspaces where id = inv.workspace_id for update;
  if inv.status <> 'pending' then raise exception 'invitation_not_pending' using errcode = 'P0001'; end if;
  if inv.expires_at <= now() then
    update public.invitations set status = 'expired' where id = inv.id;
    raise exception 'invitation_expired' using errcode = 'P0001';
  end if;
  if lower(p_email) <> inv.email then raise exception 'invitation_email_mismatch' using errcode = 'P0001'; end if;
  select (limits ->> 'seats')::numeric into seats from private.current_plan(inv.workspace_id);
  select count(*) into used from public.memberships where workspace_id = inv.workspace_id and status = 'active' and user_id <> p_user;
  if seats is not null and used >= seats then raise exception 'plan_limit_exceeded:seats' using errcode = 'P0001'; end if;
  insert into public.memberships(workspace_id, user_id, role) values (inv.workspace_id, p_user, inv.role)
  on conflict (workspace_id, user_id) do update set role = excluded.role, status = 'active';
  update public.invitations set status = 'accepted', accepted_by = p_user, accepted_at = now() where id = inv.id;
  return inv.workspace_id;
end $$;

-- 멤버 권한 변경/퇴출: 마지막 owner 보호
create or replace function private.change_member(p_ws uuid, p_user uuid, p_actor uuid, p_role text, p_remove boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; target public.memberships; owners bigint;
begin
  perform 1 from public.workspaces where id = p_ws for update;
  select role into actor_role from public.memberships where workspace_id = p_ws and user_id = p_actor and status = 'active';
  if actor_role not in ('owner','admin') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  select * into target from public.memberships where workspace_id = p_ws and user_id = p_user and status = 'active';
  if not found then raise exception 'member_not_found' using errcode = 'P0001'; end if;
  if target.role = 'owner' and actor_role <> 'owner' then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if p_role = 'owner' or (not p_remove and p_role is null) then raise exception 'invalid_role' using errcode = 'P0001'; end if;
  if target.role = 'owner' then
    select count(*) into owners from public.memberships where workspace_id = p_ws and role = 'owner' and status = 'active';
    if owners <= 1 then raise exception 'last_owner' using errcode = 'P0001'; end if;
  end if;
  if p_remove then
    update public.memberships set status = 'removed' where workspace_id = p_ws and user_id = p_user;
  else
    update public.memberships set role = p_role where workspace_id = p_ws and user_id = p_user;
  end if;
end $$;

revoke all on function private.create_invitation(uuid, text, text, text, uuid), private.accept_invitation(text, uuid, text),
  private.change_member(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function private.create_invitation(uuid, text, text, text, uuid), private.accept_invitation(text, uuid, text),
  private.change_member(uuid, uuid, uuid, text, boolean) to service_role;
create or replace function public.svc_create_invitation(p_ws uuid, p_email text, p_role text, p_token_hash text, p_actor uuid)
returns uuid language sql as $$ select private.create_invitation(p_ws, p_email, p_role, p_token_hash, p_actor) $$;
create or replace function public.svc_accept_invitation(p_token_hash text, p_user uuid, p_email text)
returns uuid language sql as $$ select private.accept_invitation(p_token_hash, p_user, p_email) $$;
create or replace function public.svc_change_member(p_ws uuid, p_user uuid, p_actor uuid, p_role text, p_remove boolean)
returns void language sql as $$ select private.change_member(p_ws, p_user, p_actor, p_role, p_remove) $$;
revoke all on function public.svc_create_invitation(uuid, text, text, text, uuid), public.svc_accept_invitation(text, uuid, text),
  public.svc_change_member(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.svc_create_invitation(uuid, text, text, text, uuid), public.svc_accept_invitation(text, uuid, text),
  public.svc_change_member(uuid, uuid, uuid, text, boolean) to service_role;

-- 서버가 팀·운영 화면에서 읽는 테이블 권한
grant select on public.memberships, public.workspaces, public.wallet_accounts, public.credit_ledger to service_role;
grant select, insert, update on public.workspaces to service_role;

-- 알림 중복 방지용 삽입 헬퍼 (같은 event_key는 무시)
create or replace function public.svc_notify(p_user uuid, p_ws uuid, p_event_key text, p_kind text, p_title text, p_body text, p_link text)
returns void language sql as $$
  insert into public.notifications(user_id, workspace_id, event_key, kind, title, body, link) values (p_user, p_ws, p_event_key, p_kind, p_title, p_body, p_link)
  on conflict (user_id, event_key) do nothing
$$;
revoke all on function public.svc_notify(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_notify(uuid, uuid, text, text, text, text, text) to service_role;
