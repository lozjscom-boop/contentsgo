import { describe, expect, it } from "vitest";
import { createGeminiImage } from "../lib/providers/image";
import { createGeminiLlm, ProviderNotConfiguredError } from "../lib/providers/llm";
import { assertHiggsfieldUrl, createHiggsfieldVideo, ProviderUnknownError } from "../lib/providers/video";

describe("설정이 없으면 가짜 결과 대신 '설정 필요'", () => {
  it("LLM", () => {
    expect(() => createGeminiLlm({})).toThrow(ProviderNotConfiguredError);
    try {
      createGeminiLlm({ GEMINI_API_KEY: "k" });
    } catch (e) {
      expect((e as ProviderNotConfiguredError).missing).toEqual(["GEMINI_TEXT_MODEL"]);
    }
  });
  it("이미지", () => {
    expect(() => createGeminiImage({})).toThrow(ProviderNotConfiguredError);
  });
  it("영상", () => {
    expect(() => createHiggsfieldVideo({})).toThrow(/HIGGSFIELD_API_KEY_ID/);
  });
});

const env = {
  HIGGSFIELD_API_KEY_ID: "id1",
  HIGGSFIELD_API_KEY_SECRET: "sec1",
  HIGGSFIELD_VIDEO_MODEL_PATH: "/some/model/path",
};
const req = { prompt: "p", durationSec: 5, aspect: "9:16" as const, idempotencyKey: "job1:s1:1" };

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

describe("Higgsfield 영상 어댑터 계약", () => {
  it("제출: Key 인증 + Idempotency-Key를 보내고 request_id/status_url을 돌려준다", async () => {
    const f = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            status: "queued",
            request_id: "r1",
            status_url: "https://api.higgsfield.ai/requests/r1/status",
            cancel_url: "https://api.higgsfield.ai/requests/r1/cancel",
          }),
          { status: 200 },
        ),
    );
    const v = createHiggsfieldVideo(env, undefined, f.impl);
    const sub = await v.submit(req);
    expect(sub).toEqual({
      requestId: "r1",
      statusUrl: "https://api.higgsfield.ai/requests/r1/status",
      cancelUrl: "https://api.higgsfield.ai/requests/r1/cancel",
    });
    const headers = f.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Key id1:sec1");
    expect(headers["Idempotency-Key"]).toBe("job1:s1:1");
    expect(f.calls[0].url).toBe("https://api.higgsfield.ai/some/model/path");
  });

  it("타임아웃/네트워크 오류는 '접수 여부 불명'으로 올려 임의 재제출을 막는다", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(createHiggsfieldVideo(env, undefined, f.impl).submit(req)).rejects.toBeInstanceOf(ProviderUnknownError);
  });

  it("5xx도 접수 여부 불명, 4xx는 거절로 구분한다", async () => {
    const f5 = fakeFetch(() => new Response("", { status: 502 }));
    await expect(createHiggsfieldVideo(env, undefined, f5.impl).submit(req)).rejects.toBeInstanceOf(ProviderUnknownError);
    const f4 = fakeFetch(() => new Response("", { status: 422 }));
    await expect(createHiggsfieldVideo(env, undefined, f4.impl).submit(req)).rejects.not.toBeInstanceOf(ProviderUnknownError);
  });

  it("상태 조회: completed 이면 video.url을 꺼낸다", async () => {
    const f = fakeFetch(
      () => new Response(JSON.stringify({ status: "completed", request_id: "r1", video: { url: "https://cdn/x.mp4" } })),
    );
    const s = await createHiggsfieldVideo(env, undefined, f.impl).getStatus("https://api.higgsfield.ai/requests/r1/status");
    expect(s).toEqual({ status: "completed", videoUrl: "https://cdn/x.mp4", error: undefined });
  });

  it("공급사 도메인이 아닌 URL에는 자격증명을 보내지 않는다", async () => {
    const f = fakeFetch(() => new Response("{}"));
    const v = createHiggsfieldVideo(env, undefined, f.impl);
    await expect(v.getStatus("https://evil.example.com/requests/r1/status")).rejects.toThrow(/신뢰할 수 없는/);
    await expect(v.getStatus("https://api.higgsfield.ai.evil.com/x")).rejects.toThrow(/신뢰할 수 없는/);
    await expect(v.getStatus("http://api.higgsfield.ai/x")).rejects.toThrow(/신뢰할 수 없는/);
    expect(f.calls).toHaveLength(0);
    expect(() => assertHiggsfieldUrl("https://api.higgsfield.ai/x")).not.toThrow();
  });

  it("입력 업로드: presigned URL에는 Higgsfield 자격증명을 보내지 않는다", async () => {
    const f = fakeFetch((url) =>
      url.includes("generate-upload-url")
        ? new Response(
            JSON.stringify({
              public_url: "https://cdn.higgsfield.ai/in/a.jpg",
              upload_url: "https://s3.example.com/presigned",
              upload_headers: { "Content-Type": "image/jpeg", "x-amz-tagging": "t=1" },
            }),
          )
        : new Response("", { status: 200 }),
    );
    const url = await createHiggsfieldVideo(env, undefined, f.impl).uploadInput(new Uint8Array([1, 2]), "image/jpeg");
    expect(url).toBe("https://cdn.higgsfield.ai/in/a.jpg");
    const put = f.calls[1];
    expect(put.url).toBe("https://s3.example.com/presigned");
    expect((put.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((put.init.headers as Record<string, string>)["x-amz-tagging"]).toBe("t=1");
  });

  it("취소: 202(취소됨)와 400(이미 처리 시작)은 정상 처리, 나머지는 오류", async () => {
    const ok = fakeFetch(() => new Response(null, { status: 202 }));
    await expect(createHiggsfieldVideo(env, undefined, ok.impl).cancel("https://api.higgsfield.ai/requests/r1/cancel")).resolves.toBeUndefined();
    const started = fakeFetch(() => new Response("", { status: 400 }));
    await expect(createHiggsfieldVideo(env, undefined, started.impl).cancel("https://api.higgsfield.ai/requests/r1/cancel")).resolves.toBeUndefined();
    const bad = fakeFetch(() => new Response("", { status: 401 }));
    await expect(createHiggsfieldVideo(env, undefined, bad.impl).cancel("https://api.higgsfield.ai/requests/r1/cancel")).rejects.toThrow(/HTTP 401/);
  });
});
