import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireUser } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { hashToken } from "../invitations/route";

/** 초대 수락: 로그인한 계정의 이메일이 초대 이메일과 같아야 한다. */
export const POST = route("team.accept", async (req) => {
  const { token } = await parseBody(req, z.object({ token: z.string().min(20).max(100) }));
  const { user } = await requireUser();
  if (!user.email) throw new DomainError("forbidden", 403, "이메일이 없는 계정이에요.");
  const { data, error } = await createAdminSupabase().rpc("svc_accept_invitation", { p_token_hash: hashToken(token), p_user: user.id, p_email: user.email });
  raise(error);
  await audit({ workspaceId: String(data), actorId: user.id, action: "team.accept", targetType: "workspace", targetId: String(data) });
  return json({ workspaceId: data });
});
