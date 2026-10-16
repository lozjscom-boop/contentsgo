import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";
import Reply from "./reply";

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminSupabase();
  const { data: t } = await admin.from("support_tickets").select("id, subject, status, category, workspace_id, requester_id").eq("id", id).maybeSingle();
  if (!t) notFound();
  const [{ data: msgs }, who] = await Promise.all([
    admin.from("support_messages").select("id, author_kind, visibility, body, created_at").eq("ticket_id", id).order("created_at"),
    admin.auth.admin.getUserById(t.requester_id),
  ]);
  return (
    <>
      <h1 className="page-title">{t.subject}</h1>
      <p className="page-sub">{who.data.user?.email} · {t.category} · <a className="underline" href={`/ops/customers/${t.workspace_id}`}>고객 보기</a></p>
      <ul className="mt-6 space-y-3">
        {(msgs ?? []).map((m) => (
          <li key={m.id} className={`card p-4 text-sm ${m.visibility === "internal" ? "!border-warn/50" : m.author_kind === "staff" ? "ml-8 !bg-surface-2" : "mr-8"}`}>
            <p className="mb-1 text-xs text-muted">{m.author_kind === "staff" ? "운영" : "고객"}{m.visibility === "internal" ? " · 내부 메모" : ""} · {new Date(m.created_at).toLocaleString("ko-KR")}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
      <Reply ticketId={t.id} status={t.status} />
    </>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<div className="skeleton h-64" />}><Body params={params} /></Suspense>;
}
