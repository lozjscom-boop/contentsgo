-- ===== 20261016000001_init_core.sql =====
-- 컨텐츠고 1차 스키마: 기획(제품핵심→컨셉→훅/내용/전환) + 제작(이미지/캐러셀/영상)
-- 기준: contentsgo_blueprint_v1.5 9장을 1차 범위로 축소. 성과/팀초대/결제/탐색 수집은 제외.
-- 원칙: 모든 고객 테이블에 workspace_id, 복합 FK로 타 워크스페이스 참조 차단, RLS는 활성 membership 기준.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- tenancy
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')),
  status text not null default 'active' check (status in ('active','removed','suspended')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id) where status = 'active';

-- 권한 판단용 헬퍼: user_metadata가 아니라 DB의 활성 membership만 근거로 사용
create or replace function private.is_member(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and m.status = 'active' and w.status = 'active'
  );
$$;

create or replace function private.can_edit(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and m.status = 'active' and w.status = 'active'
      and m.role in ('owner','admin','editor')
  );
$$;

revoke all on function private.is_member(uuid), private.can_edit(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_member(uuid), private.can_edit(uuid) to authenticated;

-- 가입 시 개인 워크스페이스 1개 자동 생성 (1차: 1인 1워크스페이스)
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  insert into public.workspaces(name, owner_id)
  values (coalesce(split_part(new.email,'@',1),'내 워크스페이스'), new.id)
  returning id into ws;
  insert into public.memberships(workspace_id, user_id, role) values (ws, new.id, 'owner');
  insert into public.wallet_accounts(workspace_id) values (ws);
  return new;
end $$;

-- ---------------------------------------------------------------- 브랜드/제품/자산
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  tone_json jsonb not null default '{}',          -- 말투, 금지어, 톤 (스키마 버전 포함)
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('product_photo','reference','generated_image','generated_video','audio','export')),
  object_key text not null unique,               -- Storage 경로. 공급사 임시 URL을 저장하지 않는다
  mime text not null,
  bytes bigint not null check (bytes >= 0),
  sha256 text,
  status text not null default 'pending' check (status in ('pending','ready','failed','deleted')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index assets_ws_idx on public.assets(workspace_id, created_at desc, id);
create index assets_hash_idx on public.assets(workspace_id, sha256);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null,
  name text not null,
  category text,
  facts_json jsonb not null default '{}',        -- 성분/스펙/가격/증거 등 사용자가 확인한 사실
  forbidden_claims text[] not null default '{}', -- 쓰면 안 되는 표현(의료적 효능 등)
  main_image_asset_id uuid,
  status text not null default 'active' check (status in ('active','archived')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, brand_id) references public.brands(workspace_id, id),
  foreign key (workspace_id, main_image_asset_id) references public.assets(workspace_id, id)
);
create index products_brand_idx on public.products(workspace_id, brand_id, status, created_at desc, id);

-- ---------------------------------------------------------------- 기획 (본체)
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null,
  product_id uuid not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft','planning','producing','done','archived')),
  version int not null default 1,
  thumbnail_asset_id uuid,
  deliverable_count int not null default 0,      -- 목록 projection: JOIN 없이 표시
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, brand_id) references public.brands(workspace_id, id),
  foreign key (workspace_id, product_id) references public.products(workspace_id, id),
  foreign key (workspace_id, thumbnail_asset_id) references public.assets(workspace_id, id)
);
create index projects_list_idx on public.projects(workspace_id, status, updated_at desc, id desc);

-- ① 제품 핵심 파악: 질문-답변 + AI가 정리한 핵심 포인트
create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  version int not null default 1,
  answers_json jsonb not null default '{}',      -- 구매 순간/망설임 이유/증거/한 장면으로 보여준다면
  core_points_json jsonb not null default '[]',  -- 정리된 제품 핵심 포인트(출처 답변 연결)
  status text not null default 'draft' check (status in ('draft','confirmed')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (project_id, version),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade
);

-- ② 소구/컨셉 후보(3안) + 선택
create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  brief_id uuid not null,
  title text not null,
  appeal text not null,                          -- 핵심 소구
  rationale text not null,                       -- 왜 이 컨셉인지(근거)
  visual_hook text,                              -- 제품 핵심 포인트를 번역한 한 장면
  body_type text,                                -- 후기형/상황극형/정보형 등 (유형 라이브러리 코드)
  status text not null default 'proposed' check (status in ('proposed','selected','rejected')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade,
  foreign key (workspace_id, brief_id) references public.briefs(workspace_id, id)
);
create index concepts_project_idx on public.concepts(workspace_id, project_id, status);

-- ③ 훅 / 내용 / 전환 독립 부품 (조합 가능, 나중에 성과를 부품 단위로 연결)
create table public.parts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  concept_id uuid not null,
  stage text not null check (stage in ('hook','body','cta')),
  label text not null,                           -- 부품 유형 태그(예: sniff_neck, closeup_color)
  content_json jsonb not null,                   -- 대사/자막/장면 설명/길이
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade,
  foreign key (workspace_id, concept_id) references public.concepts(workspace_id, id) on delete cascade
);
create index parts_concept_idx on public.parts(workspace_id, concept_id, stage);

-- ---------------------------------------------------------------- 제작물
create table public.deliverables (
  id uuid primary key default gen_random_uuid(),  -- 제작물 ID: 나중에 메타고/틱톡고 성과와 연결하는 고리
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  concept_id uuid,
  type text not null check (type in ('image','carousel','video')),
  status text not null default 'draft' check (status in ('draft','queued','generating','review','ready','failed','archived')),
  tags_json jsonb not null default '{}',          -- {appeal, hook_label, body_label, cta_label, trend_keywords[]}
  hook_part_id uuid,
  body_part_id uuid,
  cta_part_id uuid,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade,
  foreign key (workspace_id, concept_id) references public.concepts(workspace_id, id),
  foreign key (workspace_id, hook_part_id) references public.parts(workspace_id, id),
  foreign key (workspace_id, body_part_id) references public.parts(workspace_id, id),
  foreign key (workspace_id, cta_part_id) references public.parts(workspace_id, id)
);
create index deliverables_project_idx on public.deliverables(workspace_id, project_id, updated_at desc, id desc);

create table public.creative_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  deliverable_id uuid not null,
  version int not null,
  parent_id uuid,
  document_json jsonb not null,                   -- 슬라이드/장면 구성 전체(스키마 버전 포함)
  schema_version int not null default 1,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (deliverable_id, version),
  foreign key (workspace_id, deliverable_id) references public.deliverables(workspace_id, id) on delete cascade
);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  creative_version_id uuid not null,
  scene_key text not null,                        -- 슬라이드 번호 또는 장면 번호
  role text not null check (role in ('hook','brand_line','body','cta')),
  spec_json jsonb not null default '{}',          -- 문구/프롬프트/길이/카메라 등
  asset_id uuid,
  status text not null default 'pending' check (status in ('pending','generating','ready','failed')),
  created_at timestamptz not null default now(),
  unique (creative_version_id, scene_key),
  foreign key (workspace_id, creative_version_id) references public.creative_versions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, asset_id) references public.assets(workspace_id, id)
);

-- ---------------------------------------------------------------- 생성 작업 / 크레딧
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  deliverable_id uuid not null,
  kind text not null check (kind in ('plan','image','video','render')),
  status text not null default 'queued' check (status in ('queued','running','provider_unknown','review','ready','failed','cancelled')),
  state_version int not null default 0,           -- compare-and-swap용
  request_key text not null,                      -- 중복 제출 방지
  estimated_credits bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, request_key),
  foreign key (workspace_id, deliverable_id) references public.deliverables(workspace_id, id)
);
create index jobs_queue_idx on public.jobs(status, created_at) where status in ('queued','running','provider_unknown');

create table public.generation_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null,
  scene_id uuid,
  attempt_no int not null,
  provider text not null,
  model_id text not null,
  provider_request_id text,
  usd_micros bigint not null default 0,           -- 공급사 실비(마이크로달러 정수)
  status text not null default 'submitted' check (status in ('submitted','succeeded','failed','unknown')),
  error text,
  created_at timestamptz not null default now(),
  unique (job_id, scene_id, attempt_no),
  foreign key (workspace_id, job_id) references public.jobs(workspace_id, id) on delete cascade
);
create unique index attempts_provider_req_uidx on public.generation_attempts(provider, provider_request_id) where provider_request_id is not null;

create table public.wallet_accounts (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  available bigint not null default 0 check (available >= 0),
  reserved bigint not null default 0 check (reserved >= 0),
  version int not null default 0,
  updated_at timestamptz not null default now()
);

-- append-only: 수정/삭제는 트리거로 차단
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_key text not null unique,                 -- 동일 이벤트는 한 번만 기록
  type text not null check (type in ('GRANT','RESERVE','CAPTURE','RELEASE','ADJUST')),
  amount bigint not null,
  job_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index ledger_ws_idx on public.credit_ledger(workspace_id, created_at desc);

create or replace function private.ledger_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'credit_ledger is append-only'; end $$;
create trigger credit_ledger_no_update before update or delete on public.credit_ledger
for each row execute function private.ledger_immutable();

-- 크레딧 지급(관리자 수동 지급용). 서버(service_role)에서만 호출.
create or replace function private.grant_credits(p_ws uuid, p_amount bigint, p_event_key text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  insert into public.credit_ledger(workspace_id, event_key, type, amount, note)
  values (p_ws, p_event_key, 'GRANT', p_amount, p_note);   -- 중복 event_key면 unique 위반으로 중단
  update public.wallet_accounts set available = available + p_amount, version = version + 1, updated_at = now()
  where workspace_id = p_ws;
end $$;
revoke all on function private.grant_credits(uuid, bigint, text, text) from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------- updated_at
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['workspaces','brands','products','projects','deliverables','jobs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()', t||'_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS
do $$ declare t text; begin
  foreach t in array array['workspaces','memberships','brands','assets','products','projects','briefs','concepts','parts',
                           'deliverables','creative_versions','scenes','jobs','generation_attempts','wallet_accounts','credit_ledger'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 조회: 활성 멤버
create policy ws_select on public.workspaces for select to authenticated using (private.is_member(id));
create policy mem_select on public.memberships for select to authenticated using (user_id = (select auth.uid()) or private.is_member(workspace_id));

-- 편집 가능 테이블: 조회=멤버, 쓰기=owner/admin/editor
do $$ declare t text; begin
  foreach t in array array['brands','assets','products','projects','briefs','concepts','parts','deliverables','creative_versions','scenes'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_member(workspace_id))', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.can_edit(workspace_id))', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.can_edit(workspace_id)) with check (private.can_edit(workspace_id))', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.can_edit(workspace_id))', t||'_del', t);
  end loop;
end $$;

-- 작업/원장/지갑: 멤버는 조회만. 변경은 서버 경로(service_role)로만.
create policy jobs_sel on public.jobs for select to authenticated using (private.is_member(workspace_id));
create policy attempts_sel on public.generation_attempts for select to authenticated using (private.is_member(workspace_id));
create policy wallet_sel on public.wallet_accounts for select to authenticated using (private.is_member(workspace_id));
create policy ledger_sel on public.credit_ledger for select to authenticated using (private.is_member(workspace_id));

-- ---------------------------------------------------------------- GRANT (자동 노출을 전제하지 않고 명시)
revoke all on all tables in schema public from anon, authenticated;
grant select on public.workspaces, public.memberships to authenticated;
grant select, insert, update, delete on public.brands, public.assets, public.products, public.projects, public.briefs,
  public.concepts, public.parts, public.deliverables, public.creative_versions, public.scenes to authenticated;
grant select on public.jobs, public.generation_attempts, public.wallet_accounts, public.credit_ledger to authenticated;

-- ===== 20261016000002_credit_reservations.sql =====
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

-- ===== 20261016000003_storage_supabase_only.sql =====
-- 제작물 보관용 private 버킷. 업로드는 서버(service_role)만, 조회는 서명 URL로만.
-- 경로 규칙: {workspace_id}/{deliverable_id}/{파일명}
insert into storage.buckets (id, name, public, file_size_limit)
values ('creatives', 'creatives', false, 524288000)   -- 500MB
on conflict (id) do nothing;

-- 브라우저(authenticated)는 자기 워크스페이스 폴더의 파일만 읽기 가능. 쓰기/삭제 정책은 만들지 않는다(서버 전용).
create policy creatives_read on storage.objects for select to authenticated
using (
  bucket_id = 'creatives'
  and private.is_member(((storage.foldername(name))[1])::uuid)
);

-- ===== 20261016000004_library_analysis.sql =====
-- 컨텐츠 탐색(참고 광고 저장) + 영상 분석 결과 + 자산 경로 안전장치

-- assets.object_key 는 반드시 자기 워크스페이스 폴더 아래여야 한다 (다른 테넌트 파일 경로를 끼워넣어 서명 URL을 받는 공격 차단)
alter table public.assets add constraint assets_key_prefix check (object_key like workspace_id::text || '/%');

-- 탐색: 타 브랜드 광고 링크/영상 저장
create table public.reference_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  url text,
  platform text not null default 'other' check (platform in ('meta','tiktok','instagram','youtube','other')),
  notes text not null default '',
  tags text[] not null default '{}',
  asset_id uuid,                                  -- 직접 올린 영상 파일 (assets.kind='reference')
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, asset_id) references public.assets(workspace_id, id)
);
create index reference_items_ws_created on public.reference_items (workspace_id, created_at desc);

-- 영상 분석 결과 (서버가 작성, 멤버는 조회)
create table public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  asset_id uuid not null,
  reference_item_id uuid,
  status text not null default 'analyzing' check (status in ('analyzing','done','failed')),
  result_json jsonb,
  error text,
  model_id text,
  request_key text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, request_key),
  foreign key (workspace_id, asset_id) references public.assets(workspace_id, id),
  foreign key (workspace_id, reference_item_id) references public.reference_items(workspace_id, id) on delete set null (reference_item_id)
);
create index video_analyses_ws_created on public.video_analyses (workspace_id, created_at desc);

alter table public.reference_items enable row level security;
alter table public.video_analyses enable row level security;

create policy reference_items_sel on public.reference_items for select to authenticated using (private.is_member(workspace_id));
create policy reference_items_ins on public.reference_items for insert to authenticated with check (private.can_edit(workspace_id));
create policy reference_items_upd on public.reference_items for update to authenticated using (private.can_edit(workspace_id)) with check (private.can_edit(workspace_id));
create policy reference_items_del on public.reference_items for delete to authenticated using (private.can_edit(workspace_id));
create policy video_analyses_sel on public.video_analyses for select to authenticated using (private.is_member(workspace_id));

create trigger reference_items_touch before update on public.reference_items for each row execute function private.touch_updated_at();
create trigger video_analyses_touch before update on public.video_analyses for each row execute function private.touch_updated_at();

revoke all on public.reference_items, public.video_analyses from anon, authenticated;
grant select, insert, update, delete on public.reference_items to authenticated;
grant select on public.video_analyses to authenticated;
grant select, insert, update on public.reference_items, public.video_analyses to service_role;
grant delete on public.reference_items to service_role;

-- ===== 20261016000005_plans_credit_buckets.sql =====
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
 ('trial',   1, '체험',    0,      0,    '{"brands":1,"products":1,"seats":1,"storage_gb":0.5,"concurrent_jobs":1,"pending_jobs":1,"exports_month":3,"proposals_month":1,"trial_credits":30,"trial_days":7}', 'published', now()),
 ('starter', 1, 'Starter', 49000,  500,  '{"brands":1,"products":5,"seats":1,"storage_gb":10,"concurrent_jobs":1,"pending_jobs":5,"exports_month":100,"proposals_month":10}',  'published', now()),
 ('growth',  1, 'Growth',  99000,  1100, '{"brands":5,"products":30,"seats":3,"storage_gb":50,"concurrent_jobs":2,"pending_jobs":15,"exports_month":300,"proposals_month":30}', 'published', now()),
 ('studio',  1, 'Studio',  199000, 2300, '{"brands":20,"products":150,"seats":10,"storage_gb":150,"concurrent_jobs":4,"pending_jobs":30,"exports_month":800,"proposals_month":60}', 'published', now());

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

-- ===== 20261016000006_job_queue.sql =====
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

-- ===== 20261016000007_platform_ops.sql =====
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

