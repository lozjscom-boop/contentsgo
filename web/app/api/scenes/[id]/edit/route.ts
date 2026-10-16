import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireWorkspace } from "@/lib/auth";
import { lintEditedText } from "@/lib/planning/lint";

const Body = z.object({ caption: z.string().trim().min(1).max(80), overlay_lines: z.array(z.string().trim().min(1).max(80)).max(4) });

/** 장면 문구(오버레이) 수정. 금지 표현 검수를 통과해야 저장된다. 이미지는 건드리지 않으므로 크레딧이 들지 않는다. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { supabase, canEdit } = await requireWorkspace();
    if (!canEdit) return NextResponse.json({ error: "편집 권한이 없어요" }, { status: 403 });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "문구는 1~80자로 입력해 주세요" }, { status: 400 });

    const { data: scene } = await supabase.from("scenes").select("id, spec_json, creative_version_id").eq("id", id).maybeSingle();
    if (!scene) return NextResponse.json({ error: "장면을 찾을 수 없어요" }, { status: 404 });
    const { data: ver } = await supabase.from("creative_versions").select("deliverable_id").eq("id", scene.creative_version_id).single();
    const { data: d } = ver ? await supabase.from("deliverables").select("project_id").eq("id", ver.deliverable_id).single() : { data: null };
    const { data: pr } = d ? await supabase.from("projects").select("product_id").eq("id", d.project_id).single() : { data: null };
    const { data: prod } = pr ? await supabase.from("products").select("forbidden_claims").eq("id", pr.product_id).single() : { data: null };

    const issues = lintEditedText([parsed.data.caption, ...parsed.data.overlay_lines], (prod?.forbidden_claims as string[]) ?? []);
    if (issues.length) return NextResponse.json({ error: "lint_failed", issues }, { status: 422 });

    const spec = { ...(scene.spec_json as object), caption: parsed.data.caption, overlay_lines: parsed.data.overlay_lines };
    const { error } = await supabase.from("scenes").update({ spec_json: spec }).eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("scene edit failed", e);
    return NextResponse.json({ error: "edit_failed" }, { status: 500 });
  }
}
