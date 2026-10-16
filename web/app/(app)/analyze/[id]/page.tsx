import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { VideoAnalysisResult } from "@/lib/analysis/schema";
import AutoRefresh from "@/components/auto-refresh";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="mb-5">
      <h2 className="mb-1 font-semibold">{title}</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </section>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sb = await createServerSupabase();
  const { data: a } = await sb.from("video_analyses").select("id, status, result_json, error, created_at").eq("id", id).maybeSingle();
  if (!a) notFound();
  const r = a.status === "done" ? VideoAnalysisResult.safeParse(a.result_json) : null;
  return (
    <div className="page max-w-3xl">
      <Link href="/analyze" className="text-sm text-zinc-400 underline">← 영상 분석</Link>
      <AutoRefresh active={a.status === "analyzing"} />
      <h1 className="mb-4 mt-2 text-2xl font-bold">분석 결과</h1>
      {a.status !== "done" && <p className="rounded bg-zinc-800 p-3 text-sm">{a.status === "failed" ? `분석에 실패했어요 (크레딧은 차감되지 않아요). ${a.error ?? ""}` : "AI가 분석하는 중이에요. 보통 1~3분 걸려요. 이 화면을 닫아도 계속 진행돼요."}</p>}
      {r?.success && (
        <>
          <p className="mb-1 text-lg">{r.data.summary}</p>
          <p className="mb-5 text-xs text-zinc-500">형식: {r.data.format}</p>
          <section className="mb-5 card p-3 text-sm">
            <h2 className="mb-1 font-semibold">훅 (처음 3초)</h2>
            <p>{r.data.hook.first_3_sec}</p>
            <p className="mt-1 text-zinc-400">기법: {r.data.hook.technique}</p>
            <p className="text-zinc-400">효과: {r.data.hook.why_it_works}</p>
          </section>
          <section className="mb-5">
            <h2 className="mb-1 font-semibold">구성</h2>
            <ol className="space-y-2 text-sm">
              {r.data.structure.map((s, i) => (
                <li key={i} className="card p-2">
                  <span className="text-zinc-400">{fmt(s.start_sec)}–{fmt(s.end_sec)} · {s.role}</span>
                  <p>{s.what_happens}</p>
                  {s.on_screen_text && <p className="text-zinc-400">화면 문구: {s.on_screen_text}</p>}
                </li>
              ))}
            </ol>
          </section>
          <List title="소구 포인트" items={r.data.appeals} />
          {r.data.cta && <List title="전환 유도" items={[r.data.cta]} />}
          <List title="잘된 점" items={r.data.strengths} />
          <List title="아쉬운 점" items={r.data.weaknesses} />
          <List title="내 광고에 응용할 아이디어" items={r.data.reusable_ideas} />
          <List title="주의할 점" items={r.data.risks} />
        </>
      )}
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">불러오는 중…</p>}><Content params={params} /></Suspense>;
}
