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
