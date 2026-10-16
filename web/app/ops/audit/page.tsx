import { Suspense } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";

async function List() {
  const { data } = await createAdminSupabase().from("audit_events").select("id, actor_kind, action, target_type, target_id, detail, workspace_id, created_at").order("created_at", { ascending: false }).limit(100);
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {(data ?? []).map((e) => (
        <li key={e.id} className="px-4 py-2.5 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span><span className="badge mr-2">{e.actor_kind}</span>{e.action}</span><span className="text-xs text-muted">{new Date(e.created_at).toLocaleString("ko-KR")}</span></div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted">{e.workspace_id?.slice(0, 8)} {e.target_type} {e.target_id?.slice(0, 8)} {JSON.stringify(e.detail)}</p>
        </li>
      ))}
    </ul>
  );
}

export default function Page() {
  return (<><h1 className="page-title">감사 기록</h1><p className="page-sub">삭제·수정할 수 없는 기록이에요. 최근 100건.</p><div className="mt-4"><Suspense fallback={<div className="skeleton h-48" />}><List /></Suspense></div></>);
}
