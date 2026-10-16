import { ProviderNotConfiguredError, type Env } from "./llm";

/**
 * 영상 생성 공급사 어댑터 (Higgsfield API).
 *
 * 확인된 계약 (docs.higgsfield.ai, 2026-10-16 확인):
 *  - 인증: `Authorization: Key {KEY_ID}:{KEY_SECRET}`  (웹/MCP 크레딧과 별개인 API 전용 계정·달러 잔액)
 *  - 제출: POST https://api.higgsfield.ai/{model-path}  + `Idempotency-Key` → {request_id, status, status_url, cancel_url}
 *  - 상태: GET status_url → queued | in_progress | completed | failed | nsfw | canceled
 *  - 결과: completed 일 때 video.url. 출력 URL은 "최소 7일" 보관 → 즉시 우리 스토리지에 복사해야 한다.
 *  - 입력 이미지: POST /files/generate-upload-url → presigned PUT → public_url을 모델 파라미터에 넣는다.
 *  - 웹훅은 서명 검증 방식이 문서에 없다 → 웹훅 본문을 믿지 않고 항상 인증된 상태 조회로 재확인한다.
 *
 * 확인되지 않은 것 (콘솔 모델 페이지에서 확인 필요):
 *  - 모델별 요청 파라미터 이름/제약  → buildParams로 주입한다. 기본값은 일반적인 이름의 추정이므로 반드시 검증할 것.
 *  - 실패 시 환불 정책(문서에 설명 없음), rate limit
 *  - SaaS 고객에게 생성 기능을 되파는 것이 약관상 허용되는지 (출력물 상업 이용은 명시, 재판매는 미확인)
 */

export type VideoAspect = "9:16" | "1:1" | "4:5";

export type VideoRequest = {
  prompt: string;
  /** 제품 원본 등 기준 이미지의 공개 URL (uploadInput 결과) */
  imageUrl?: string;
  durationSec: number;
  aspect: VideoAspect;
  /** job/step/attempt 기반 키. 타임아웃 후 재시도 시 중복 생성을 막는다. */
  idempotencyKey: string;
};

export type VideoSubmission = { requestId: string; statusUrl: string; cancelUrl?: string };

export type VideoStatusName = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
export const TERMINAL_STATUSES: VideoStatusName[] = ["completed", "failed", "nsfw", "canceled"];

export type VideoStatus = { status: VideoStatusName; videoUrl?: string; error?: string };

/** 요청이 공급사에 접수됐는지 알 수 없는 경우(타임아웃/네트워크). 재제출 전에 반드시 확인 절차를 거친다. */
export class ProviderUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnknownError";
  }
}

export interface VideoGenerator {
  uploadInput(bytes: Uint8Array, contentType: string): Promise<string>;
  submit(req: VideoRequest): Promise<VideoSubmission>;
  getStatus(statusUrl: string): Promise<VideoStatus>;
  cancel(cancelUrl: string): Promise<void>;
}

export type BuildParams = (req: VideoRequest) => Record<string, unknown>;

/** 기본 매핑: 파라미터 이름은 모델마다 다르므로 콘솔 모델 페이지로 확인한 뒤 교체한다. */
export const defaultBuildParams: BuildParams = (req) => ({
  prompt: req.prompt,
  ...(req.imageUrl ? { image_url: req.imageUrl } : {}),
  duration: req.durationSec,
  aspect_ratio: req.aspect,
});

const API_BASE = "https://api.higgsfield.ai";
const HTTP_TIMEOUT_MS = 30_000;

/** 인증 헤더를 붙이기 전에 호스트를 확인한다(공급사 응답의 URL로 자격증명이 새는 것을 방지). */
export function assertHiggsfieldUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" || !(u.hostname === "higgsfield.ai" || u.hostname.endsWith(".higgsfield.ai"))) {
    throw new Error("신뢰할 수 없는 공급사 URL이에요.");
  }
  return u;
}

export function createHiggsfieldVideo(
  env: Env = process.env,
  buildParams: BuildParams = defaultBuildParams,
  fetchImpl: typeof fetch = fetch,
): VideoGenerator {
  const id = env.HIGGSFIELD_API_KEY_ID;
  const secret = env.HIGGSFIELD_API_KEY_SECRET;
  const modelPath = env.HIGGSFIELD_VIDEO_MODEL_PATH;
  const missing = [
    !id && "HIGGSFIELD_API_KEY_ID",
    !secret && "HIGGSFIELD_API_KEY_SECRET",
    !modelPath && "HIGGSFIELD_VIDEO_MODEL_PATH",
  ].filter(Boolean) as string[];
  if (missing.length) throw new ProviderNotConfiguredError("Higgsfield 영상", missing);

  const auth = { Authorization: `Key ${id}:${secret}` };

  async function call(url: string, init: RequestInit): Promise<Response> {
    return fetchImpl(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  }

  return {
    async uploadInput(bytes, contentType) {
      const res = await call(`${API_BASE}/files/generate-upload-url`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ content_type: contentType }),
      });
      if (!res.ok) throw new Error(`입력 파일 업로드 URL 발급 실패 (HTTP ${res.status})`);
      const j = (await res.json()) as {
        public_url: string;
        upload_url: string;
        upload_headers?: Record<string, string>;
      };
      // presigned 스토리지 URL에는 Higgsfield 자격증명을 보내지 않는다
      const put = await call(j.upload_url, {
        method: "PUT",
        headers: j.upload_headers ?? { "content-type": contentType },
        body: bytes as BodyInit,
      });
      if (!put.ok) throw new Error(`입력 파일 업로드 실패 (HTTP ${put.status})`);
      return j.public_url;
    },

    async submit(req) {
      let res: Response;
      try {
        res = await call(`${API_BASE}/${modelPath!.replace(/^\/+/, "")}`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json", "Idempotency-Key": req.idempotencyKey },
          body: JSON.stringify(buildParams(req)),
        });
      } catch {
        // 타임아웃/네트워크 오류: 접수 여부 불명. 임의로 재제출하지 않는다.
        throw new ProviderUnknownError("영상 요청 접수 여부를 확인할 수 없어요.");
      }
      if (res.status >= 500) throw new ProviderUnknownError(`공급사 오류 (HTTP ${res.status}). 접수 여부를 확인해야 해요.`);
      if (!res.ok) throw new Error(`영상 요청 거절 (HTTP ${res.status})`);
      const j = (await res.json()) as { request_id: string; status_url: string; cancel_url?: string };
      if (!j.request_id || !j.status_url) throw new Error("공급사 응답에 request_id/status_url이 없어요.");
      assertHiggsfieldUrl(j.status_url);
      return { requestId: j.request_id, statusUrl: j.status_url, cancelUrl: j.cancel_url };
    },

    async getStatus(statusUrl) {
      const url = assertHiggsfieldUrl(statusUrl);
      const res = await call(url.toString(), { method: "GET", headers: auth });
      if (!res.ok) throw new Error(`상태 조회 실패 (HTTP ${res.status})`);
      const j = (await res.json()) as {
        status: VideoStatusName;
        error?: string | null;
        video?: { url?: string };
      };
      return { status: j.status, videoUrl: j.video?.url, error: j.error ?? undefined };
    },

    async cancel(cancelUrl) {
      const url = assertHiggsfieldUrl(cancelUrl);
      const res = await call(url.toString(), { method: "POST", headers: auth });
      // 202=취소됨, 400=이미 처리 시작(취소 불가)
      if (res.status !== 202 && res.status !== 400) throw new Error(`취소 실패 (HTTP ${res.status})`);
    },
  };
}
