import { route, json } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

export const DELETE = route("team.invite.revoke", async (_req, ctx) => {
  const { id } = await ctx.params;
  const { user, workspaceId, canManage } = await requireWorkspace();
  if (!canManage) throw new DomainError("forbidden", 403, "관리 권한이 필요해요.");
  const { error } = await createAdminSupabase().from("invitations").update({ status: "revoked" }).eq("id", id).eq("workspace_id", workspaceId).eq("status", "pending");
  raise(error);
  await audit({ workspaceId, actorId: user.id, action: "team.invite_revoke", targetType: "invitation", targetId: id });
  return json({ ok: true });
});
