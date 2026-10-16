import { after } from "next/server";
import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { sceneImagePrice } from "@/lib/credits";
import { enqueueJob } from "@/lib/jobs/queue";
import { runWorker } from "@/lib/jobs/runner";
import { featureEnabled } from "@/lib/settings";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { DeliverableDocument } from "@/lib/planning/schemas";

export const maxDuration = 300;
const Body = z.object({ requestKey: z.string().min(8).max(100) });

/** 접수만 한다(202): 크레딧 예약 + 작업 생성. 실제 생성은 응답 뒤(after)와 스위퍼가 처리한다. */
export const POST = route("scene.generate", async (req, ctx) => {
  const { id: sceneId } = await ctx.params;
  const { requestKey } = await parseBody(req, Body);
  const auth = await requireWorkspace();
  if (!auth.canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");

  // 사용자 권한(RLS)으로 읽히는 장면 = 내 워크스페이스의 장면
  const { data: scene } = await auth.supabase.from("scenes").select("id, workspace_id, creative_version_id, status").eq("id", sceneId).maybeSingle();
  if (!scene || scene.workspace_id !== auth.workspaceId) throw new DomainError("not_found", 404, "장면을 찾을 수 없어요.");
  const { data: ver } = await auth.supabase.from("creative_versions").select("deliverable_id, document_json").eq("id", scene.creative_version_id).single();
  if (!ver) throw new DomainError("not_found", 404, "제작 버전을 찾을 수 없어요.");
  const doc = DeliverableDocument.parse(ver.document_json);
  if (!(await featureEnabled(doc.type))) throw new DomainError("feature_disabled", 503, "지금은 이 기능을 쓸 수 없어요.");

  const price = sceneImagePrice(doc.type);
  const { jobId, created, status } = await enqueueJob({
    workspaceId: auth.workspaceId, kind: "image", deliverableId: ver.deliverable_id, requestKey: `scene:${sceneId}:${requestKey}`,
    payload: { sceneId, userId: auth.user.id }, credits: price,
  });
  if (created) {
    await createAdminSupabase().from("scenes").update({ status: "generating" }).eq("id", sceneId).eq("workspace_id", auth.workspaceId);
    after(async () => { await runWorker({ kinds: ["image"] }).catch((e) => console.error(JSON.stringify({ level: "error", msg: "after_worker_failed", error: String(e?.message).slice(0, 200) }))); });
  }
  return json({ jobId, status, charged: price }, 202);
});
