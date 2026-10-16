import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import Reply from "./reply";

const STATUS: Record<string, string> = { open: "접수됨", triaged: "확인 중", waiting_customer: "답변 기다리는 중", in_progress: "처리 중", resolved: "해결됨", closed: "종료" };

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: t } = await supabase.from("support_tickets").select("id, subject, status").eq("id", id).maybeSingle();
  if (!t) notFound();
  const { data: msgs } = await supabase.from("support_messages").select("id, author_kind, body, created_at").eq("ticket_id", id).eq("visibility", "customer").order("created_at");
  return (
    <>
      <div className="flex items-start justify-between gap-3"><h1 className="page-title">{t.subject}</h1><span className="badge shrink-0">{STATUS[t.status] ?? t.status}</span></div>
      <ul className="mt-6 space-y-3">
        {(msgs ?? []).map((m) => (
          <li key={m.id} className={`card max-w-[85%] p-4 text-sm ${m.author_kind === "staff" ? "" : "ml-auto !bg-surface-2"}`}>
            <p className="mb-1 text-xs text-muted">{m.author_kind === "staff" ? "컨텐츠고 팀" : "나"} · {new Date(m.created_at).toLocaleString("ko-KR")}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
      {t.status !== "closed" && <Reply ticketId={t.id} />}
    </>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="page max-w-3xl">
      <Link href="/support" className="text-sm text-muted hover:text-foreground">← 문의 목록</Link>
      <div className="mt-3"><Suspense fallback={<div className="skeleton h-48" />}><Body params={params} /></Suspense></div>
    </div>
  );
}
