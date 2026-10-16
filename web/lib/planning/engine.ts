import type { z } from "zod";
import { LlmOutputError, type LlmClient } from "../providers/llm";
import { hasErrors, lintConcepts, lintParts, type LintIssue } from "./lint";
import {
  buildConceptsPrompt,
  buildCorePointsPrompt,
  buildPartsPrompt,
  repairSuffix,
  type PromptPair,
} from "./prompts";
import {
  ConceptsOutput,
  CorePointsOutput,
  PartsOutput,
  type BriefAnswers,
  type Concept,
  type ProductInput,
} from "./schemas";

export type StageResult<T> = {
  /** 에러 수준 문제가 남아 있으면 false → 호출 측이 사용자에게 검토를 요청한다(조용히 통과시키지 않음) */
  ok: boolean;
  data: T;
  issues: LintIssue[];
  /** 교정 1회를 사용했는지 */
  repaired: boolean;
};

/**
 * 생성 → 검수 → (필요 시) 교정 1회 → 재검수.
 * 품질 교정은 1회로 제한한다(작업 예산 초과 방지). 교정 후에도 error가 남으면 ok=false로 돌려준다.
 */
async function runStage<T>(
  llm: LlmClient,
  prompt: PromptPair,
  schema: z.ZodType<T>,
  lint: (data: T) => LintIssue[],
): Promise<StageResult<T>> {
  let first: T | null = null;
  let firstIssues: LintIssue[] = [];
  let outputError: string | null = null;

  try {
    first = await llm.generateJson({ system: prompt.system, user: prompt.user, schema });
    firstIssues = lint(first);
  } catch (e) {
    if (e instanceof LlmOutputError) outputError = e.message;
    else throw e;
  }

  if (first && !hasErrors(firstIssues)) {
    return { ok: true, data: first, issues: firstIssues, repaired: false };
  }

  const repairIssues = outputError
    ? [{ path: "(출력 형식)", message: outputError }]
    : firstIssues.filter((i) => i.severity === "error");

  const second = await llm.generateJson({
    system: prompt.system,
    user: prompt.user + repairSuffix(repairIssues),
    schema,
  });
  const secondIssues = lint(second);
  return { ok: !hasErrors(secondIssues), data: second, issues: secondIssues, repaired: true };
}

/** ① 제품 핵심 포인트 정리 */
export function planCorePoints(llm: LlmClient, product: ProductInput, answers: BriefAnswers) {
  return runStage(
    llm,
    buildCorePointsPrompt(product, answers, CorePointsOutput),
    CorePointsOutput,
    () => [], // 핵심 포인트는 서술 정리 단계라 별도 lint 없음 (출처 키 존재는 스키마가 강제)
  );
}

/** ② 서로 다른 설득 가설 콘셉트 3안 */
export function planConcepts(
  llm: LlmClient,
  product: ProductInput,
  answers: BriefAnswers,
  core: CorePointsOutput,
) {
  return runStage(
    llm,
    buildConceptsPrompt(product, answers, core, ConceptsOutput),
    ConceptsOutput,
    (d) => lintConcepts(d, product.forbiddenClaims),
  );
}

/** ③ 선택한 콘셉트의 훅 / 내용 / 전환 부품 */
export function planParts(llm: LlmClient, product: ProductInput, answers: BriefAnswers, concept: Concept) {
  return runStage(
    llm,
    buildPartsPrompt(product, answers, concept, PartsOutput),
    PartsOutput,
    (d) => lintParts(d, product.brandName, product.forbiddenClaims),
  );
}
