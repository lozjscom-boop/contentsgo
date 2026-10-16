import { route, json } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

/** 베타 테스트 크레딧 1회 지급. BETA_GRANT_AMOUNT(1~5000)가 설정된 배포에서만 켜진다. 워크스페이스당 1회(event_key 멱등). */
export const POST = route("credits.beta", async () => {
  const amount = Number(process.env.BETA_GRANT_AMOUNT);
  if (!Number.isInteger(amount) || amount < 1 || amount > 5000) throw new DomainError("disabled", 404, "사용할 수 없어요.");
  const { workspaceId, role, user } = await requireWorkspace();
  if (role !== "owner") throw new DomainError("forbidden", 403, "소유자만 받을 수 있어요.");
  const admin = createAdminSupabase();
  const eventKey = `beta-grant:${workspaceId}`;
  const { data: prior } = await admin.from("credit_ledger").select("id").eq("workspace_id", workspaceId).eq("event_key", eventKey).maybeSingle();
  if (prior) throw new DomainError("already_granted", 409, "이미 지급받았어요.");
  const { error } = await admin.rpc("svc_grant_credits", { p_ws: workspaceId, p_amount: amount, p_event_key: eventKey, p_note: "베타 테스트 지급", p_source: "beta" });
  raise(error);
  await audit({ workspaceId, actorId: user.id, action: "credits.beta_grant", targetType: "workspace", targetId: workspaceId, detail: { amount } });
  return json({ granted: amount });
});
