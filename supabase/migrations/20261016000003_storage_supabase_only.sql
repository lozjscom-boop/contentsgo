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
