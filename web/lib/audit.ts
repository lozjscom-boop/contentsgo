import "server-only";
import { createAdminSupabase } from "./supabase/admin";

/** 감사 기록(append-only). 실패해도 본 작업을 막지 않지만 로그는 남긴다. 비밀값·원문 프롬프트는 detail에 넣지 않는다. */
export async function audit(e: {
  workspaceId?: string | null; actorId?: string | null; kind?: "user" | "admin" | "system";
  action: string; targetType?: string; targetId?: string; detail?: Record<string, unknown>; traceId?: string;
}) {
  try {
    const { error } = await createAdminSupabase().from("audit_events").insert({
      workspace_id: e.workspaceId ?? null, actor_id: e.actorId ?? null, actor_kind: e.kind ?? "user", action: e.action,
      target_type: e.targetType ?? null, target_id: e.targetId ?? null, detail: e.detail ?? {}, trace_id: e.traceId ?? null,
    });
    if (error) console.error(JSON.stringify({ level: "warn", msg: "audit_failed", action: e.action, error: error.message }));
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", msg: "audit_failed", action: e.action, error: (err as Error).message }));
  }
}
