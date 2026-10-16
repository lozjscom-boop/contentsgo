import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";
import { lintEditedText } from "@/lib/planning/lint";

const Body = z.object({ caption: z.string().trim().min(1, "문구를 입력해 주세요").max(80, "문구는 80자까지예요"), overlay_lines: z.array(z.string().trim().min(1).max(80)).max(4) });

/** 장면 문구(오버레이) 수정. 금지 표현 검수를 통과해야 저장된다. 이미지는 건드리지 않으므로 크레딧이 들지 않는다. */
export const PATCH = route("scene.edit", async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  const { supabase, canEdit } = await requireWorkspace();
  if (!canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");

  const { data: scene } = await supabase.from("scenes").select("id, spec_json, creative_version_id").eq("id", id).maybeSingle();
  if (!scene) throw new DomainError("not_found", 404, "장면을 찾을 수 없어요.");
  const { data: ver } = await supabase.from("creative_versions").select("deliverable_id").eq("id", scene.creative_version_id).single();
  const { data: d } = ver ? await supabase.from("deliverables").select("project_id").eq("id", ver.deliverable_id).single() : { data: null };
  const { data: pr } = d ? await supabase.from("projects").select("product_id").eq("id", d.project_id).single() : { data: null };
  const { data: prod } = pr ? await supabase.from("products").select("forbidden_claims").eq("id", pr.product_id).single() : { data: null };

  const issues = lintEditedText([body.caption, ...body.overlay_lines], (prod?.forbidden_claims as string[]) ?? []);
  if (issues.length) return json({ error: "lint_failed", detail: issues.map((i) => i.message).join(" "), issues }, 422);

  const spec = { ...(scene.spec_json as object), caption: body.caption, overlay_lines: body.overlay_lines };
  const { error } = await supabase.from("scenes").update({ spec_json: spec }).eq("id", id);
  raise(error);
  return json({ ok: true });
});
