import Link from "next/link";
import { connection } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

const count = async (t: string, f?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  let q = createAdminSupabase().from(t).select("*", { count: "exact", head: true });
  if (f) q = f(q);
  const { count: c, error } = await q;
  return error ? null : c ?? 0;
};

export default async function Page() {
  await connection();
  const [ws, queued, running, unknown, failed, tickets] = await Promise.all([
    count("workspaces"),
    count("jobs", (q) => q.eq("status", "queued")),
    count("jobs", (q) => q.eq("status", "running")),
    count("jobs", (q) => q.eq("status", "provider_unknown")),
    count("jobs", (q) => q.eq("status", "failed").gte("updated_at", new Date(Date.now() - 864e5).toISOString())),
    count("support_tickets", (q) => q.in("status", ["open", "triaged", "in_progress"])),
  ]);
  const cards: [string, number | null, string, boolean?][] = [
    ["워크스페이스", ws, "/ops/customers"], ["대기 중 작업", queued, "/ops/jobs?status=queued"], ["실행 중 작업", running, "/ops/jobs?status=running"],
    ["결과 확인 필요(provider_unknown)", unknown, "/ops/jobs?status=provider_unknown", (unknown ?? 0) > 0],
    ["최근 24시간 실패", failed, "/ops/jobs?status=failed"], ["처리할 문의", tickets, "/ops/support", (tickets ?? 0) > 0],
  ];
  return (
    <>
      <h1 className="page-title">개요</h1>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([l, v, h, hot]) => (
          <li key={l}><Link href={h} className={`card card-link block p-5 ${hot ? "!border-warn/60" : ""}`}><p className="text-sm text-muted">{l}</p><p className="mt-1 text-3xl font-bold tabular-nums">{v ?? "-"}</p></Link></li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">값이 &quot;-&quot; 이면 아직 DB 업데이트가 적용되지 않았거나 조회에 실패한 거예요.</p>
    </>
  );
}
