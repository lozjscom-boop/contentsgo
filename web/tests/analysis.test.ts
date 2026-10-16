import { describe, expect, it } from "vitest";
import { VideoAnalysisResult, geminiVideoMime } from "../lib/analysis/schema";

const ok = {
  summary: "s", format: "사용 장면형",
  hook: { first_3_sec: "a", technique: "b", why_it_works: "c" },
  structure: [{ start_sec: 0, end_sec: 3, role: "훅", what_happens: "x" }],
  appeals: ["a"], strengths: [], weaknesses: [], reusable_ideas: ["i"],
};

describe("영상 분석 스키마", () => {
  it("필수 항목이 있으면 통과하고 기본값을 채운다", () => {
    const r = VideoAnalysisResult.parse(ok);
    expect(r.cta).toBe("");
    expect(r.risks).toEqual([]);
    expect(r.structure[0].on_screen_text).toBe("");
  });
  it("구성 구간이나 재사용 아이디어가 비면 거부한다", () => {
    expect(VideoAnalysisResult.safeParse({ ...ok, structure: [] }).success).toBe(false);
    expect(VideoAnalysisResult.safeParse({ ...ok, reusable_ideas: [] }).success).toBe(false);
  });
  it("iPhone mov는 Gemini 형식으로 바꾼다", () => {
    expect(geminiVideoMime("video/quicktime")).toBe("video/mov");
    expect(geminiVideoMime("video/mp4")).toBe("video/mp4");
  });
});
