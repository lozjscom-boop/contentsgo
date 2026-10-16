import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError } from "@/lib/errors";

/** 캐러셀 장 순서 바꾸기. DB 함수가 이웃 장면과 한 트랜잭션으로 맞바꾼다 (중간 실패로 순서가 깨지지 않음). */
export const POST = route("scene.move", async (req, ctx) => {
  const { id } = await ctx.params;
  const { direction } = await parseBody(req, z.object({ direction: z.enum(["up", "down"]) }));
  const { supabase, canEdit } = await requireWorkspace();
  if (!canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");
  const { data, error } = await supabase.rpc("move_scene", { p_scene: id, p_direction: direction });
  if (error) {
    if (/scene_not_found/.test(error.message)) throw new DomainError("not_found", 404, "장면을 찾을 수 없어요.");
    if (/not_carousel/.test(error.message)) throw new DomainError("invalid_input", 422, "캐러셀만 순서를 바꿀 수 있어요.");
    throw new Error(error.message);
  }
  return json({ ok: true, moved: data === true });
});
