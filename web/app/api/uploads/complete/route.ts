import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireWorkspace } from "@/lib/auth";
import { checkUpload } from "@/lib/uploads";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/storage";

const Body = z.object({ kind: z.enum(["product_photo", "reference"]), path: z.string().min(10).max(300), mime: z.string() });

/** 업로드가 끝난 파일을 확인하고 자산(assets) 행을 만든다. 크기·형식은 클라이언트 신고가 아니라 저장소의 실제 값으로 검증한다. */
export async function POST(req: Request) {
  try {
    const { workspaceId, canEdit } = await requireWorkspace();
    if (!canEdit) return NextResponse.json({ error: "편집 권한이 없어요" }, { status: 403 });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const { kind, path } = parsed.data;
    if (!path.startsWith(`${workspaceId}/uploads/`) || path.includes("..")) return NextResponse.json({ error: "invalid_path" }, { status: 400 });

    const admin = createAdminSupabase();
    const dir = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const { data: files, error } = await admin.storage.from(BUCKET).list(dir, { search: name, limit: 5 });
    const file = files?.find((f) => f.name === name);
    if (error || !file) return NextResponse.json({ error: "업로드된 파일을 찾을 수 없어요" }, { status: 404 });
    const mime = (file.metadata as { mimetype?: string } | null)?.mimetype ?? parsed.data.mime;
    const bytes = Number((file.metadata as { size?: number } | null)?.size ?? 0);
    const problem = checkUpload(kind, mime, bytes);
    if (problem) {
      await admin.storage.from(BUCKET).remove([path]);
      return NextResponse.json({ error: problem }, { status: 400 });
    }
    const { data, error: insErr } = await admin.from("assets").insert({ workspace_id: workspaceId, kind, object_key: path, mime, bytes, status: "ready" }).select("id").single();
    if (insErr) throw new Error(insErr.message);
    return NextResponse.json({ assetId: data.id });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("upload complete failed", e);
    return NextResponse.json({ error: "complete_failed" }, { status: 500 });
  }
}
