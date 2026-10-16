import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireWorkspace } from "@/lib/auth";
import { CREDIT_PRICES, InsufficientCreditsError, reservationKey, reserve, settle } from "@/lib/credits";
import { analyzeVideo } from "@/lib/analysis/engine";
import { LlmOutputError, ProviderNotConfiguredError } from "@/lib/providers/llm";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { downloadBytes } from "@/lib/storage";

export const maxDuration = 300;

const Body = z.object({ assetId: z.string().uuid(), referenceItemId: z.string().uuid().optional(), requestKey: z.string().min(8).max(100) });
const MISSING_TABLE = (c?: string) => c === "42P01" || c === "PGRST205" || c === "PGRST200";

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { assetId, referenceItemId, requestKey } = parsed.data;
  const price = CREDIT_PRICES.video_analysis;
  const admin = createAdminSupabase();
  let ws = "";
  let reserved: string | null = null;
  let analysisId: string | null = null;

  try {
    const auth = await requireWorkspace();
    if (!auth.canEdit) return NextResponse.json({ error: "편집 권한이 없어요" }, { status: 403 });
    ws = auth.workspaceId;

    // 사용자 권한(RLS)으로 읽히는 내 워크스페이스의 업로드 영상이어야 한다
    const { data: asset } = await auth.supabase.from("assets").select("id, workspace_id, kind, object_key, mime").eq("id", assetId).maybeSingle();
    if (!asset || asset.kind !== "reference" || !asset.object_key.startsWith(`${ws}/`)) return NextResponse.json({ error: "영상을 찾을 수 없어요" }, { status: 404 });

    const ins = await admin.from("video_analyses").insert({ workspace_id: ws, asset_id: assetId, reference_item_id: referenceItemId ?? null, status: "analyzing", request_key: requestKey, created_by: auth.user.id }).select("id").single();
    if (ins.error) {
      if (MISSING_TABLE(ins.error.code)) return NextResponse.json({ error: "migration_missing", detail: "DB 업데이트(UPDATE_04.sql)가 아직 적용되지 않았어요" }, { status: 503 });
      if (ins.error.code === "23505") return NextResponse.json({ error: "duplicate_request" }, { status: 409 });
      throw new Error(ins.error.message);
    }
    analysisId = ins.data.id as string;

    const key = reservationKey(`analysis:${analysisId}`);
    await reserve(admin, ws, price, key);
    reserved = key;

    const file = await downloadBytes(asset.object_key);
    const { result, modelId } = await analyzeVideo({ bytes: file.bytes, mime: asset.mime });
    await admin.from("video_analyses").update({ status: "done", result_json: result, model_id: modelId }).eq("id", analysisId);
    await settle(admin, ws, key, price);
    reserved = null;
    return NextResponse.json({ id: analysisId, charged: price });
  } catch (e) {
    if (reserved) await settle(admin, ws, reserved, 0).catch((err) => console.error("settle(0) failed", err));
    const msg = e instanceof Error ? e.message : "failed";
    if (analysisId) await admin.from("video_analyses").update({ status: "failed", error: msg.slice(0, 300) }).eq("id", analysisId);
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof InsufficientCreditsError) {
      if (analysisId) await admin.from("video_analyses").delete().eq("id", analysisId); // 과금 전 중단: 기록 제거해 같은 키로 재시도 가능
      return NextResponse.json({ error: "insufficient_credits", detail: "크레딧이 부족해요" }, { status: 402 });
    }
    if (e instanceof ProviderNotConfiguredError) return NextResponse.json({ error: "provider_not_configured", detail: e.message }, { status: 503 });
    if (e instanceof LlmOutputError) return NextResponse.json({ error: "bad_output", detail: e.message }, { status: 502 });
    console.error("analysis failed", e);
    return NextResponse.json({ error: "analysis_failed", detail: msg }, { status: 502 });
  }
}
