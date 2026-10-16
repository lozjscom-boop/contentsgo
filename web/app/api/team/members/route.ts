import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

const Body = z.object({ userId: z.string().uuid(), role: z.enum(["owner", "admin", "editor", "viewer"]).optional(), remove: z.boolean().default(false) })
  .refine((b) => b.remove || b.role, "role 또는 remove 가 필요해요");

/** 멤버 역할 변경/제거. 마지막 소유자 보호·권한 검사는 DB 함수가 한 트랜잭션에서 처리한다. */
export const PATCH = route("team.member", async (req) => {
  const b = await parseBody(req, Body);
  const { user, workspaceId, canManage } = await requireWorkspace();
  if (!canManage) throw new DomainError("forbidden", 403, "관리 권한이 필요해요.");
  const { error } = await createAdminSupabase().rpc("svc_change_member", { p_ws: workspaceId, p_user: b.userId, p_actor: user.id, p_role: b.role ?? null, p_remove: b.remove });
  raise(error);
  await audit({ workspaceId, actorId: user.id, action: b.remove ? "team.remove" : "team.role", targetType: "user", targetId: b.userId, detail: { role: b.role } });
  return json({ ok: true });
});
