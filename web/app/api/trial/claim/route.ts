import { route, json } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";

/** 체험 크레딧 받기: 이메일 인증을 마친 계정이 워크스페이스당·계정당 1회만 받을 수 있다. */
export const POST = route("trial.claim", async () => {
  const { user, workspaceId, role } = await requireWorkspace();
  if (role !== "owner") throw new DomainError("forbidden", 403, "소유자만 받을 수 있어요.");
  const cfg = await getSetting<{ enabled: boolean; credits: number; days: number }>("trial");
  if (!cfg.enabled) throw new DomainError("disabled", 403, "지금은 체험 크레딧 지급을 하지 않아요.");
  if (!user.email_confirmed_at) throw new DomainError("email_unverified", 403, "이메일 인증을 마친 뒤 받을 수 있어요.");
  const { data, error } = await createAdminSupabase().rpc("svc_claim_trial", { p_ws: workspaceId, p_user: user.id, p_credits: cfg.credits, p_days: cfg.days });
  raise(error);
  if (data !== true) throw new DomainError("already_claimed", 409, "이미 체험 크레딧을 받았어요.");
  await audit({ workspaceId, actorId: user.id, action: "trial.claim", targetType: "workspace", targetId: workspaceId, detail: { credits: cfg.credits } });
  return json({ granted: cfg.credits, days: cfg.days });
});
