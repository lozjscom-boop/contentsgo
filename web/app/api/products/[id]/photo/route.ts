import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";

export const PATCH = route("product.photo", async (req, ctx) => {
  const { id } = await ctx.params;
  const { assetId } = await parseBody(req, z.object({ assetId: z.string().uuid() }));
  const { supabase, canEdit } = await requireWorkspace();
  if (!canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");
  // 사용자 권한(RLS) + 복합 FK 로 같은 워크스페이스의 제품·자산만 연결된다
  const { data, error } = await supabase.from("products").update({ main_image_asset_id: assetId }).eq("id", id).select("id").maybeSingle();
  raise(error);
  if (!data) throw new DomainError("not_found", 404, "제품을 찾을 수 없어요.");
  return json({ ok: true });
});
