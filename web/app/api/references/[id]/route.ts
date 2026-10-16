import { NextResponse } from "next/server";
import { AuthError, requireWorkspace } from "@/lib/auth";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { supabase, canEdit } = await requireWorkspace();
    if (!canEdit) return NextResponse.json({ error: "편집 권한이 없어요" }, { status: 403 });
    const { error } = await supabase.from("reference_items").delete().eq("id", id); // RLS: 내 워크스페이스 행만
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("reference delete failed", e);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
}
