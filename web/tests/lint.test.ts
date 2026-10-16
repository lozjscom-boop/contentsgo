import { describe, expect, it } from "vitest";
import { hasErrors, lintConcepts, lintParts } from "../lib/planning/lint";
import { body, concept, cta, hook, partsOutput, product, threeConcepts } from "./fixtures";

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("lintConcepts", () => {
  it("서로 다른 패턴 3안은 통과한다", () => {
    expect(hasErrors(lintConcepts(threeConcepts(), product.forbiddenClaims))).toBe(false);
  });

  it("같은 패턴이 겹치면 3안이 아니라고 막는다", () => {
    const out = threeConcepts();
    out.concepts[1].pattern = "use_moment";
    expect(codes(lintConcepts(out, []))).toContain("concepts_not_distinct");
  });

  it("제품별 금지 표현이 소구에 들어가면 에러", () => {
    const out = threeConcepts();
    out.concepts[0].appeal = "담배 냄새 제거되는 향";
    expect(codes(lintConcepts(out, ["담배 냄새 제거"]))).toContain("forbidden_claim");
  });

  it("고위험 연출(손으로 바르는 동작)은 에러가 아니라 대안과 함께 경고", () => {
    const out = threeConcepts();
    out.concepts[0].visual_hook = "손으로 입술에 바르는 클로즈업";
    const issues = lintConcepts(out, []);
    expect(hasErrors(issues)).toBe(false);
    expect(codes(issues)).toContain("high_risk_hand_application");
  });
});

describe("lintParts", () => {
  it("정상 부품은 에러 없이 통과", () => {
    expect(hasErrors(lintParts(partsOutput(), "르오즈", []))).toBe(false);
  });

  it("훅이 3초를 넘기면 에러", () => {
    const out = partsOutput();
    out.hooks[0] = hook({ end_sec: 4.5 });
    expect(codes(lintParts(out, "르오즈", []))).toContain("hook_too_long");
  });

  it("브랜드 한 줄에 브랜드명이 없으면 에러", () => {
    const out = partsOutput();
    out.bodies[0] = body({ brand_line: "꺼내서 슥 바르는 향" });
    expect(codes(lintParts(out, "르오즈", []))).toContain("brand_line_missing_brand");
  });

  it("연출 후기를 실제 후기처럼 쓰면 에러", () => {
    const out = partsOutput();
    out.bodies[0] = body({
      beats: [
        { role: "message", caption: "실제 구매자 후기 1,200건", visual_prompt: "후기 카드" },
        { role: "proof", caption: "써보니 달라요", visual_prompt: "제품 컷" },
      ],
    });
    expect(codes(lintParts(out, "르오즈", []))).toContain("fake_testimonial");
  });

  // 패턴 하나하나가 독립적으로 잡혀야 한다 (한 문장이 여러 패턴에 걸려 가려지지 않도록 각각 따로 검증)
  it.each([
    ["실제 구매자들이 선택한 향"],
    ["실제 사용자 반응"],
    ["리얼 후기 모음"],
    ["진짜 후기입니다"],
    ["후기 1,200건 돌파"],
    ["리뷰 300개 달성"],
    ["고객님이 직접 남겨주신 말씀"],
  ])("실제 후기·증언 표현 '%s'를 막는다", (caption) => {
    const out = partsOutput();
    out.bodies[0] = body({
      beats: [
        { role: "message", caption, visual_prompt: "제품 컷" },
        { role: "proof", caption: "간편하게 바른다", visual_prompt: "제품이 손목에 닿는 장면" },
      ],
    });
    expect(codes(lintParts(out, "르오즈", []))).toContain("fake_testimonial");
  });

  it("후기 표현이 아닌 일반 문구는 막지 않는다", () => {
    const out = partsOutput();
    out.bodies[0] = body({
      beats: [
        { role: "message", caption: "실제로 써보면 알아요", visual_prompt: "제품 컷" },
        { role: "proof", caption: "후기를 기다려요", visual_prompt: "제품 컷" },
      ],
    });
    expect(codes(lintParts(out, "르오즈", []))).not.toContain("fake_testimonial");
  });

  it("후기 형식 연출은 연출 표시 문구가 없으면 에러, 있으면 통과", () => {
    const out = partsOutput();
    out.bodies[0] = body({ body_type: "review_staged" });
    expect(codes(lintParts(out, "르오즈", []))).toContain("staged_disclosure_missing");
    out.bodies[0] = body({ body_type: "review_staged", staged_disclosure: "연출된 장면입니다" });
    expect(hasErrors(lintParts(out, "르오즈", []))).toBe(false);
  });

  it("의료적 효능 표현은 제품 설정과 무관하게 에러", () => {
    const out = partsOutput();
    out.ctas[0] = cta({ offer_line: "피부 질환 치료에 도움" });
    expect(codes(lintParts(out, "르오즈", []))).toContain("forbidden_claim");
  });

  it("이미지 프롬프트의 부정문은 에러 (대표님 실패 체크리스트 반영)", () => {
    const out = partsOutput();
    out.hooks[0] = hook({ visual_prompt: "제품 병, 라벨 번짐 없이 선명하게" });
    expect(codes(lintParts(out, "르오즈", []))).toContain("prompt_negation");
  });

  it("이미지에 한글 문구를 그리라는 지시는 에러 (오버레이로 처리)", () => {
    const out = partsOutput();
    out.hooks[0] = hook({ visual_prompt: "제품 위에 '약속 전 한 번' 문구를 넣는다" });
    expect(codes(lintParts(out, "르오즈", []))).toContain("text_in_image");
  });

  it("라벨 클로즈업은 경고만 낸다", () => {
    const out = partsOutput();
    out.hooks[0] = hook({ visual_prompt: "제품 라벨 클로즈업 컷" });
    const issues = lintParts(out, "르오즈", []);
    expect(hasErrors(issues)).toBe(false);
    expect(codes(issues)).toContain("high_risk_label_closeup");
  });

  it("concept 헬퍼 기본값은 문제가 없다 (회귀 방지)", () => {
    expect(hasErrors(lintConcepts({ concepts: [concept(), concept({ pattern: "portability" }), concept({ pattern: "real_benefit" })] }, []))).toBe(false);
  });
});
