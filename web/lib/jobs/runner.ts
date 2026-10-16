import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import { imageHandler } from "./handlers/image";
import { analysisHandler } from "./handlers/analysis";
import { RetryableError, type JobHandler, type JobRow } from "./types";

const HANDLERS: Partial<Record<JobRow["kind"], JobHandler>> = { image: imageHandler, analysis: analysisHandler };
const LEASE_SECONDS = 300;
const HEARTBEAT_MS = 60_000;
const MIN_REMAINING_MS = 100_000; // 새 작업을 잡으려면 이 시간 이상 남아 있어야 한다 (함수 시간 제한 보호)

const safeMessage = (e: unknown) => {
  const m = e instanceof Error ? e.message : "failed";
  return m.replace(/(key|token|secret)[=:]\s*\S+/gi, "$1=***").slice(0, 300);
};

/**
 * 워커: claim(임대) → 핸들러 실행 → complete(정산+상태). 한 프로세스가 오래 돌지 않도록 시간 예산 안에서만 반복한다.
 * 어떤 경로로 호출돼도(요청 직후 after(), 스위퍼 cron) 같은 DB 임대 규칙을 따르므로 같은 job이 두 번 실행되지 않는다.
 */
export async function runWorker(opts: { budgetMs?: number; limit?: number; kinds?: string[] } = {}): Promise<{ processed: number }> {
  const admin = createAdminSupabase();
  const worker = `w-${crypto.randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const limits = await getSetting<{ worker_global_concurrency: number }>("limits");
  let processed = 0;

  while (deadline - Date.now() > MIN_REMAINING_MS) {
    const { data, error } = await admin.rpc("svc_claim_jobs", {
      p_worker: worker, p_limit: opts.limit ?? 2, p_lease_seconds: LEASE_SECONDS, p_per_ws: 2,
      p_global: limits.worker_global_concurrency ?? 6, p_kinds: opts.kinds ?? null,
    });
    if (error) { console.error(JSON.stringify({ level: "error", msg: "claim_failed", error: error.message })); break; }
    const jobs = (data ?? []) as JobRow[];
    if (!jobs.length) break;
    await Promise.all(jobs.map((j) => runOne(worker, j)));
    processed += jobs.length;
  }
  return { processed };
}

async function runOne(worker: string, job: JobRow) {
  const admin = createAdminSupabase();
  const handler = HANDLERS[job.kind];
  const beat = setInterval(() => { void admin.rpc("svc_job_heartbeat", { p_job: job.id, p_worker: worker, p_lease_seconds: LEASE_SECONDS }); }, HEARTBEAT_MS);
  const started = Date.now();
  try {
    if (!handler) throw new Error(`no_handler:${job.kind}`);
    const r = await handler.run(job, { attemptNo: job.attempts });
    const { data } = await admin.rpc("svc_complete_job", { p_job: job.id, p_worker: worker, p_status: "ready", p_captured: r.captured });
    if (data === false) console.error(JSON.stringify({ level: "warn", msg: "lease_lost_on_complete", job: job.id }));
    else await notify(job, handler, true);
    log(job, "ready", started);
  } catch (e) {
    const msg = safeMessage(e);
    if (e instanceof RetryableError) {
      const { data } = await admin.rpc("svc_retry_job", { p_job: job.id, p_worker: worker, p_delay_seconds: e.delaySec, p_error: msg });
      if (data === "failed") { await handler?.onFailed?.(job, msg); await notify(job, handler, false); }
      log(job, String(data), started);
    } else {
      const { data } = await admin.rpc("svc_complete_job", { p_job: job.id, p_worker: worker, p_status: "failed", p_captured: 0, p_error: msg });
      if (data !== false) { await handler?.onFailed?.(job, msg); await notify(job, handler, false); }
      log(job, "failed", started, msg);
    }
  } finally {
    clearInterval(beat);
  }
}

async function notify(job: JobRow, handler: JobHandler | undefined, ok: boolean) {
  const userId = String(job.payload.userId ?? "");
  if (!userId || !handler?.notify) return;
  const n = handler.notify(job, ok);
  await createAdminSupabase().rpc("svc_notify", {
    p_user: userId, p_ws: job.workspace_id, p_event_key: `job:${job.id}:${ok ? "done" : "failed"}`,
    p_kind: ok ? "success" : "error", p_title: n.title, p_body: n.body ?? null, p_link: n.link ?? null,
  });
}

function log(job: JobRow, outcome: string, started: number, error?: string) {
  console.log(JSON.stringify({ level: "info", msg: "job", job: job.id, kind: job.kind, outcome, ms: Date.now() - started, error }));
}

/** 스위퍼: 임대 만료 정리 + 만료 크레딧 소멸. cron에서 호출. */
export async function sweep() {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("svc_sweep_jobs");
  if (error) throw new Error(error.message);
  // 만료된 크레딧 정리도 같은 주기에 처리 (워크스페이스 수가 늘면 배치 크기로 나눠 처리)
  const { error: exErr } = await admin.rpc("svc_expire_all_credits", { p_limit: 200 });
  if (exErr) console.error(JSON.stringify({ level: "warn", msg: "expire_failed", error: exErr.message }));
  const row = (Array.isArray(data) ? data[0] : data) as { requeued: number; unknown: number } | undefined;
  return { requeued: row?.requeued ?? 0, unknown: row?.unknown ?? 0 };
}
