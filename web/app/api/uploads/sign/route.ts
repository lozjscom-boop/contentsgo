import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireWorkspace } from "@/lib/auth";
import { checkUpload, extOf } from "@/lib/uploads";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/storage";

const Body = z.object({ kind: z.enum(["product_photo", "reference"]), mime: z.string(), bytes: z.number().int() });

/** 브라우저가 Storage로 직접 올릴 수 있는 1회용 서명 업로드 주소를 만든다 (서버리스 요청 크기 제한 회피). */
export async function POST(req: Request) {
  try {
    const { workspaceId, canEdit } = await requireWorkspace();
    if (!canEdit) return NextResponse.json({ error: "편집 권한이 없어요" }, { status: 403 });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const { kind, mime, bytes } = parsed.data;
    const problem = checkUpload(kind, mime, bytes);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const path = `${workspaceId}/uploads/${crypto.randomUUID()}.${extOf(mime)}`;
    const { data, error } = await createAdminSupabase().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "sign failed");
    return NextResponse.json({ path, token: data.token });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("upload sign failed", e);
    return NextResponse.json({ error: "sign_failed" }, { status: 500 });
  }
}
