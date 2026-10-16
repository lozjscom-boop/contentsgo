import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createGeminiImage, type ReferenceImage } from "@/lib/providers/image";
import { downloadBase64, uploadCreative } from "@/lib/storage";
import { DeliverableDocument } from "@/lib/planning/schemas";
import { RetryableError, type JobHandler, type JobRow } from "../types";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const httpStatus = (e: unknown) => Number(/HTTP (\d{3})/.exec((e as Error)?.message ?? "")?.[1] ?? 0);

/** 장면 1개의 이미지를 생성한다. payload: { sceneId, userId } */
export const imageHandler: JobHandler = {
  async run(job, ctx) {
    const admin = createAdminSupabase();
    const ws = job.workspace_id;
    const sceneId = String(job.payload.sceneId ?? "");

    // 소속 검증: job의 워크스페이스와 장면의 워크스페이스가 같아야 한다
    const { data: scene } = await admin.from("scenes").select("id, workspace_id, creative_version_id, spec_json").eq("id", sceneId).eq("workspace_id", ws).maybeSingle();
    if (!scene) throw new Error("scene_not_found");
    const { data: ver } = await admin.from("creative_versions").select("deliverable_id, document_json").eq("id", scene.creative_version_id).eq("workspace_id", ws).single();
    if (!ver) throw new Error("version_not_found");
    const doc = DeliverableDocument.parse(ver.document_json);
    const spec = scene.spec_json as { visual_prompt: string; preserve_product?: boolean };

    const gen = createGeminiImage(); // 키 미설정이면 ProviderNotConfiguredError (과금 전)
    const references: ReferenceImage[] = [];
    if (spec.preserve_product) {
      const { data: dd } = await admin.from("deliverables").select("project_id").eq("id", ver.deliverable_id).eq("workspace_id", ws).single();
      const { data: pr } = dd ? await admin.from("projects").select("product_id").eq("id", dd.project_id).eq("workspace_id", ws).single() : { data: null };
      const { data: prod } = pr ? await admin.from("products").select("main_image_asset_id").eq("id", pr.product_id).eq("workspace_id", ws).single() : { data: null };
      const { data: photo } = prod?.main_image_asset_id ? await admin.from("assets").select("object_key").eq("id", prod.main_image_asset_id).eq("workspace_id", ws).single() : { data: null };
      if (photo && photo.object_key.startsWith(`${ws}/`)) references.push(await downloadBase64(photo.object_key));
    }
    const prompt = references.length ? `${spec.visual_prompt} 첨부한 제품 사진의 모양, 색, 라벨 위치를 그대로 유지한다.` : spec.visual_prompt;

    // 외부 제출 의도를 먼저 기록 (이후 프로세스가 죽으면 스위퍼가 provider_unknown으로 넘겨 이중 과금을 막는다)
    const { data: attempt } = await admin.from("generation_attempts").insert({
      workspace_id: ws, job_id: job.id, scene_id: sceneId, attempt_no: ctx.attemptNo, provider: "gemini",
      model_id: process.env.GEMINI_IMAGE_MODEL ?? "", status: "submitted",
    }).select("id").single();

    let img;
    try {
      img = await gen.generate({ prompt, aspect: doc.aspect, references: references.length ? references : undefined });
    } catch (e) {
      await admin.from("generation_attempts").update({ status: "failed", error: String((e as Error).message).slice(0, 300) }).eq("id", attempt?.id ?? "");
      const st = httpStatus(e);
      if (st === 429 || st === 503) throw new RetryableError(`일시적 공급사 오류 (HTTP ${st})`, 30 * ctx.attemptNo);
      throw e;
    }

    const bytes = Buffer.from(img.dataBase64, "base64");
    const objectKey = `${ws}/${ver.deliverable_id}/${sceneId}-${Date.now()}.${EXT[img.mimeType] ?? "jpg"}`;
    await uploadCreative(objectKey, bytes, img.mimeType);
    const asset = await admin.from("assets").insert({
      workspace_id: ws, kind: "generated_image", object_key: objectKey, mime: img.mimeType, bytes: bytes.length, status: "ready",
      metadata: { scene_id: sceneId, provider_request_id: img.providerRequestId },
    }).select("id").single();
    if (asset.error) throw new Error(asset.error.message);

    await admin.from("scenes").update({ asset_id: asset.data.id, status: "ready" }).eq("id", sceneId).eq("workspace_id", ws);
    await admin.from("generation_attempts").update({ status: "succeeded", provider_request_id: img.providerRequestId }).eq("id", attempt?.id ?? "");
    await admin.from("deliverables").update({ status: "review" }).eq("id", ver.deliverable_id).eq("workspace_id", ws);
    return { captured: Number(job.estimated_credits) };
  },

  async onFailed(job: JobRow) {
    const sceneId = String(job.payload.sceneId ?? "");
    await createAdminSupabase().from("scenes").update({ status: "failed" }).eq("id", sceneId).eq("workspace_id", job.workspace_id);
  },

  notify: (job, ok) => ({
    title: ok ? "이미지 생성이 끝났어요" : "이미지 생성에 실패했어요 (크레딧은 복구됐어요)",
    link: job.deliverable_id ? `/d/${job.deliverable_id}` : undefined,
  }),
};
