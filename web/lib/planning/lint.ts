import {
  GLOBAL_FORBIDDEN_CLAIMS,
  HIGH_RISK_VISUALS,
  REAL_TESTIMONIAL_PATTERNS,
  VIDEO_RULES,
} from "./knowhow";
import type { BodyPart, ConceptsOutput, CtaPart, HookPart, PartsOutput } from "./schemas";

export type LintIssue = {
  severity: "error" | "warn";
  code: string;
  path: string;
  message: string;
};

const NEGATION = /(\bNOT\b|\bno\b |\bwithout\b|없이|없는|않는|아닌|하지 ?않|금지)/i;
const TEXT_IN_IMAGE = /(문구|텍스트|글자|자막|타이포|캡션).{0,6}(넣|적|쓰|새기|표시|들어간)/;

function claimRegexes(forbidden: string[]): RegExp[] {
  const own = forbidden.filter(Boolean).map((s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const global = GLOBAL_FORBIDDEN_CLAIMS.map((s) => new RegExp(s));
  return [...own, ...global];
}

function checkText(text: string, path: string, forbidden: RegExp[], out: LintIssue[]) {
  for (const re of forbidden) {
    if (re.test(text)) {
      out.push({
        severity: "error",
        code: "forbidden_claim",
        path,
        message: `사용할 수 없는 표현이 포함돼 있어요 (${re.source}). 확인된 사실로만 쓰세요.`,
      });
    }
  }
  for (const re of REAL_TESTIMONIAL_PATTERNS) {
    if (re.test(text)) {
      out.push({
        severity: "error",
        code: "fake_testimonial",
        path,
        message: "연출/AI 장면을 실제 후기·증언처럼 표현할 수 없어요.",
      });
    }
  }
}

/** 고위험 연출(AI가 안정적으로 못 만드는 장면) 경고만 검사 */
function checkRisk(text: string, path: string, out: LintIssue[]) {
  for (const r of HIGH_RISK_VISUALS) {
    if (r.pattern.test(text)) {
      out.push({ severity: "warn", code: `high_risk_${r.code}`, path, message: r.alt });
    }
  }
}

function checkVisualPrompt(prompt: string, path: string, out: LintIssue[]) {
  if (NEGATION.test(prompt)) {
    out.push({
      severity: "error",
      code: "prompt_negation",
      path,
      message: "이미지 프롬프트는 부정문 없이 긍정형 직접 서술로만 써야 해요.",
    });
  }
  if (TEXT_IN_IMAGE.test(prompt)) {
    out.push({
      severity: "error",
      code: "text_in_image",
      path,
      message: "한글 문구는 이미지 안에 그리지 않고 오버레이로 얹어요. 프롬프트에서 문구 지시를 빼주세요.",
    });
  }
  checkRisk(prompt, path, out);
}

/** ② 콘셉트 3안 검수: 서로 다른 설득 가설이어야 한다. */
export function lintConcepts(out: ConceptsOutput, forbiddenClaims: string[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const patterns = new Set(out.concepts.map((c) => c.pattern));
  if (patterns.size < out.concepts.length) {
    issues.push({
      severity: "error",
      code: "concepts_not_distinct",
      path: "concepts",
      message: "콘셉트 3안은 서로 다른 설득 패턴이어야 해요. 같은 광고의 문구만 바꾼 3개는 3안이 아니에요.",
    });
  }
  const re = claimRegexes(forbiddenClaims);
  out.concepts.forEach((c, i) => {
    for (const [k, v] of Object.entries({ appeal: c.appeal, rationale: c.rationale, visual_hook: c.visual_hook })) {
      checkText(v, `concepts[${i}].${k}`, re, issues);
    }
    // 훅 장면 설명은 서술 문장이라 부정문/문구 검사는 하지 않고, 고위험 연출 경고만 낸다
    checkRisk(c.visual_hook, `concepts[${i}].visual_hook`, issues);
  });
  return issues;
}

function lintHook(h: HookPart, i: number, brand: RegExp[], issues: LintIssue[]) {
  const p = `hooks[${i}]`;
  if (h.end_sec > VIDEO_RULES.hookEndSec) {
    issues.push({
      severity: "error",
      code: "hook_too_long",
      path: p,
      message: `훅은 0~${VIDEO_RULES.hookEndSec}초 안에 끝나야 해요 (현재 ${h.end_sec}초).`,
    });
  }
  checkText(`${h.scene} ${h.caption} ${h.voice ?? ""}`, p, brand, issues);
  checkVisualPrompt(h.visual_prompt, `${p}.visual_prompt`, issues);
}

function lintBody(b: BodyPart, i: number, brandName: string, brand: RegExp[], issues: LintIssue[]) {
  const p = `bodies[${i}]`;
  if (!b.brand_line.includes(brandName)) {
    issues.push({
      severity: "error",
      code: "brand_line_missing_brand",
      path: `${p}.brand_line`,
      message: `브랜드 한 줄 문구에 브랜드명(${brandName})이 들어가야 해요.`,
    });
  }
  if (b.body_type === "review_staged" && !b.staged_disclosure) {
    issues.push({
      severity: "error",
      code: "staged_disclosure_missing",
      path: `${p}.staged_disclosure`,
      message: "후기 형식 연출은 연출임을 표시하는 문구가 필요해요.",
    });
  }
  checkText(`${b.brand_line} ${b.beats.map((x) => x.caption).join(" ")}`, p, brand, issues);
  b.beats.forEach((beat, j) => checkVisualPrompt(beat.visual_prompt, `${p}.beats[${j}].visual_prompt`, issues));
}

function lintCta(c: CtaPart, i: number, brand: RegExp[], issues: LintIssue[]) {
  const p = `ctas[${i}]`;
  checkText(`${c.offer_line} ${c.closer}`, p, brand, issues);
  checkVisualPrompt(c.visual_prompt, `${p}.visual_prompt`, issues);
}

/** ③ 훅/내용/전환 부품 검수 */
export function lintParts(out: PartsOutput, brandName: string, forbiddenClaims: string[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const re = claimRegexes(forbiddenClaims);
  out.hooks.forEach((h, i) => lintHook(h, i, re, issues));
  out.bodies.forEach((b, i) => lintBody(b, i, brandName, re, issues));
  out.ctas.forEach((c, i) => lintCta(c, i, re, issues));
  return issues;
}

export const hasErrors = (issues: LintIssue[]) => issues.some((i) => i.severity === "error");

/** 사용자가 편집한 문구 검수 (금지 표현, 가짜 후기). 편집으로 규칙을 우회하지 못하게 저장 전에 호출한다. */
export function lintEditedText(texts: string[], forbiddenClaims: string[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const re = claimRegexes(forbiddenClaims);
  texts.forEach((t, i) => checkText(t, `문구 ${i + 1}`, re, issues));
  return issues;
}
