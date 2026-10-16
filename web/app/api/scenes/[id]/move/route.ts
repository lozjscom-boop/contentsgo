import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireWorkspace } from "@/lib/auth";

const Body = z.object({ direction: z.enum(["up", "down"]) });
const num = (k: string) => Number(k.replace(/\D/g, "")) || 0;

/** 캐러셀 장 순서 바꾸기: 이웃 장면과 scene_key 를 맞바꾼다. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { supabase, canEdit } = await requireWorkspace();
    if (!canEdit) return NextResponse.json({ error: "편집 권한이 없어요" }, { status: 403 });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

    const { data: me } = await supabase.from("scenes").select("id, scene_key, creative_version_id").eq("id", id).maybeSingle();
    if (!me) return NextResponse.json({ error: "장면을 찾을 수 없어요" }, { status: 404 });
    const { data: ver } = await supabase.from("creative_versions").select("document_json").eq("id", me.creative_version_id).single();
    if ((ver?.document_json as { type?: string })?.type !== "carousel") return NextResponse.json({ error: "캐러셀만 순서를 바꿀 수 있어요" }, { status: 400 });

    const { data: all } = await supabase.from("scenes").select("id, scene_key").eq("creative_version_id", me.creative_version_id);
    const sorted = [...(all ?? [])].sort((a, b) => num(a.scene_key) - num(b.scene_key));
    const i = sorted.findIndex((s) => s.id === id);
    const j = parsed.data.direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= sorted.length) return NextResponse.json({ ok: true, moved: false });

    const a = sorted[i], b = sorted[j];
    const tmp = `tmp-${crypto.randomUUID().slice(0, 8)}`;
    for (const [row, key] of [[a, tmp], [b, a.scene_key], [a, b.scene_key]] as const) {
      const { error } = await supabase.from("scenes").update({ scene_key: key }).eq("id", row.id);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, moved: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("scene move failed", e);
    return NextResponse.json({ error: "move_failed" }, { status: 500 });
  }
}
