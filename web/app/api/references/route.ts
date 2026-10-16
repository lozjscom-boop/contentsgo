import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireWorkspace } from "@/lib/auth";

const Body = z.object({
  title: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), "http(s) 주소만 가능해요").optional().or(z.literal("").transform(() => undefined)),
  platform: z.enum(["meta", "tiktok", "instagram", "youtube", "other"]),
  notes: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});

export async function POST(req: Request) {
  try {
    const { supabase, workspaceId, canEdit, user } = await requireWorkspace();
    if (!canEdit) return NextResponse.json({ error: "편집 권한이 없어요" }, { status: 403 });
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) return NextResponse.json({ error: "invalid_input", detail: p.error.issues[0]?.message }, { status: 400 });
    const { error, data } = await supabase.from("reference_items").insert({ workspace_id: workspaceId, created_by: user.id, ...p.data, url: p.data.url ?? null, notes: p.data.notes ?? "" }).select("id").single();
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return NextResponse.json({ error: "migration_missing", detail: "DB 업데이트(UPDATE_04.sql)가 아직 적용되지 않았어요" }, { status: 503 });
      throw new Error(error.message);
    }
    return NextResponse.json({ id: data.id });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("reference create failed", e);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}
