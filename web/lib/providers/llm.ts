import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";

/** API 키·모델이 설정되지 않았을 때. 가짜 결과를 만들지 않고 이 에러로 "설정 필요"를 알린다. */
export class ProviderNotConfiguredError extends Error {
  constructor(
    public readonly provider: string,
    public readonly missing: string[],
  ) {
    super(`${provider} 설정이 필요해요: ${missing.join(", ")}`);
    this.name = "ProviderNotConfiguredError";
  }
}

/** 모델 출력이 JSON이 아니거나 스키마와 다를 때 (교정 1회 대상) */
export class LlmOutputError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = "LlmOutputError";
  }
}

export type LlmRequest<T> = {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
};

export interface LlmClient {
  generateJson<T>(req: LlmRequest<T>): Promise<T>;
}

export type Env = Record<string, string | undefined>;

/**
 * Gemini Interactions API 어댑터 (공식 SDK 2.x).
 * 모델 ID는 코드에 박지 않고 환경변수로 받는다(공급사 모델명은 자주 바뀜).
 *   GEMINI_API_KEY, GEMINI_TEXT_MODEL
 * store:false — 고객 제품·기획 내용을 공급사 서버에 보관하지 않도록 요청한다.
 */
export function createGeminiLlm(env: Env = process.env): LlmClient {
  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_TEXT_MODEL;
  const missing = [!apiKey && "GEMINI_API_KEY", !model && "GEMINI_TEXT_MODEL"].filter(Boolean) as string[];
  if (missing.length) throw new ProviderNotConfiguredError("Gemini", missing);

  const ai = new GoogleGenAI({ apiKey: apiKey! });

  return {
    async generateJson<T>(req: LlmRequest<T>): Promise<T> {
      let text = "";
      try {
        const interaction = await ai.interactions.create({
          model: model!,
          input: req.user,
          system_instruction: req.system,
          // 스키마는 프롬프트에 포함하고 zod로 검증한다(공급사 스키마 방언 차이 회피)
          response_format: { type: "text", mime_type: "application/json" },
          generation_config: { temperature: req.temperature ?? 0.8 },
          store: false,
        });
        text = interaction.output_text ?? "";
      } catch (e) {
        // 키/요청 본문은 로그에 남기지 않는다
        const status = (e as { status?: number }).status;
        throw new Error(`Gemini 요청 실패${status ? ` (HTTP ${status})` : ""}`);
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new LlmOutputError("모델 출력이 올바른 JSON이 아니에요.", text);
      }
      const parsed = req.schema.safeParse(json);
      if (!parsed.success) {
        throw new LlmOutputError(
          `출력이 스키마와 달라요: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
          text,
        );
      }
      return parsed.data;
    },
  };
}
