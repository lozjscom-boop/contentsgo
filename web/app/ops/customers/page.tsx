import Link from "next/link";
import { Suspense } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";

async function List({ sp }: { sp: Promise<{ q?: string }> }) {
  const { q } = await sp;
  const admin = createAdminSupabase();
  let query = admin.from("workspaces").select("id, name, created_at").order("created_at", { ascending: false }).limit(50);
  if (q?.trim()) query = query.ilike("name", `%${q.trim().replace(/[%_]/g, "")}%`);
  const { data } = await query;
  const ids = (data ?? []).map((w) => w.id);
  const { data: wallets } = ids.length ? await admin.from("wallet_accounts").select("workspace_id, available").in("workspace_id", ids) : { data: [] };
  const bal = new Map((wallets ?? []).map((w) => [w.workspace_id, Number(w.available)]));
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {(data ?? []).map((w) => (
        <li key={w.id}><Link href={`/ops/customers/${w.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2">
          <span className="min-w-0"><span className="block truncate font-medium">{w.name}</span><span className="text-xs text-muted">{new Date(w.created_at).toLocaleDateString("ko-KR")} · {w.id.slice(0, 8)}</span></span>
          <span className="tabular-nums text-muted">{(bal.get(w.id) ?? 0).toLocaleString("ko-KR")} 크레딧</span>
        </Link></li>
      ))}
      {!data?.length && <li className="p-6 text-center text-sm text-muted">검색 결과가 없어요.</li>}
    </ul>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return (
    <>
      <h1 className="page-title">고객</h1>
      <form className="mt-4 flex gap-2"><input name="q" className="field max-w-sm" placeholder="워크스페이스 이름 검색" aria-label="검색" /><button className="btn">검색</button></form>
      <div className="mt-4"><Suspense fallback={<div className="skeleton h-48" />}><List sp={searchParams} /></Suspense></div>
    </>
  );
}
