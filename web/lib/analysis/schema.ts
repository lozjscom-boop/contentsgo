import { z } from "zod";

const Seg = z.object({
  start_sec: z.number().min(0),
  end_sec: z.number().min(0),
  role: z.string().min(1).max(40),
  what_happens: z.string().min(1).max(300),
  on_screen_text: z.string().max(200).default(""),
});

/** 영상 분석 결과: 내 기획에 재사용할 수 있는 구조로 받는다. */
export const VideoAnalysisResult = z.object({
  summary: z.string().min(1).max(500),
  format: z.string().max(100),
  hook: z.object({
    first_3_sec: z.string().max(400),
    technique: z.string().max(200),
    why_it_works: z.string().max(400),
  }),
  structure: z.array(Seg).min(1).max(20),
  appeals: z.array(z.string().max(200)).min(1).max(8),
  cta: z.string().max(300).default(""),
  strengths: z.array(z.string().max(300)).max(8),
  weaknesses: z.array(z.string().max(300)).max(8),
  reusable_ideas: z.array(z.string().max(300)).min(1).max(8),
  risks: z.array(z.string().max(300)).max(8).default([]),
});
export type VideoAnalysisResult = z.infer<typeof VideoAnalysisResult>;

/** Gemini가 인식하는 MIME으로 맞춘다 (iPhone .mov = video/quicktime) */
export const geminiVideoMime = (mime: string) => (mime === "video/quicktime" ? "video/mov" : mime);

export const ANALYSIS_SYSTEM = `너는 숏폼 광고 영상을 분석하는 한국어 마케팅 크리에이티브 분석가다.
영상에서 실제로 보이고 들리는 것만 근거로 쓴다. 보이지 않는 성과·조회수·매출·효과는 추측하지 않는다.
출력은 JSON 하나만, 아래 키로 작성한다. 모든 문장은 한국어 존댓말 없이 간결한 서술체.
{
 "summary": 영상 한 줄 요약,
 "format": 영상 형식(예: 사용 장면형, 비교형, 후기형),
 "hook": {"first_3_sec": 처음 3초에 보이는 것, "technique": 시선을 잡는 기법, "why_it_works": 효과가 있는 이유},
 "structure": [{"start_sec","end_sec","role":"훅|문제|제품소개|증명|전환 등","what_happens","on_screen_text"}],
 "appeals": [소구 포인트들],
 "cta": 전환 유도 방식,
 "strengths": [잘된 점], "weaknesses": [아쉬운 점],
 "reusable_ideas": [내 제품 광고에 응용할 수 있는 아이디어],
 "risks": [광고 심의·과장·초상권·저작권 측면 주의점]
}`;
