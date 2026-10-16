import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { raise } from "@/lib/errors";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createGeminiLlm, LlmOutputError } from "@/lib/providers/llm";
import { planConcepts, planCorePoints, planParts } from "@/lib/planning/engine";
import { BriefAnswers, Concept, CorePointsOutput, ProductInput } from "@/lib/planning/schemas";
import { DomainError } from "@/lib/errors";

export const maxDuration = 60;

const Body = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("core"), product: ProductInput, answers: BriefAnswers }),
  z.object({ stage: z.literal("concepts"), product: ProductInput, answers: BriefAnswers, core: CorePointsOutput }),
  z.object({ stage: z.literal("parts"), product: ProductInput, answers: BriefAnswers, concept: Concept }),
]);

export const POST = route("plan", async (req) => {
  const b = await parseBody(req, Body);
  const auth = await requireWorkspace();
  if (!auth.canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");

  // 기획 호출은 텍스트 모델 비용이 작아 크레딧은 받지 않지만, 플랜별 월 호출 한도로 남용을 막는다
  const admin = createAdminSupabase();
  const { data: plan } = await admin.rpc("current_plan_limits", { p_ws: auth.workspaceId });
  const limit = Number((plan as { planning_calls_month?: number } | null)?.planning_calls_month ?? 0);
  if (limit > 0) {
    const { error } = await admin.rpc("svc_consume_allowance", { p_ws: auth.workspaceId, p_key: "planning_calls", p_qty: 1, p_limit: limit, p_request_key: `plan:${crypto.randomUUID()}` });
    raise(error);
  }

  const llm = createGeminiLlm();
  try {
    const result =
      b.stage === "core" ? await planCorePoints(llm, b.product, b.answers)
      : b.stage === "concepts" ? await planConcepts(llm, b.product, b.answers, b.core)
      : await planParts(llm, b.product, b.answers, b.concept);
    return json(result);
  } catch (e) {
    if (e instanceof LlmOutputError) throw new DomainError("bad_output", 502, "AI가 올바른 결과를 만들지 못했어요. 다시 시도해주세요.");
    throw e;
  }
});
