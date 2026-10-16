import { after } from "next/server";
import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";
import { CREDIT_PRICES } from "@/lib/credits";
import { enqueueJob } from "@/lib/jobs/queue";
import { runWorker } from "@/lib/jobs/runner";
import { featureEnabled } from "@/lib/settings";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const maxDuration = 300;
const Body = z.object({ assetId: z.string().uuid(), referenceItemId: z.string().uuid().optional(), requestKey: z.string().min(8).max(100) });

export const POST = route("analysis.create", async (req) => {
  const { assetId, referenceItemId, requestKey } = await parseBody(req, Body);
  const auth = await requireWorkspace();
  if (!auth.canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");
  if (!(await featureEnabled("analysis"))) throw new DomainError("feature_disabled", 503, "지금은 영상 분석을 쓸 수 없어요.");

  const { data: asset } = await auth.supabase.from("assets").select("id, kind, object_key").eq("id", assetId).maybeSingle();
  if (!asset || asset.kind !== "reference" || !asset.object_key.startsWith(`${auth.workspaceId}/`)) throw new DomainError("not_found", 404, "영상을 찾을 수 없어요.");

  const admin = createAdminSupabase();
  const price = CREDIT_PRICES.video_analysis;
  // 같은 요청 키는 같은 분석을 돌려준다 (더블클릭/재시도)
  const existing = await admin.from("video_analyses").select("id").eq("workspace_id", auth.workspaceId).eq("request_key", requestKey).maybeSingle();
  if (existing.error) raise(existing.error);
  let analysisId = existing.data?.id as string | undefined;
  if (!analysisId) {
    const ins = await admin.from("video_analyses").insert({ workspace_id: auth.workspaceId, asset_id: assetId, reference_item_id: referenceItemId ?? null, status: "analyzing", request_key: requestKey, created_by: auth.user.id }).select("id").single();
    if (ins.error) raise(ins.error);
    analysisId = ins.data!.id as string;
  }

  try {
    const { jobId, created } = await enqueueJob({
      workspaceId: auth.workspaceId, kind: "analysis", requestKey: `analysis:${analysisId}`,
      payload: { analysisId, assetId, userId: auth.user.id }, credits: price,
    });
    if (created) after(async () => { await runWorker({ kinds: ["analysis"] }).catch(() => undefined); });
    return json({ id: analysisId, jobId, charged: price }, 202);
  } catch (e) {
    await admin.from("video_analyses").delete().eq("id", analysisId).eq("workspace_id", auth.workspaceId).eq("status", "analyzing"); // 접수 실패 → 빈 기록 제거
    throw e;
  }
});
