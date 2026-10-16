import "server-only";
import { connection, NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth";
import { DomainError, fromDbMessage } from "@/lib/errors";
import { ProviderNotConfiguredError } from "@/lib/providers/llm";

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Ctx, meta: { requestId: string }) => Promise<Response>;

/**
 * 모든 API route 공통 래퍼.
 *  - request_id 발급·응답 포함, 구조화 로그(JSON 한 줄)
 *  - 오류를 일관된 형식 {error, detail, request_id}과 상태 코드로 변환 (공급사 원문·내부 메시지는 노출하지 않음)
 *  - 변경 요청(POST/PATCH/PUT/DELETE)은 Origin 검사 (같은 사이트에서 온 요청만)
 */
export function route(name: string, handler: Handler): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    await connection(); // 항상 요청 시점에 실행 (빌드 때 미리 만들어지지 않게). try 밖에 둬야 빌드의 중단 신호가 삼켜지지 않는다
    const requestId = crypto.randomUUID().slice(0, 12);
    const started = Date.now();
    let status = 200;
    let code: string | undefined;
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !sameOrigin(req)) {
        throw new DomainError("bad_origin", 403, "허용되지 않은 요청이에요.");
      }
      const res = await handler(req, ctx, { requestId });
      status = res.status;
      res.headers.set("x-request-id", requestId);
      return res;
    } catch (e) {
      const { body, st } = toResponse(e);
      status = st;
      code = body.error;
      if (st >= 500) console.error(JSON.stringify({ level: "error", route: name, requestId, error: (e as Error)?.message?.slice(0, 300) }));
      return NextResponse.json({ ...body, request_id: requestId }, { status: st, headers: { "x-request-id": requestId } });
    } finally {
      console.log(JSON.stringify({ level: "info", route: name, requestId, method: req.method, status, code, ms: Date.now() - started }));
    }
  };
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;                                       // 서버 간 호출·같은 출처 fetch는 Origin이 없을 수 있다 (쿠키 SameSite=Lax가 1차 방어)
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function toResponse(e: unknown): { body: { error: string; detail?: string }; st: number } {
  if (e instanceof AuthError) return { body: { error: e.status === 401 ? "unauthorized" : "forbidden", detail: e.message }, st: e.status };
  if (e instanceof DomainError) return { body: { error: e.code, detail: e.message }, st: e.status };
  if (e instanceof ZodError) return { body: { error: "invalid_input", detail: e.issues[0]?.message }, st: 422 };
  if (e instanceof ProviderNotConfiguredError) return { body: { error: "provider_not_configured", detail: e.message }, st: 503 };
  const d = fromDbMessage((e as Error)?.message);
  if (d) return { body: { error: d.code, detail: d.message }, st: d.status };
  return { body: { error: "internal_error", detail: "잠시 후 다시 시도해주세요." }, st: 500 };
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/** 본문 JSON을 zod 스키마로 검증 */
export async function parseBody<T>(req: Request, schema: { parse: (v: unknown) => T }): Promise<T> {
  const raw = await req.json().catch(() => null);
  if (raw === null) throw new DomainError("invalid_input", 422, "요청 형식이 올바르지 않아요.");
  return schema.parse(raw);
}
