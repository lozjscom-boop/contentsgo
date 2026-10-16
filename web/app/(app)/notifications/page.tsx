import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import MarkRead from "./mark-read";

const TONE = { info: "badge", success: "badge badge-ok", warning: "badge badge-warn", error: "badge badge-danger" } as const;

async function Body() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("notifications").select("id, kind, title, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(50);
  const rows = data ?? [];
  if (!rows.length) return <div className="card px-6 py-14 text-center"><p className="font-semibold">새 알림이 없어요</p><p className="mt-1 text-sm text-muted">제작이 끝나거나 문제가 생기면 여기에 알려드려요.</p></div>;
  const unread = rows.filter((r) => !r.read_at).length;
  return (
    <>
      {unread > 0 && <div className="mb-3 flex justify-end"><MarkRead /></div>}
      <ul className="card divide-y divide-line overflow-hidden">
        {rows.map((n) => {
          const inner = (
            <div className="flex gap-3 px-4 py-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-accent"}`} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{n.title}</span><span className={`${TONE[n.kind as keyof typeof TONE] ?? "badge"} shrink-0`}>{{ info: "안내", success: "완료", warning: "주의", error: "문제" }[n.kind as string] ?? "안내"}</span></p>
                {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{new Date(n.created_at).toLocaleString("ko-KR")}</p>
              </div>
            </div>
          );
          return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-surface-2">{inner}</Link> : inner}</li>;
        })}
      </ul>
    </>
  );
}

export default function Page() {
  return (
    <div className="page max-w-3xl">
      <h1 className="page-title">알림</h1>
      <div className="mt-6"><Suspense fallback={<div className="skeleton h-48" />}><Body /></Suspense></div>
    </div>
  );
}
