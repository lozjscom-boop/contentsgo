"use client";
import { useState } from "react";
import { Msg, useOps } from "@/components/ops-action";

export default function Actions({ workspaceId, currentPlan, buckets }: { workspaceId: string; currentPlan: string; buckets: { id: string; label: string; remaining: number }[] }) {
  const { run, msg, busy } = useOps();
  const [grant, setGrant] = useState({ amount: "100", note: "", days: "" });
  const [rev, setRev] = useState({ bucket: buckets[0]?.id ?? "", amount: "", note: "" });
  const [plan, setPlan] = useState({ plan: currentPlan, reason: "" });
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      <form className="card space-y-3 p-5" onSubmit={async (e) => { e.preventDefault(); await run({ action: "grant", workspaceId, amount: Number(grant.amount), note: grant.note, expiresInDays: grant.days ? Number(grant.days) : undefined }, `${grant.amount} 크레딧을 지급할까요?`); }}>
        <h2 className="text-sm font-semibold">크레딧 지급</h2>
        <input className="field" type="number" min={1} required aria-label="수량" value={grant.amount} onChange={(e) => setGrant({ ...grant, amount: e.target.value })} />
        <input className="field" required minLength={2} placeholder="사유 (필수)" aria-label="사유" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} />
        <input className="field" type="number" min={1} placeholder="만료까지 일수 (비우면 무기한)" aria-label="만료 일수" value={grant.days} onChange={(e) => setGrant({ ...grant, days: e.target.value })} />
        <button className="btn btn-primary" disabled={busy}>지급</button>
      </form>
      <form className="card space-y-3 p-5" onSubmit={async (e) => { e.preventDefault(); await run({ action: "revoke", workspaceId, bucketId: rev.bucket, amount: Number(rev.amount), note: rev.note }, `${rev.amount} 크레딧을 회수할까요?`); }}>
        <h2 className="text-sm font-semibold">크레딧 회수</h2>
        <select className="field" required aria-label="버킷" value={rev.bucket} onChange={(e) => setRev({ ...rev, bucket: e.target.value })}>{buckets.length === 0 && <option value="">회수할 잔량 없음</option>}{buckets.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
        <input className="field" type="number" min={1} required aria-label="수량" value={rev.amount} onChange={(e) => setRev({ ...rev, amount: e.target.value })} />
        <input className="field" required minLength={2} placeholder="사유 (필수)" aria-label="사유" value={rev.note} onChange={(e) => setRev({ ...rev, note: e.target.value })} />
        <button className="btn" disabled={busy || !rev.bucket}>회수</button>
      </form>
      <form className="card space-y-3 p-5" onSubmit={async (e) => { e.preventDefault(); await run({ action: "set_plan", workspaceId, plan: plan.plan, reason: plan.reason }, `플랜을 ${plan.plan}(으)로 바꿀까요?`); }}>
        <h2 className="text-sm font-semibold">플랜 지정</h2>
        <select className="field" aria-label="플랜" value={plan.plan} onChange={(e) => setPlan({ ...plan, plan: e.target.value })}>{["trial", "starter", "growth", "studio"].map((p) => <option key={p}>{p}</option>)}</select>
        <input className="field" required minLength={2} placeholder="사유 (필수)" aria-label="사유" value={plan.reason} onChange={(e) => setPlan({ ...plan, reason: e.target.value })} />
        <button className="btn" disabled={busy}>변경</button>
      </form>
      <div className="lg:col-span-3"><Msg m={msg} /></div>
    </div>
  );
}
