export type JobKind = "plan" | "image" | "video" | "render" | "analysis";
export type JobStatus = "queued" | "running" | "provider_unknown" | "review" | "ready" | "failed" | "cancelled";
export const TERMINAL: JobStatus[] = ["ready", "failed", "cancelled", "review"];

export type JobRow = {
  id: string; workspace_id: string; deliverable_id: string | null; kind: JobKind; status: JobStatus;
  payload: Record<string, unknown>; attempts: number; max_attempts: number; estimated_credits: number | string;
  locked_by: string | null; request_key: string;
};

/** 외부 호출이 확실히 일어나지 않았거나 일시적 장애인 경우 → 백오프 후 재시도 (횟수 한도 안에서) */
export class RetryableError extends Error {
  constructor(message: string, public readonly delaySec = 20) {
    super(message);
    this.name = "RetryableError";
  }
}

export type HandlerResult = { captured: number };
export type HandlerCtx = { attemptNo: number };
export interface JobHandler {
  run(job: JobRow, ctx: HandlerCtx): Promise<HandlerResult>;
  /** 최종 실패 시 연결된 장면/분석 행의 상태를 정리한다 */
  onFailed?(job: JobRow, message: string): Promise<void>;
  /** 고객 알림 문구 */
  notify?(job: JobRow, ok: boolean): { title: string; body?: string; link?: string };
}
