import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requirePlatformAdmin } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant"), workspaceId: z.string().uuid(), amount: z.number().int().min(1).max(100000), note: z.string().trim().min(2).max(200), expiresInDays: z.number().int().min(1).max(730).optional() }),
  z.object({ action: z.literal("revoke"), workspaceId: z.string().uuid(), bucketId: z.string().uuid(), amount: z.number().int().min(1).max(100000), note: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("set_plan"), workspaceId: z.string().uuid(), plan: z.enum(["trial", "starter", "growth", "studio"]), reason: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("resolve_job"), jobId: z.string().uuid(), outcome: z.enum(["failed", "ready"]), note: z.string().trim().min(2).max(300) }),
  z.object({ action: z.literal("ticket_reply"), ticketId: z.string().uuid(), body: z.string().trim().min(1).max(4000), internal: z.boolean().default(false) }),
  z.object({ action: z.literal("ticket_status"), ticketId: z.string().uuid(), status: z.enum(["open", "triaged", "waiting_customer", "in_progress", "resolved", "closed"]) }),
  z.object({ action: z.literal("setting"), key: z.enum(["trial", "billing", "signup", "maintenance", "features", "limits"]), value: z.record(z.string(), z.unknown()) }),
]);

const MONEY = ["owner", "billing"] as const;
const SUPPORT = ["owner", "support"] as const;

/** 운영자 작업 단일 진입점. 역할 검사 → DB 함수 호출 → 감사 기록 순서로 항상 처리한다. */
export const POST = route("ops.action", async (req) => {
  const a = await parseBody(req, Action);
  const roles = a.action === "grant" || a.action === "revoke" || a.action === "set_plan" ? MONEY
    : a.action === "ticket_reply" || a.action === "ticket_status" || a.action === "resolve_job" ? SUPPORT : (["owner"] as const);
  const { user } = await requirePlatformAdmin([...roles]);
  const admin = createAdminSupabase();
  const nonce = crypto.randomUUID();
  let ws: string | undefined;

  switch (a.action) {
    case "grant": {
      ws = a.workspaceId;
      const exp = a.expiresInDays ? new Date(Date.now() + a.expiresInDays * 864e5).toISOString() : null;
      raise((await admin.rpc("svc_grant_credits", { p_ws: a.workspaceId, p_amount: a.amount, p_event_key: `ops-grant:${nonce}`, p_note: a.note, p_source: "admin", p_expires_at: exp })).error);
      break;
    }
    case "revoke": {
      ws = a.workspaceId;
      raise((await admin.rpc("svc_revoke_credits", { p_ws: a.workspaceId, p_bucket: a.bucketId, p_amount: a.amount, p_event_key: `ops-revoke:${nonce}`, p_note: a.note })).error);
      break;
    }
    case "set_plan": {
      ws = a.workspaceId;
      raise((await admin.rpc("svc_set_plan", { p_ws: a.workspaceId, p_plan_code: a.plan, p_source: "beta_admin", p_reason: a.reason, p_actor: user.id })).error);
      break;
    }
    case "resolve_job": {
      raise((await admin.rpc("svc_resolve_unknown_job", { p_job: a.jobId, p_outcome: a.outcome, p_note: a.note })).error);
      break;
    }
    case "ticket_reply": {
      raise((await admin.from("support_messages").insert({ ticket_id: a.ticketId, author_id: user.id, author_kind: "staff", visibility: a.internal ? "internal" : "customer", body: a.body })).error);
      if (!a.internal) await admin.from("support_tickets").update({ status: "waiting_customer", updated_at: new Date().toISOString() }).eq("id", a.ticketId);
      break;
    }
    case "ticket_status": {
      raise((await admin.from("support_tickets").update({ status: a.status, updated_at: new Date().toISOString() }).eq("id", a.ticketId)).error);
      break;
    }
    case "setting": {
      raise((await admin.from("site_settings").upsert({ key: a.key, value_json: a.value, updated_by: user.id, updated_at: new Date().toISOString() })).error);
      break;
    }
    default:
      throw new DomainError("invalid_input", 400, "알 수 없는 작업이에요.");
  }
  const { action, ...detail } = a;
  await audit({ workspaceId: ws, actorId: user.id, kind: "admin", action: `ops.${action}`, targetType: "ops", detail: detail as Record<string, unknown> });
  return json({ ok: true });
});
