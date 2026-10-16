import { route, json } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";

export const DELETE = route("reference.delete", async (_req, ctx) => {
  const { id } = await ctx.params;
  const { supabase, canEdit } = await requireWorkspace();
  if (!canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");
  const { error } = await supabase.from("reference_items").delete().eq("id", id); // RLS: 내 워크스페이스 행만
  raise(error);
  return json({ ok: true });
});
