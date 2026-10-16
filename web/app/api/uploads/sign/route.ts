import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { checkUpload, extOf } from "@/lib/uploads";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/storage";

const Body = z.object({ kind: z.enum(["product_photo", "reference"]), mime: z.string().max(100), bytes: z.number().int() });

/** 브라우저가 Storage로 직접 올릴 수 있는 1회용 서명 업로드 주소를 만든다 (서버리스 요청 크기 제한 회피). */
export const POST = route("upload.sign", async (req) => {
  const { kind, mime, bytes } = await parseBody(req, Body);
  const { workspaceId, canEdit } = await requireWorkspace();
  if (!canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");
  const problem = checkUpload(kind, mime, bytes);
  if (problem) throw new DomainError("invalid_upload", 422, problem);
  const path = `${workspaceId}/uploads/${crypto.randomUUID()}.${extOf(mime)}`;
  const { data, error } = await createAdminSupabase().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "sign failed");
  return json({ path, token: data.token });
});
