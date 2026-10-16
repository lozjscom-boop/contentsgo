import { route, json } from "@/lib/api/route";
import { DomainError } from "@/lib/errors";
import { runWorker, sweep } from "@/lib/jobs/runner";
import { timingSafeEqual } from "node:crypto";

export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 설정 전에는 외부에서 호출할 수 없다
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given); const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 스위퍼 + 워커. 호출처: Vercel Cron(GET) 또는 Supabase pg_cron/pg_net(POST), 헤더 Authorization: Bearer $CRON_SECRET.
 * 응답 직후 처리되지 못한 작업(after() 실패/함수 종료)을 건져내고, 임대가 끊긴 작업을 정리한다.
 */
async function handle(req: Request) {
  if (!authorized(req)) throw new DomainError("forbidden", 403, "권한이 없어요.");
  const swept = await sweep();
  const worked = await runWorker({ budgetMs: 240_000 });
  return json({ ok: true, ...swept, ...worked });
}
export const GET = route("jobs.run", async (req) => handle(req));
export const POST = route("jobs.run", async (req) => handle(req));
