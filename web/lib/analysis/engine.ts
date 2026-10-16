import { GoogleGenAI } from "@google/genai";
import { ANALYSIS_SYSTEM, VideoAnalysisResult, geminiVideoMime } from "./schema";
import { LlmOutputError, ProviderNotConfiguredError, type Env } from "@/lib/providers/llm";

export type AnalyzeInput = { bytes: Uint8Array; mime: string; context?: string };

/** 영상을 Gemini Files API로 올리고(ACTIVE 대기) 구조화 분석을 받는다. 키·영상은 로그에 남기지 않는다. */
export async function analyzeVideo(input: AnalyzeInput, env: Env = process.env): Promise<{ result: VideoAnalysisResult; modelId: string }> {
  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_TEXT_MODEL;
  const missing = [!apiKey && "GEMINI_API_KEY", !model && "GEMINI_TEXT_MODEL"].filter(Boolean) as string[];
  if (missing.length) throw new ProviderNotConfiguredError("Gemini", missing);
  const ai = new GoogleGenAI({ apiKey: apiKey! });
  const mime = geminiVideoMime(input.mime);

  let fileName = "";
  try {
    const up = await ai.files.upload({ file: new Blob([input.bytes as BlobPart], { type: mime }), config: { mimeType: mime } });
    fileName = up.name ?? "";
    let file = up;
    for (let i = 0; i < 40 && file.state !== "ACTIVE"; i++) {
      if (file.state === "FAILED") throw new Error("영상 처리에 실패했어요");
      await new Promise((r) => setTimeout(r, 3000));
      file = await ai.files.get({ name: fileName });
    }
    if (file.state !== "ACTIVE" || !file.uri) throw new Error("영상 처리 시간이 초과됐어요");

    const text = `${input.context ? `참고: ${input.context}\n` : ""}이 영상을 분석해 JSON으로만 답해.`;
    let out = "";
    try {
      const it = await ai.interactions.create({
        model: model!,
        input: [
          { type: "text", text },
          { type: "video", uri: file.uri, mime_type: mime },
        ],
        system_instruction: ANALYSIS_SYSTEM,
        response_format: { type: "text", mime_type: "application/json" },
        generation_config: { temperature: 0.3 },
        store: false,
      });
      out = it.output_text ?? "";
    } catch (e) {
      const status = (e as { status?: number }).status;
      throw new Error(`Gemini 분석 요청 실패${status ? ` (HTTP ${status})` : ""}`);
    }
    let json: unknown;
    try { json = JSON.parse(out); } catch { throw new LlmOutputError("분석 결과가 JSON이 아니에요.", out); }
    const parsed = VideoAnalysisResult.safeParse(json);
    if (!parsed.success) throw new LlmOutputError(`분석 결과가 형식과 달라요: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, out);
    return { result: parsed.data, modelId: model! };
  } finally {
    if (fileName) await ai.files.delete({ name: fileName }).catch(() => undefined); // 업로드한 영상은 분석 직후 공급사에서 삭제
  }
}
