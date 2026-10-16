import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { checkUpload } from "@/lib/uploads";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/storage";

const Body = z.object({ kind: z.enum(["product_photo", "reference"]), path: z.string().min(10).max(300), mime: z.string().max(100) });

/** 업로드가 끝난 파일을 확인하고 자산(assets) 행을 만든다. 크기·형식은 클라이언트 신고가 아니라 저장소의 실제 값으로 검증한다. */
export const POST = route("upload.complete", async (req) => {
  const { kind, path, mime: claimed } = await parseBody(req, Body);
  const { workspaceId, canEdit } = await requireWorkspace();
  if (!canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");
  if (!path.startsWith(`${workspaceId}/uploads/`) || path.includes("..")) throw new DomainError("invalid_path", 422, "잘못된 경로예요.");

  const admin = createAdminSupabase();
  const dir = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data: files, error } = await admin.storage.from(BUCKET).list(dir, { search: name, limit: 5 });
  const file = files?.find((f) => f.name === name);
  if (error || !file) throw new DomainError("not_found", 404, "업로드된 파일을 찾을 수 없어요.");
  const mime = (file.metadata as { mimetype?: string } | null)?.mimetype ?? claimed;
  const bytes = Number((file.metadata as { size?: number } | null)?.size ?? 0);
  const problem = checkUpload(kind, mime, bytes);
  if (problem) {
    await admin.storage.from(BUCKET).remove([path]);
    throw new DomainError("invalid_upload", 422, problem);
  }
  const { data, error: insErr } = await admin.from("assets").insert({ workspace_id: workspaceId, kind, object_key: path, mime, bytes, status: "ready" }).select("id").single();
  if (insErr) throw new Error(insErr.message);
  return json({ assetId: data.id });
});
