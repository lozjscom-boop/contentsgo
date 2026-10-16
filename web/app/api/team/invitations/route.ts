import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** 초대 만들기. 토큰 원문은 응답에서 한 번만 보여주고 DB 에는 해시만 저장한다 (이메일 발송 연동 전에는 링크를 직접 전달). */
export const POST = route("team.invite", async (req) => {
  const b = await parseBody(req, z.object({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(["admin", "editor", "viewer"]) }));
  const { user, workspaceId, canManage } = await requireWorkspace();
  if (!canManage) throw new DomainError("forbidden", 403, "관리 권한이 필요해요.");
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await createAdminSupabase().rpc("svc_create_invitation", { p_ws: workspaceId, p_email: b.email, p_role: b.role, p_token_hash: hashToken(token), p_actor: user.id });
  if (error && /invitations_pending_uidx|duplicate key/i.test(error.message)) throw new DomainError("already_invited", 409, "이미 초대한 이메일이에요.");
  raise(error);
  await audit({ workspaceId, actorId: user.id, action: "team.invite", targetType: "invitation", targetId: String(data), detail: { role: b.role } });
  const origin = new URL(req.url).origin;
  return json({ id: data, link: `${origin}/invite/${token}` }, 201);
});
