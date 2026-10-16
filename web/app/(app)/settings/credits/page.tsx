import { Suspense } from "react";
import { requireWorkspace } from "@/lib/auth";
import { getWalletSummary } from "@/lib/wallet";
import { getSetting } from "@/lib/settings";
import GrantButton from "../grant-button";
import TrialButton from "./trial-button";

const TYPE: Record<string, string> = { GRANT: "지급", RESERVE: "예약", SETTLE: "사용", RELEASE: "반환", EXPIRE: "만료", REVOKE: "회수" };

async function Body() {
  const { supabase, workspaceId, user, role } = await requireWorkspace();
  const [wallet, { data: ledger }, trial, { data: claimed }] = await Promise.all([
    getWalletSummary(workspaceId),
    supabase.from("credit_ledger").select("type, amount, note, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(30),
    getSetting<{ enabled: boolean; credits: number; days: number }>("trial"),
    supabase.from("trial_redemptions").select("workspace_id").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  const beta = Number(process.env.BETA_GRANT_AMOUNT);
  const canBeta = role === "owner" && Number.isInteger(beta) && beta > 0 && !(ledger ?? []).some((l) => l.note === "베타 테스트 지급");
  const canTrial = role === "owner" && trial.enabled && !claimed && !!user.email_confirmed_at;
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-4">
        <div className="card p-5">
          <p className="text-sm text-muted">사용 가능</p>
          <p className="mt-1 text-4xl font-bold tabular-nums">{wallet.available.toLocaleString("ko-KR")}</p>
          <p className="mt-2 text-xs text-muted">작업 중 예약 {wallet.reserved.toLocaleString("ko-KR")}</p>
          {wallet.expiringSoon > 0 && <p className="mt-3 text-sm text-warn">7일 안에 {wallet.expiringSoon} 크레딧이 만료돼요.</p>}
        </div>
        {canTrial && <div className="card p-5"><p className="font-semibold">체험 크레딧 {trial.credits}개</p><p className="mt-1 text-sm text-muted">받은 날부터 {trial.days}일 동안 쓸 수 있어요. 계정당 한 번만 받을 수 있어요.</p><div className="mt-3"><TrialButton /></div></div>}
        {!claimed && trial.enabled && !user.email_confirmed_at && <p className="card p-4 text-sm text-muted">이메일 인증을 마치면 체험 크레딧을 받을 수 있어요.</p>}
        {canBeta && <div className="card p-5"><p className="font-semibold">테스트 크레딧</p><div className="mt-3"><GrantButton amount={beta} /></div></div>}
        <p className="text-xs text-muted">결제 연결은 준비 중이에요. 크레딧 충전이 필요하면 도움말·문의로 알려주세요.</p>
      </div>
      <div className="card overflow-hidden">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">최근 내역</h2>
        {(ledger ?? []).length === 0 ? <p className="p-6 text-sm text-muted">아직 내역이 없어요. 컨텐츠를 만들면 여기에 기록돼요.</p> : (
          <ul className="divide-y divide-line">
            {(ledger ?? []).map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0"><span className="block truncate">{l.note || TYPE[l.type] || l.type}</span><span className="text-xs text-muted">{new Date(l.created_at).toLocaleString("ko-KR")} · {TYPE[l.type] ?? l.type}</span></span>
                <span className={`shrink-0 tabular-nums font-semibold ${Number(l.amount) > 0 ? "text-ok" : ""}`}>{Number(l.amount) > 0 ? "+" : ""}{l.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="skeleton h-64" />}><Body /></Suspense>;
}
