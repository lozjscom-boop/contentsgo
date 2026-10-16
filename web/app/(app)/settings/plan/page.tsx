import { Suspense } from "react";
import { requireWorkspace } from "@/lib/auth";

const LABELS: Record<string, string> = { brands: "브랜드", products: "제품", seats: "팀 인원", concurrent_jobs: "동시 제작", pending_jobs: "대기 가능한 작업", exports_month: "월 내보내기", planning_calls_month: "월 기획 요청", storage_gb: "저장 공간(GB)" };
const ORDER = Object.keys(LABELS);

async function Body() {
  const { supabase, workspaceId } = await requireWorkspace();
  const periodStart = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7) + "-01";
  const [{ data: ent }, { data: used }, { count: brands }, { count: products }, { count: seats }] = await Promise.all([
    supabase.from("entitlements").select("source, period_end, plan_versions(code, name, monthly_credits, limits_json, price_krw)").eq("workspace_id", workspaceId).eq("status", "active").maybeSingle(),
    supabase.from("usage_counters").select("key, used").eq("workspace_id", workspaceId).eq("period_start", periodStart),
    supabase.from("brands").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "active"),
  ]);
  const plan = ent?.plan_versions as unknown as { code: string; name: string; monthly_credits: number; limits_json: Record<string, number>; price_krw: number } | null;
  if (!plan) return <p className="card p-6 text-sm text-muted">플랜 정보를 아직 불러올 수 없어요. DB 업데이트 적용 후 표시돼요.</p>;
  const usedBy: Record<string, number> = { brands: brands ?? 0, products: products ?? 0, seats: seats ?? 0 };
  for (const u of used ?? []) {
    if (u.key === "planning_calls") usedBy.planning_calls_month = Number(u.used);
    if (u.key === "exports") usedBy.exports_month = Number(u.used);
  }
  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div><p className="text-sm text-muted">현재 플랜</p><p className="text-2xl font-bold">{plan.name}</p>
          <p className="mt-1 text-sm text-muted">{ent?.source === "trial" ? "체험 플랜" : ent?.source === "beta_admin" ? "베타 제공" : "유료"}{ent?.period_end ? ` · ${new Date(ent.period_end).toLocaleDateString("ko-KR")}까지` : ""}</p></div>
        <div className="text-right text-sm text-muted">매달 {plan.monthly_credits.toLocaleString("ko-KR")} 크레딧<br />결제 연결은 준비 중이에요</div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.filter((k) => plan.limits_json[k] != null).map((k) => {
          const limit = Number(plan.limits_json[k]);
          const u = usedBy[k];
          const pct = u != null && limit > 0 ? Math.min(100, Math.round((u / limit) * 100)) : 0;
          return (
            <li key={k} className="card p-4">
              <div className="flex items-baseline justify-between"><span className="text-sm text-muted">{LABELS[k]}</span><span className="text-sm font-semibold tabular-nums">{u != null ? `${u} / ` : ""}{limit}</span></div>
              {u != null && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={`h-full ${pct >= 90 ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} /></div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="skeleton h-64" />}><Body /></Suspense>;
}
