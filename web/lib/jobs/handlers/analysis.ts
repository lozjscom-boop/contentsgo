import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { analyzeVideo } from "@/lib/analysis/engine";
import { downloadBytes } from "@/lib/storage";
import type { JobHandler, JobRow } from "../types";

/** 영상 분석. payload: { analysisId, assetId, userId } */
export const analysisHandler: JobHandler = {
  async run(job, ctx) {
    const admin = createAdminSupabase();
    const ws = job.workspace_id;
    const analysisId = String(job.payload.analysisId ?? "");
    const assetId = String(job.payload.assetId ?? "");

    const { data: asset } = await admin.from("assets").select("id, kind, object_key, mime").eq("id", assetId).eq("workspace_id", ws).maybeSingle();
    if (!asset || asset.kind !== "reference" || !asset.object_key.startsWith(`${ws}/`)) throw new Error("asset_not_found");

    const { data: attempt } = await admin.from("generation_attempts").insert({
      workspace_id: ws, job_id: job.id, attempt_no: ctx.attemptNo, provider: "gemini", model_id: process.env.GEMINI_TEXT_MODEL ?? "", status: "submitted",
    }).select("id").single();

    try {
      const file = await downloadBytes(asset.object_key);
      const { result, modelId } = await analyzeVideo({ bytes: file.bytes, mime: asset.mime });
      await admin.from("video_analyses").update({ status: "done", result_json: result, model_id: modelId }).eq("id", analysisId).eq("workspace_id", ws);
      await admin.from("generation_attempts").update({ status: "succeeded" }).eq("id", attempt?.id ?? "");
      return { captured: Number(job.estimated_credits) };
    } catch (e) {
      await admin.from("generation_attempts").update({ status: "failed", error: String((e as Error).message).slice(0, 300) }).eq("id", attempt?.id ?? "");
      throw e;
    }
  },

  async onFailed(job: JobRow, message: string) {
    await createAdminSupabase().from("video_analyses").update({ status: "failed", error: message.slice(0, 300) })
      .eq("id", String(job.payload.analysisId ?? "")).eq("workspace_id", job.workspace_id);
  },

  notify: (job, ok) => ({
    title: ok ? "영상 분석이 끝났어요" : "영상 분석에 실패했어요 (크레딧은 복구됐어요)",
    link: `/analyze/${String(job.payload.analysisId ?? "")}`,
  }),
};
