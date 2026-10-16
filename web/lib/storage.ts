import "server-only";
import { createAdminSupabase } from "./supabase/admin";

export const BUCKET = "creatives";

export async function uploadCreative(path: string, bytes: Buffer, contentType: string) {
  const { error } = await createAdminSupabase().storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`저장소 업로드 실패: ${error.message}`);
}

/** 서명 URL(기본 1시간). 호출 전에 사용자 권한(RLS)으로 해당 행을 읽을 수 있는지 먼저 확인할 것. */
export async function signedUrls(paths: string[], opts: { download?: boolean } = {}) {
  if (!paths.length) return {} as Record<string, string>;
  const { data, error } = await createAdminSupabase().storage.from(BUCKET).createSignedUrls(paths, 3600, opts.download ? { download: true } : undefined);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl]));
}
