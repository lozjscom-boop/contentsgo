import Link from "next/link";
import { Suspense } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";
import ResolveButtons from "./resolve";

const STATUSES = ["queued", "running", "provider_unknown", "failed", "ready"];

async function List({ sp }: { sp: Promise<{ status?: string }> }) {
  const { status } = await sp;
  let q = createAdminSupabase().from("jobs").select("id, workspace_id, kind, status, attempts, stage, last_error, estimated_credits, updated_at").order("updated_at", { ascending: false }).limit(60);
  if (status && STATUSES.includes(status)) q = q.eq("status", status);
  const { data } = await q;
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {(data ?? []).map((j) => (
        <li key={j.id} className="px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><span className={`badge mr-2 ${j.status === "failed" ? "badge-danger" : j.status === "provider_unknown" ? "badge-warn" : j.status === "ready" ? "badge-ok" : ""}`}>{j.status}</span>{j.kind} · {j.stage ?? "-"} · 시도 {j.attempts} · {j.estimated_credits} 크레딧</span>
            <span className="text-xs text-muted"><Link className="underline" href={`/ops/customers/${j.workspace_id}`}>{j.workspace_id.slice(0, 8)}</Link> · {new Date(j.updated_at).toLocaleString("ko-KR")}</span>
          </div>
          {j.last_error && <p className="mt-1 truncate text-xs text-muted">{j.last_error}</p>}
          {j.status === "provider_unknown" && <ResolveButtons jobId={j.id} />}
        </li>
      ))}
      {!data?.length && <li className="p-6 text-center text-sm text-muted">해당하는 작업이 없어요.</li>}
    </ul>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  return (
    <>
      <h1 className="page-title">작업</h1>
      <p className="page-sub">provider_unknown 은 외부 AI에 요청은 갔지만 결과를 확인하지 못한 작업이에요. 제공사 콘솔에서 실제 생성 여부를 확인한 뒤 처리하세요. 자동으로 다시 요청하지 않아요.</p>
      <div className="mt-4 flex flex-wrap gap-2"><Link href="/ops/jobs" className="chip">전체</Link>{STATUSES.map((s) => <Link key={s} href={`/ops/jobs?status=${s}`} className="chip">{s}</Link>)}</div>
      <div className="mt-4"><Suspense fallback={<div className="skeleton h-48" />}><List sp={searchParams} /></Suspense></div>
    </>
  );
}
