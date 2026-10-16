import "server-only";
import { createServerSupabase } from "./supabase/server";

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

/** 로그인 사용자 + 편집 가능한 워크스페이스를 확인한다. admin 클라이언트를 쓰기 전에 반드시 호출. */
export async function requireWorkspace(workspaceId?: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new AuthError(401, "로그인이 필요합니다");

  let q = supabase.from("memberships").select("workspace_id, role").eq("user_id", data.user.id).eq("status", "active");
  if (workspaceId) q = q.eq("workspace_id", workspaceId);
  const { data: rows, error: mErr } = await q.limit(1);
  if (mErr || !rows?.length) throw new AuthError(403, "워크스페이스 권한이 없습니다");
  const m = rows[0];
  return { supabase, user: data.user, workspaceId: m.workspace_id as string, role: m.role as string, canEdit: ["owner", "admin", "editor"].includes(m.role as string) };
}
