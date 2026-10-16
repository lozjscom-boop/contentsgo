import "server-only";
import { cookies } from "next/headers";
import { createServerSupabase } from "./supabase/server";

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

export const WS_COOKIE = "cg_ws";
const EDIT_ROLES = ["owner", "admin", "editor"];

export type WorkspaceCtx = {
  supabase: Awaited<ReturnType<typeof createServerSupabase>>;
  user: { id: string; email?: string; email_confirmed_at?: string | null };
  workspaceId: string;
  role: string;
  canEdit: boolean;
  canManage: boolean; // owner/admin
};

/**
 * 로그인 사용자 + 워크스페이스 확인. admin(service_role) 클라이언트를 쓰기 전에 반드시 호출한다.
 * 워크스페이스 선택: 명시 인자 > 쿠키(cg_ws, 소속 재검증) > 가장 먼저 만든 소속.
 * 권한 근거는 항상 DB의 활성 membership이다 (쿠키·metadata를 신뢰하지 않음).
 */
export async function requireWorkspace(workspaceId?: string): Promise<WorkspaceCtx> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new AuthError(401, "로그인이 필요합니다");

  const { data: rows, error: mErr } = await supabase
    .from("memberships")
    .select("workspace_id, role, created_at")
    .eq("user_id", data.user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (mErr || !rows?.length) throw new AuthError(403, "워크스페이스 권한이 없습니다");

  let wanted = workspaceId;
  if (!wanted) {
    try { wanted = (await cookies()).get(WS_COOKIE)?.value; } catch { /* 쿠키 접근 불가 컨텍스트 */ }
  }
  const m = rows.find((r) => r.workspace_id === wanted) ?? (workspaceId ? undefined : rows[0]);
  if (!m) throw new AuthError(403, "워크스페이스 권한이 없습니다");
  const role = m.role as string;
  return {
    supabase,
    user: { id: data.user.id, email: data.user.email ?? undefined, email_confirmed_at: data.user.email_confirmed_at },
    workspaceId: m.workspace_id as string,
    role,
    canEdit: EDIT_ROLES.includes(role),
    canManage: role === "owner" || role === "admin",
  };
}

/** 로그인만 확인 (워크스페이스 불필요한 화면) */
export async function requireUser() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new AuthError(401, "로그인이 필요합니다");
  return { supabase, user: data.user };
}

/** 플랫폼 운영자(/ops). 고객 워크스페이스 권한과 별개이며 platform_admin_roles 의 활성 역할만 근거다. */
export async function requirePlatformAdmin(roles?: ("owner" | "billing" | "support" | "readonly")[]) {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("platform_admin_roles").select("role, status").eq("user_id", user.id).maybeSingle();
  if (!data || data.status !== "active" || (roles && !roles.includes(data.role as "owner"))) throw new AuthError(403, "운영자 권한이 없습니다");
  return { supabase, user, role: data.role as "owner" | "billing" | "support" | "readonly" };
}

export async function listMyWorkspaces() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("memberships")
    .select("role, workspaces(id, name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => {
    const w = r.workspaces as unknown as { id: string; name: string } | null;
    return { id: w?.id ?? "", name: w?.name ?? "", role: r.role as string };
  }).filter((w) => w.id);
}
