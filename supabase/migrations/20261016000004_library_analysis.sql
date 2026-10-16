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
