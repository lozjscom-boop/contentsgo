import { z } from "zod";
import { AD_PATTERN_KEYS, BODY_TYPE_KEYS, SLIDE_ROLES } from "./knowhow";

// ---------------------------------------------------------------- 입력
export const ProductInput = z.object({
  brandName: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  /** 사용자가 확인한 사실만. AI 추측은 여기에 넣지 않는다. */
  facts: z.record(z.string(), z.string()).default({}),
  forbiddenClaims: z.array(z.string()).default([]),
  tone: z.string().optional(),
});
export type ProductInput = z.infer<typeof ProductInput>;

export const BriefAnswers = z.object({
  purchase_moment: z.string().min(1),
  desired_outcome: z.string().min(1),
  purchase_barrier: z.string().min(1),
  proof: z.string().min(1),
  one_scene: z.string().optional(),
  offer: z.string().optional(),
});
export type BriefAnswers = z.infer<typeof BriefAnswers>;

// ---------------------------------------------------------------- ① 제품 핵심
export const CorePoint = z.object({
  point: z.string().min(1),
  why_it_matters: z.string().min(1),
  /** 어떤 답변에서 나왔는지 (AI 추측과 구분) */
  source_answer_key: z.string().min(1),
  visualizable: z.boolean(),
});
export const CorePointsOutput = z.object({
  core_points: z.array(CorePoint).min(2).max(5),
  /** 추천에 중요한데 부족한 정보. 최대 3개만 되묻는다. */
  missing_info_questions: z.array(z.string()).max(3).default([]),
});
export type CorePointsOutput = z.infer<typeof CorePointsOutput>;

// ---------------------------------------------------------------- ② 콘셉트 3안
export const Concept = z.object({
  title: z.string().min(1),
  pattern: z.enum(AD_PATTERN_KEYS),
  /** 핵심 소구 한 문장 */
  appeal: z.string().min(1),
  /** 왜 이 컨셉인지 — 브리프의 어떤 답/사실에서 출발했는지 */
  rationale: z.string().min(1),
  /** 제품 핵심 포인트를 한 장면으로 번역한 훅 장면 */
  visual_hook: z.string().min(1),
  body_type: z.enum(BODY_TYPE_KEYS),
  proof_type: z.enum(["demo", "fact", "visual", "none"]),
  needs_assets: z.array(z.string()).default([]),
  risk_notes: z.string().default(""),
  /** 고객이 확인한 사실에 근거했는지 */
  claim_status: z.enum(["supported", "needs_confirmation"]),
});
export type Concept = z.infer<typeof Concept>;

export const ConceptsOutput = z.object({
  concepts: z.array(Concept).length(3),
});
export type ConceptsOutput = z.infer<typeof ConceptsOutput>;

// ---------------------------------------------------------------- ③ 훅 / 내용 / 전환 부품
export const HookPart = z.object({
  label: z.string().min(1),
  /** 훅 구간(초). 끝은 3초 이하 */
  start_sec: z.number().min(0),
  end_sec: z.number().positive(),
  scene: z.string().min(1),
  caption: z.string().min(1),
  voice: z.string().optional(),
  /** 이미지/영상 생성용 프롬프트: 긍정형 직접 서술, 한글 문구 제외 */
  visual_prompt: z.string().min(1),
});
export type HookPart = z.infer<typeof HookPart>;

export const BodyBeat = z.object({
  role: z.enum(SLIDE_ROLES),
  caption: z.string().min(1),
  visual_prompt: z.string().min(1),
  seconds: z.number().positive().optional(),
});
export const BodyPart = z.object({
  label: z.string().min(1),
  body_type: z.enum(BODY_TYPE_KEYS),
  /** 3~8초에 들어가는 브랜드명 포함 한 줄 문구 */
  brand_line: z.string().min(1),
  beats: z.array(BodyBeat).min(2).max(6),
  /** review_staged일 때 연출 표시 문구 필수 */
  staged_disclosure: z.string().optional(),
});
export type BodyPart = z.infer<typeof BodyPart>;

export const CtaPart = z.object({
  label: z.string().min(1),
  offer_line: z.string().min(1),
  closer: z.string().min(1),
  visual_prompt: z.string().min(1),
});
export type CtaPart = z.infer<typeof CtaPart>;

export const PartsOutput = z.object({
  hooks: z.array(HookPart).min(2).max(3),
  bodies: z.array(BodyPart).min(1).max(2),
  ctas: z.array(CtaPart).min(2).max(3),
});
export type PartsOutput = z.infer<typeof PartsOutput>;

// ---------------------------------------------------------------- ④ 조립 결과 (creative_versions.document_json)
export const SCHEMA_VERSION = 1;

export const SceneSpec = z.object({
  scene_key: z.string(),
  role: z.enum(["hook", "brand_line", "body", "cta"]),
  start_sec: z.number().optional(),
  end_sec: z.number().optional(),
  slide_role: z.enum(SLIDE_ROLES).optional(),
  caption: z.string(),
  /** 단일 이미지처럼 한 장에 여러 줄이 필요할 때 caption 뒤에 추가로 얹는 문구 */
  overlay_lines: z.array(z.string()),
  visual_prompt: z.string(),
  /** 문구를 이미지에 직접 그리지 않고 앱이 오버레이한다 */
  caption_mode: z.literal("overlay"),
  /** 제품 원본 사진을 참조로 보존해야 하는 장면 */
  preserve_product: z.boolean(),
});
export type SceneSpec = z.infer<typeof SceneSpec>;

export const DeliverableDocument = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  type: z.enum(["image", "carousel", "video"]),
  total_sec: z.number().optional(),
  aspect: z.enum(["1:1", "4:5", "9:16"]),
  scenes: z.array(SceneSpec).min(1),
  tags: z.object({
    appeal: z.string(),
    pattern: z.enum(AD_PATTERN_KEYS),
    hook_label: z.string(),
    body_label: z.string(),
    cta_label: z.string(),
    body_type: z.enum(BODY_TYPE_KEYS),
    knowhow_version: z.string(),
  }),
  disclosures: z.array(z.string()).default([]),
});
export type DeliverableDocument = z.infer<typeof DeliverableDocument>;
