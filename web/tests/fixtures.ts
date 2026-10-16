import type { BodyPart, Concept, ConceptsOutput, CtaPart, HookPart, PartsOutput, ProductInput, BriefAnswers } from "../lib/planning/schemas";

export const product: ProductInput = {
  brandName: "르오즈",
  name: "고체향수 스틱",
  category: "향수",
  facts: { 형태: "스틱형", 사용: "목/손목에 바른다" },
  forbiddenClaims: ["담배 냄새 제거"],
  tone: "담백하고 센스 있게",
};

export const answers: BriefAnswers = {
  purchase_moment: "약속 장소에 들어가기 직전",
  desired_outcome: "향을 간편하게 챙기고 싶다",
  purchase_barrier: "분사형은 번거롭고 휴대가 불편하다",
  proof: "스틱을 꺼내 손목에 바르는 실제 영상이 있다",
  offer: "첫 구매 10% 할인",
};

export const concept = (over: Partial<Concept> = {}): Concept => ({
  title: "약속 전 한 번",
  pattern: "use_moment",
  appeal: "약속 직전 슥 바르는 향",
  rationale: "구매 순간 답변(약속 장소 들어가기 직전)에서 출발",
  visual_hook: "손목에 제품을 슥 문지르는 클로즈업",
  body_type: "demo",
  proof_type: "demo",
  needs_assets: ["사용 영상"],
  risk_notes: "",
  claim_status: "supported",
  ...over,
});

export const threeConcepts = (): ConceptsOutput => ({
  concepts: [
    concept({ pattern: "use_moment" }),
    concept({ title: "휴대", pattern: "portability", appeal: "주머니에 쏙" }),
    concept({ title: "혜택", pattern: "real_benefit", appeal: "첫 구매 10%" }),
  ],
});

export const hook = (over: Partial<HookPart> = {}): HookPart => ({
  label: "wrist_swipe",
  start_sec: 0,
  end_sec: 3,
  scene: "손목에 제품을 슥 바르는 장면",
  caption: "약속 장소 들어가기 직전",
  visual_prompt: "남성의 손목 위에서 스틱 제품이 움직이는 클로즈업, 따뜻한 실내 조명",
  ...over,
});

export const body = (over: Partial<BodyPart> = {}): BodyPart => ({
  label: "demo_basic",
  body_type: "demo",
  brand_line: "르오즈, 꺼내서 슥",
  beats: [
    { role: "message", caption: "분사 없이 바로 바른다", visual_prompt: "스틱 뚜껑을 여는 손" },
    { role: "proof", caption: "목과 손목에 간편하게", visual_prompt: "제품이 손목에 닿는 장면" },
  ],
  ...over,
});

export const cta = (over: Partial<CtaPart> = {}): CtaPart => ({
  label: "offer_10",
  offer_line: "첫 구매 10% 할인",
  closer: "지금 확인하기",
  visual_prompt: "제품을 중앙에 두고 단색 배경",
  ...over,
});

export const partsOutput = (): PartsOutput => ({
  hooks: [hook(), hook({ label: "pocket", scene: "주머니에서 꺼내는 장면" })],
  bodies: [body()],
  ctas: [cta(), cta({ label: "teaser", offer_line: "아직 모르셨어요?" })],
});
