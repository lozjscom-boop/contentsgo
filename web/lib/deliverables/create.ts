import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleDeliverable } from "../planning/assemble";
import type { BodyPart, BriefAnswers, Concept, CorePointsOutput, CtaPart, HookPart, ProductInput } from "../planning/schemas";

export type CreateDeliverableInput = {
  workspaceId: string;
  product: ProductInput;
  answers: BriefAnswers;
  core: CorePointsOutput;
  concept: Concept;
  hook: HookPart;
  body: BodyPart;
  cta: CtaPart;
  type: "image" | "carousel" | "video";
  aspect?: "1:1" | "4:5" | "9:16";
  totalSec?: number;
};

function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error || res.data == null) throw new Error(`${what} 저장 실패: ${res.error?.message ?? "no data"}`);
  return res.data as NonNullable<T>;
}

/**
 * 기획 결과를 DB에 저장하고 제작물(deliverable)을 만든다.
 * 사용자 권한(RLS) 클라이언트로 호출한다. 여러 insert의 묶음이라 중간 실패 시 고아 행이 남을 수 있다(1차 허용, 2차에 RPC 트랜잭션으로 교체).
 */
export async function createDeliverable(sb: SupabaseClient, i: CreateDeliverableInput) {
  const ws = i.workspaceId;
  const doc = assembleDeliverable({
    type: i.type,
    aspect: i.aspect,
    productName: i.product.name,
    concept: i.concept,
    hook: i.hook,
    body: i.body,
    cta: i.cta,
    totalSec: i.totalSec,
  });

  // 브랜드 / 제품: 같은 이름이면 재사용
  let brand = (await sb.from("brands").select("id").eq("workspace_id", ws).eq("name", i.product.brandName).limit(1).maybeSingle()).data;
  if (!brand) brand = must(await sb.from("brands").insert({ workspace_id: ws, name: i.product.brandName }).select("id").single(), "브랜드");

  let product = (await sb.from("products").select("id").eq("workspace_id", ws).eq("brand_id", brand.id).eq("name", i.product.name).limit(1).maybeSingle()).data;
  if (!product) {
    product = must(
      await sb.from("products").insert({
        workspace_id: ws, brand_id: brand.id, name: i.product.name, category: i.product.category ?? null,
        facts_json: i.product.facts, forbidden_claims: i.product.forbiddenClaims,
      }).select("id").single(),
      "제품",
    );
  }

  const project = must(
    await sb.from("projects").insert({
      workspace_id: ws, brand_id: brand.id, product_id: product.id, title: `${i.product.name} · ${i.concept.title}`, status: "producing",
    }).select("id").single(),
    "프로젝트",
  );
  const brief = must(
    await sb.from("briefs").insert({ workspace_id: ws, project_id: project.id, answers_json: i.answers, core_points_json: i.core.core_points, status: "confirmed" }).select("id").single(),
    "브리프",
  );
  const concept = must(
    await sb.from("concepts").insert({
      workspace_id: ws, project_id: project.id, brief_id: brief.id, title: i.concept.title, appeal: i.concept.appeal,
      rationale: i.concept.rationale, visual_hook: i.concept.visual_hook, body_type: i.concept.body_type, status: "selected",
    }).select("id").single(),
    "콘셉트",
  );
  const partRows = must(
    await sb.from("parts").insert([
      { workspace_id: ws, project_id: project.id, concept_id: concept.id, stage: "hook", label: i.hook.label, content_json: i.hook, selected: true },
      { workspace_id: ws, project_id: project.id, concept_id: concept.id, stage: "body", label: i.body.label, content_json: i.body, selected: true },
      { workspace_id: ws, project_id: project.id, concept_id: concept.id, stage: "cta", label: i.cta.label, content_json: i.cta, selected: true },
    ]).select("id, stage"),
    "부품",
  );
  const partId = (stage: string) => partRows.find((p) => p.stage === stage)!.id as string;

  const deliverable = must(
    await sb.from("deliverables").insert({
      workspace_id: ws, project_id: project.id, concept_id: concept.id, type: i.type, status: "draft",
      tags_json: doc.tags, hook_part_id: partId("hook"), body_part_id: partId("body"), cta_part_id: partId("cta"),
    }).select("id").single(),
    "제작물",
  );
  const version = must(
    await sb.from("creative_versions").insert({ workspace_id: ws, deliverable_id: deliverable.id, version: 1, document_json: doc, schema_version: doc.schema_version }).select("id").single(),
    "제작 버전",
  );
  must(await sb.from("deliverables").update({ current_version_id: version.id }).eq("id", deliverable.id).select("id").single(), "제작물 연결");
  must(
    await sb.from("scenes").insert(doc.scenes.map((s) => ({ workspace_id: ws, creative_version_id: version.id, scene_key: s.scene_key, role: s.role, spec_json: s }))).select("id"),
    "장면",
  );
  return { deliverableId: deliverable.id as string, projectId: project.id as string };
}
