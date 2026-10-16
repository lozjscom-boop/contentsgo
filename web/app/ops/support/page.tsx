import Link from "next/link";
import { Suspense } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";

async function List({ sp }: { sp: Promise<{ status?: string }> }) {
  const { status } = await sp;
  let q = createAdminSupabase().from("support_tickets").select("id, subject, status, priority, category, last_message_at").order("last_message_at", { ascending: false }).limit(60);
  q = status ? q.eq("status", status) : q.in("status", ["open", "triaged", "in_progress", "waiting_customer"]);
  const { data } = await q;
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {(data ?? []).map((t) => (
        <li key={t.id}><Link href={`/ops/support/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2">
          <span className="min-w-0 truncate">{t.priority === "urgent" && <span className="badge badge-danger mr-2">긴급</span>}{t.subject}<span className="ml-2 text-xs text-muted">{t.category}</span></span>
          <span className="shrink-0 text-xs text-muted">{t.status} · {new Date(t.last_message_at).toLocaleString("ko-KR")}</span>
        </Link></li>
      ))}
      {!data?.length && <li className="p-6 text-center text-sm text-muted">처리할 문의가 없어요.</li>}
    </ul>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  return (
    <>
      <h1 className="page-title">문의</h1>
      <div className="mt-4 flex flex-wrap gap-2">{[["", "처리 대기"], ["resolved", "해결됨"], ["closed", "종료"]].map(([v, l]) => <Link key={v} href={v ? `/ops/support?status=${v}` : "/ops/support"} className="chip">{l}</Link>)}</div>
      <div className="mt-4"><Suspense fallback={<div className="skeleton h-48" />}><List sp={searchParams} /></Suspense></div>
    </>
  );
}
