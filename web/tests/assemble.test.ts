import { describe, expect, it } from "vitest";
import { assembleDeliverable } from "../lib/planning/assemble";
import { DeliverableDocument } from "../lib/planning/schemas";
import { body, concept, cta, hook } from "./fixtures";

const base = { productName: "고체향수 스틱", concept: concept(), hook: hook(), body: body(), cta: cta() };

describe("assembleDeliverable - video", () => {
  const doc = assembleDeliverable({ ...base, type: "video" });

  it("훅 0~3초 → 브랜드 한 줄 3~8초 → 본문 → 전환 순서", () => {
    const [s1, s2] = doc.scenes;
    expect([s1.role, s1.start_sec, s1.end_sec]).toEqual(["hook", 0, 3]);
    expect([s2.role, s2.start_sec, s2.end_sec]).toEqual(["brand_line", 3, 8]);
    expect(doc.scenes.at(-1)?.role).toBe("cta");
  });

  it("장면이 비거나 겹치지 않고 전체 길이를 정확히 채운다", () => {
    // 훅(0-3) 이후 브랜드(3-8) → 본문 → 전환이 끊김 없이 이어진다
    const seq = doc.scenes.map((s) => [s.start_sec!, s.end_sec!]);
    for (let i = 1; i < seq.length; i++) expect(seq[i][0]).toBe(seq[i - 1][1]);
    expect(seq.at(-1)![1]).toBe(15);
  });

  it("전환(CTA)은 마지막 3초", () => {
    const last = doc.scenes.at(-1)!;
    expect(last.end_sec! - last.start_sec!).toBe(3);
  });

  it("문구는 항상 오버레이 방식, 프롬프트에 문구가 섞이지 않는다", () => {
    expect(doc.scenes.every((s) => s.caption_mode === "overlay")).toBe(true);
  });

  it("제품 정확성이 중요한 장면만 원본 보존으로 표시한다", () => {
    const byKey = Object.fromEntries(doc.scenes.map((s) => [s.scene_key, s.preserve_product]));
    expect(byKey.s1).toBe(true); // 훅
    expect(byKey.s2).toBe(true); // 브랜드 한 줄
    expect(byKey.s3).toBe(false); // message beat
    expect(byKey.s4).toBe(true); // proof beat
  });

  it("너무 짧은 영상은 만들지 않고 이유를 알려준다", () => {
    expect(() => assembleDeliverable({ ...base, type: "video", totalSec: 10 })).toThrow(/너무 짧/);
  });

  it("태그(제작물 ID와 함께 나중에 메타고 성과와 연결할 고리)가 부품 단위로 남는다", () => {
    expect(doc.tags).toMatchObject({
      pattern: "use_moment",
      hook_label: "wrist_swipe",
      body_label: "demo_basic",
      cta_label: "offer_10",
      body_type: "demo",
    });
    expect(doc.tags.knowhow_version).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("결과는 저장 스키마를 통과한다", () => {
    expect(() => DeliverableDocument.parse(doc)).not.toThrow();
    expect(doc.aspect).toBe("9:16");
  });
});

describe("assembleDeliverable - carousel / image", () => {
  it("캐러셀: 첫 장 attention, 마지막 장 cta, 페이지별 설득 역할", () => {
    const doc = assembleDeliverable({ ...base, type: "carousel" });
    expect(doc.scenes.map((s) => s.slide_role)).toEqual(["attention", "message", "message", "proof", "cta"]);
    expect(doc.aspect).toBe("4:5");
    expect(doc.scenes[0].scene_key).toBe("p1");
  });

  it("단일 이미지: 한 장 안에 훅 → 브랜드 한 줄 → 혜택 문구 우선순위", () => {
    const doc = assembleDeliverable({ ...base, type: "image" });
    expect(doc.scenes).toHaveLength(1);
    expect(doc.scenes[0].caption).toBe("약속 장소 들어가기 직전");
    expect(doc.scenes[0].overlay_lines).toEqual(["르오즈, 꺼내서 슥", "첫 구매 10% 할인"]);
    expect(doc.aspect).toBe("1:1");
  });

  it("후기 형식 연출이면 표시 문구가 산출물에 함께 남는다", () => {
    const doc = assembleDeliverable({
      ...base,
      type: "carousel",
      body: body({ body_type: "review_staged", staged_disclosure: "연출된 장면입니다" }),
    });
    expect(doc.disclosures).toEqual(["연출된 장면입니다"]);
  });
});
