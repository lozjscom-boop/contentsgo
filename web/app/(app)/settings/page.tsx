import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import GrantButton from "./grant-button";

async function Credits() {
  const sb = await createServerSupabase();
  const { data: w } = await sb.from("wallet_accounts").select("available, reserved").limit(1).maybeSingle();
  const { data: ledger } = await sb.from("credit_ledger").select("type, amount, note, created_at").order("created_at", { ascending: false }).limit(15);
  const grant = Number(process.env.BETA_GRANT_AMOUNT);
  const canGrant = Number.isInteger(grant) && grant > 0 && !(ledger ?? []).some((l) => l.type === "GRANT");
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-zinc-300">크레딧</h2>
      <p className="mb-3 text-sm">사용 가능 <b className="text-lg">{w?.available ?? 0}</b> · 예약 중 {w?.reserved ?? 0}</p>
      {canGrant && <GrantButton amount={grant} />}
      <ul className="mt-4 space-y-1 text-xs text-zinc-400">
        {(ledger ?? []).map((l, i) => (
          <li key={i}>{new Date(l.created_at).toLocaleString("ko-KR")} · {l.type} {l.amount} {l.note ? `· ${l.note}` : ""}</li>
        ))}
      </ul>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">설정</h1>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}><Credits /></Suspense>
      <p className="text-sm text-zinc-500">브랜드·제품 등록(제품 사진 포함)은 곧 이 탭에 들어와요.</p>
    </main>
  );
}
