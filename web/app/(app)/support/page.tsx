import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import NewTicket from "./new-ticket";

const STATUS_LABEL: Record<string, string> = { open: "접수됨", triaged: "확인 중", waiting_customer: "답변 기다리는 중", in_progress: "처리 중", resolved: "해결됨", closed: "종료" };

async function Tickets() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("support_tickets").select("id, subject, status, last_message_at").order("last_message_at", { ascending: false }).limit(30);
  if (!data?.length) return <p className="card p-6 text-center text-sm text-muted">아직 보낸 문의가 없어요.</p>;
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {data.map((t) => (
        <li key={t.id}><Link href={`/support/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{t.subject}</span><span className="text-xs text-muted">{new Date(t.last_message_at).toLocaleString("ko-KR")}</span></span>
          <span className={`shrink-0 badge ${t.status === "resolved" || t.status === "closed" ? "badge-ok" : t.status === "waiting_customer" ? "badge-warn" : ""}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
        </Link></li>
      ))}
    </ul>
  );
}

export default function Page() {
  return (
    <div className="page max-w-3xl">
      <h1 className="page-title">도움말·문의</h1>
      <p className="page-sub">막히는 부분이나 이상한 결과를 알려주세요. 보통 영업일 기준 하루 안에 답해드려요.</p>
      <div className="mt-6"><NewTicket /></div>
      <h2 className="mb-3 mt-10 text-base font-semibold">내 문의</h2>
      <Suspense fallback={<div className="skeleton h-32" />}><Tickets /></Suspense>
    </div>
  );
}
