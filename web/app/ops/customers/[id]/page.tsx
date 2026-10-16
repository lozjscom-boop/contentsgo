import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";
import Actions from "./actions";

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const admin = createAdminSupabase();
  const { data: ws } = await admin.from("workspaces").select("id, name, created_at").eq("id", id).maybeSingle();
  if (!ws) notFound();
  const [{ data: wallet }, { data: buckets }, { data: ledger }, { data: ent }, { data: ms }, { data: rec }] = await Promise.all([
    admin.from("wallet_accounts").select("available, reserved").eq("workspace_id", id).maybeSingle(),
    admin.from("credit_buckets").select("id, source, granted, remaining, expires_at").eq("workspace_id", id).gt("remaining", 0).order("expires_at", { nullsFirst: false }),
    admin.from("credit_ledger").select("type, amount, note, created_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(20),
    admin.from("entitlements").select("source, plan_versions(code, name)").eq("workspace_id", id).eq("status", "active").maybeSingle(),
    admin.from("memberships").select("user_id, role").eq("workspace_id", id).eq("status", "active"),
    admin.rpc("svc_wallet_reconcile", { p_ws: id }),
  ]);
  const members = await Promise.all((ms ?? []).map(async (m) => ({ role: m.role, email: (await admin.auth.admin.getUserById(m.user_id)).data.user?.email ?? m.user_id })));
  const plan = ent?.plan_versions as unknown as { code: string; name: string } | null;
  const r = (Array.isArray(rec) ? rec[0] : rec) as { ok: boolean } | undefined;
  return (
    <>
      <h1 className="page-title">{ws.name}</h1>
      <p className="page-sub font-mono text-xs">{ws.id}</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card p-5"><p className="text-sm text-muted">잔액</p><p className="mt-1 text-3xl font-bold tabular-nums">{Number(wallet?.available ?? 0).toLocaleString("ko-KR")}</p><p className="mt-1 text-xs text-muted">예약 {Number(wallet?.reserved ?? 0)}</p>
          <p className={`mt-3 text-xs ${r?.ok === false ? "text-danger" : "text-ok"}`}>{r ? (r.ok ? "원장·지갑·버킷 정합성 정상" : "정합성 불일치 — 확인 필요") : "정합성 정보 없음"}</p></div>
        <div className="card p-5"><p className="text-sm text-muted">플랜</p><p className="mt-1 text-2xl font-bold">{plan?.name ?? "-"}</p><p className="mt-1 text-xs text-muted">{ent?.source}</p></div>
        <div className="card p-5"><p className="text-sm text-muted">멤버 {members.length}명</p><ul className="mt-2 space-y-1 text-sm">{members.map((m) => <li key={m.email} className="truncate">{m.email} <span className="text-muted">· {m.role}</span></li>)}</ul></div>
      </div>
      <Actions workspaceId={id} currentPlan={plan?.code ?? "trial"} buckets={(buckets ?? []).map((b) => ({ id: b.id, label: `${b.source} · 잔량 ${b.remaining}${b.expires_at ? ` · ${new Date(b.expires_at).toLocaleDateString("ko-KR")} 만료` : ""}`, remaining: Number(b.remaining) }))} />
      <section className="card mt-6 overflow-hidden"><h2 className="border-b border-line px-4 py-3 text-sm font-semibold">최근 원장</h2>
        <ul className="divide-y divide-line">{(ledger ?? []).map((l, i) => <li key={i} className="flex justify-between gap-3 px-4 py-2 text-sm"><span className="min-w-0 truncate">{l.type} · {l.note}</span><span className="shrink-0 tabular-nums">{l.amount} <span className="text-xs text-muted">{new Date(l.created_at).toLocaleString("ko-KR")}</span></span></li>)}</ul></section>
    </>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<div className="skeleton h-64" />}><Body params={params} /></Suspense>;
}
