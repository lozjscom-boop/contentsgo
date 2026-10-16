import { GoogleGenAI } from "@google/genai";
import { ProviderNotConfiguredError, type Env } from "./llm";

export type ImageAspect = "1:1" | "4:5" | "9:16";

export type ReferenceImage = { mimeType: string; dataBase64: string };

export type ImageRequest = {
  /** 긍정형 직접 서술, 한글 문구 제외 (lint 통과본) */
  prompt: string;
  aspect: ImageAspect;
  /** 제품 원본 사진 등 보존해야 하는 참조 이미지 */
  references?: ReferenceImage[];
  imageSize?: "1K" | "2K";
};

export type ImageResult = {
  mimeType: string;
  dataBase64: string;
  providerRequestId: string;
};

export interface ImageGenerator {
  generate(req: ImageRequest): Promise<ImageResult>;
}

/**
 * Gemini 이미지 생성 어댑터 (Interactions API).
 *   GEMINI_API_KEY, GEMINI_IMAGE_MODEL
 * 결과는 base64로만 돌려준다. 호출 측이 즉시 우리 Storage에 저장해야 한다(공급사 임시 URL을 장기 주소로 쓰지 않음).
 * 호출은 유료이므로 이 함수 안에서 자동 재시도하지 않는다 — 재제출은 job 계층이 과금 경계를 확인한 뒤 결정한다.
 */
export function createGeminiImage(env: Env = process.env): ImageGenerator {
  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_IMAGE_MODEL;
  const missing = [!apiKey && "GEMINI_API_KEY", !model && "GEMINI_IMAGE_MODEL"].filter(Boolean) as string[];
  if (missing.length) throw new ProviderNotConfiguredError("Gemini 이미지", missing);

  const ai = new GoogleGenAI({ apiKey: apiKey! });

  return {
    async generate(req: ImageRequest): Promise<ImageResult> {
      const input = [
        { type: "text" as const, text: req.prompt },
        ...(req.references ?? []).map((r) => ({
          type: "image" as const,
          mime_type: r.mimeType,
          data: r.dataBase64,
        })),
      ];

      let interaction;
      try {
        interaction = await ai.interactions.create({
          model: model!,
          input,
          response_format: {
            type: "image",
            aspect_ratio: req.aspect,
            image_size: req.imageSize ?? "1K",
          },
          store: false,
        });
      } catch (e) {
        const status = (e as { status?: number }).status;
        throw new Error(`Gemini 이미지 요청 실패${status ? ` (HTTP ${status})` : ""}`);
      }

      const img = interaction.output_image;
      if (!img?.data) throw new Error("Gemini 이미지 응답에 이미지가 없어요.");
      return {
        mimeType: img.mime_type ?? "image/jpeg",
        dataBase64: img.data,
        providerRequestId: interaction.id ?? "",
      };
    },
  };
}
