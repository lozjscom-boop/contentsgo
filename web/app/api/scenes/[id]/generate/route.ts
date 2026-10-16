import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireWorkspace } from "@/lib/auth";
import { InsufficientCreditsError, reservationKey, reserve, sceneImagePrice, settle } from "@/lib/credits";
import { createGeminiImage } from "@/lib/providers/image";
import { ProviderNotConfiguredError } from "@/lib/providers/llm";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { downloadBase64, signedUrls, uploadCreative } from "@/lib/storage";
import type { ReferenceImage } from "@/lib/providers/image";
import { DeliverableDocument } from "@/lib/planning/schemas";

export const maxDuration = 120;

const Body = z.object({ requestKey: z.string().min(8).max(100) });
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: sceneId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { requestKey } = parsed.data;

  let ws = "";
  let reserved: string | null = null;
  const admin = createAdminSupabase();
  let jobId: string | null = null;

  try {
    const auth = await requireWorkspace();
    if (!auth.canEdit) return NextResponse.json({ error: "편집 권한이 없어요" }, { status: 403 });
    ws = auth.workspaceId;

    // 사용자 권한(RLS)으로 장면을 읽을 수 있어야 한다 = 내 워크스페이스의 장면
    const { data: scene } = await auth.supabase.from("scenes").select("id, workspace_id, creative_version_id, spec_json, status").eq("id", sceneId).maybeSingle();
    if (!scene) return NextResponse.json({ error: "장면을 찾을 수 없어요" }, { status: 404 });
    const { data: ver } = await auth.supabase.from("creative_versions").select("deliverable_id, document_json").eq("id", scene.creative_version_id).single();
    if (!ver) return NextResponse.json({ error: "제작 버전을 찾을 수 없어요" }, { status: 404 });
    const doc = DeliverableDocument.parse(ver.document_json);
    const price = sceneImagePrice(doc.type);

    // 중복 제출 방지: 같은 requestKey면 기존 작업을 돌려준다
    const key = `${sceneId}:${requestKey}`;
    const ins = await admin.from("jobs").insert({ workspace_id: ws, deliverable_id: ver.deliverable_id, kind: "image", status: "running", request_key: key, estimated_credits: price }).select("id").single();
    if (ins.error) {
      if (ins.error.code === "23505") return NextResponse.json({ error: "duplicate_request", detail: "같은 요청이 이미 처리됐거나 진행 중이에요" }, { status: 409 });
      throw new Error(ins.error.message);
    }
    jobId = ins.data.id as string;

    const gen = createGeminiImage(); // 키 미설정이면 여기서 예외 (아직 과금 전)
    await reserve(admin, ws, price, reservationKey(key));
    reserved = reservationKey(key);

    await admin.from("scenes").update({ status: "generating" }).eq("id", sceneId);
    const attempt = await admin.from("generation_attempts").insert({
      workspace_id: ws, job_id: jobId, scene_id: sceneId, attempt_no: 1, provider: "gemini", model_id: process.env.GEMINI_IMAGE_MODEL ?? "", status: "submitted",
    }).select("id").single();

    const spec = scene.spec_json as { visual_prompt: string; preserve_product?: boolean };
    // 제품 모양이 중요한 장면: 등록된 제품 사진이 있으면 원본을 참조로 전달한다
    const references: ReferenceImage[] = [];
    if (spec.preserve_product) {
      const { data: dd } = await auth.supabase.from("deliverables").select("project_id").eq("id", ver.deliverable_id).single();
      const { data: pr } = dd ? await auth.supabase.from("projects").select("product_id").eq("id", dd.project_id).single() : { data: null };
      const { data: prod } = pr ? await auth.supabase.from("products").select("main_image_asset_id").eq("id", pr.product_id).single() : { data: null };
      const { data: photo } = prod?.main_image_asset_id ? await auth.supabase.from("assets").select("object_key").eq("id", prod.main_image_asset_id).single() : { data: null };
      if (photo && photo.object_key.startsWith(`${ws}/`)) references.push(await downloadBase64(photo.object_key));
    }
    const prompt = references.length ? `${spec.visual_prompt} 첨부한 제품 사진의 모양, 색, 라벨 위치를 그대로 유지한다.` : spec.visual_prompt;
    const img = await gen.generate({ prompt, aspect: doc.aspect, references: references.length ? references : undefined });
    const bytes = Buffer.from(img.dataBase64, "base64");
    const objectKey = `${ws}/${ver.deliverable_id}/${sceneId}-${Date.now()}.${EXT[img.mimeType] ?? "jpg"}`;
    await uploadCreative(objectKey, bytes, img.mimeType);

    const asset = await admin.from("assets").insert({
      workspace_id: ws, kind: "generated_image", object_key: objectKey, mime: img.mimeType, bytes: bytes.length, status: "ready", metadata: { scene_id: sceneId, provider_request_id: img.providerRequestId },
    }).select("id").single();
    if (asset.error) throw new Error(asset.error.message);

    await admin.from("scenes").update({ asset_id: asset.data.id, status: "ready" }).eq("id", sceneId);
    await admin.from("generation_attempts").update({ status: "succeeded", provider_request_id: img.providerRequestId }).eq("id", attempt.data?.id ?? "");
    await admin.from("jobs").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", jobId);
    await settle(admin, ws, reserved, price); // 성공한 만큼만 차감
    reserved = null;
    await admin.from("deliverables").update({ status: "review", updated_at: new Date().toISOString() }).eq("id", ver.deliverable_id);

    const urls = await signedUrls([objectKey]);
    return NextResponse.json({ sceneId, assetId: asset.data.id, url: urls[objectKey] ?? null, charged: price });
  } catch (e) {
    if (reserved) {
      await settle(admin, ws, reserved, 0).catch((err) => console.error("settle(0) failed", err)); // 실패 → 전액 복구
    }
    // 인증·소속 확인을 통과해 작업(job)이 만들어진 경우에만 장면 상태를 바꾼다 (다른 워크스페이스 장면 보호)
    if (jobId) {
      await admin.from("jobs").update({ status: "failed" }).eq("id", jobId);
      await admin.from("scenes").update({ status: "failed" }).eq("id", sceneId);
    }
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof InsufficientCreditsError) {
      if (jobId) await admin.from("scenes").update({ status: "pending" }).eq("id", sceneId);
      return NextResponse.json({ error: "insufficient_credits", detail: "크레딧이 부족해요" }, { status: 402 });
    }
    if (e instanceof ProviderNotConfiguredError) return NextResponse.json({ error: "provider_not_configured", detail: e.message }, { status: 503 });
    console.error("scene generate failed", e);
    return NextResponse.json({ error: "generate_failed", detail: (e as Error).message }, { status: 502 });
  }
}
