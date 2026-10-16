import Link from "next/link";
import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { CREDIT_PRICES } from "@/lib/credits";
import Uploader from "./uploader";

const STATUS: Record<string, string> = { analyzing: "분석 중/중단됨", done: "완료", failed: "실패" };

async function List() {
  const sb = await createServerSupabase();
  const { data, error } = await sb.from("video_analyses").select("id, status, result_json, error, created_at").order("created_at", { ascending: false }).limit(50);
  if (error) return <p className="rounded bg-amber-500/10 p-3 text-sm text-warn">분석 기록을 불러오지 못했어요. DB 업데이트(UPDATE_04.sql)가 필요할 수 있어요.</p>;
  if (!data?.length) return <p className="text-sm text-zinc-500">아직 분석한 영상이 없어요.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {data.map((a) => (
        <li key={a.id}>
          <Link href={`/analyze/${a.id}`} className="flex items-center justify-between gap-3 card p-3 hover:bg-zinc-900">
            <span className="min-w-0 truncate text-sm">{(a.result_json as { summary?: string } | null)?.summary ?? a.error ?? "분석 대기"}</span>
            <span className="shrink-0 text-xs text-zinc-500">{STATUS[a.status] ?? a.status} · {new Date(a.created_at).toLocaleDateString("ko-KR")}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Page() {
  return (
    <div className="page max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">영상 분석</h1>
      <p className="mb-6 text-sm text-zinc-400">잘 만든 광고 영상을 올리면 훅·구조·소구·재사용 아이디어를 정리해줘요.</p>
      <Uploader price={CREDIT_PRICES.video_analysis} />
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}><List /></Suspense>
    </div>
  );
}
