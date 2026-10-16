import Link from "next/link";
import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import Form from "./form";
import DeleteButton from "./delete-button";

const PLATFORM: Record<string, string> = { meta: "메타", tiktok: "틱톡", instagram: "인스타", youtube: "유튜브", other: "기타" };

async function List() {
  const sb = await createServerSupabase();
  const { data, error } = await sb.from("reference_items").select("id, title, url, platform, notes, tags, created_at").order("created_at", { ascending: false }).limit(100);
  if (error) return <p className="rounded bg-amber-500/10 p-3 text-sm text-amber-300">라이브러리를 불러오지 못했어요. DB 업데이트(UPDATE_04.sql)가 필요할 수 있어요.</p>;
  if (!data?.length) return <p className="text-sm text-zinc-500">아직 저장한 레퍼런스가 없어요.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {data.map((r) => (
        <li key={r.id} className="rounded border border-zinc-700 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.title} <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{PLATFORM[r.platform] ?? r.platform}</span></p>
              {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-sky-400 underline">{r.url}</a>}
              {r.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{r.notes}</p>}
              {r.tags?.length ? <p className="mt-1 text-xs text-zinc-500">{(r.tags as string[]).map((t) => `#${t}`).join(" ")}</p> : null}
            </div>
            <DeleteButton id={r.id} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">컨텐츠 탐색</h1>
      <p className="mb-2 text-sm text-zinc-400">메타 광고 라이브러리·틱톡·인스타에서 찾은 레퍼런스를 모아두는 라이브러리예요.</p>
      <p className="mb-6 text-xs text-zinc-500">영상 파일이 있으면 <Link href="/analyze" className="underline">영상 분석</Link>에서 올려 구조를 뽑을 수 있어요. 자동 검색은 이후 단계에서 붙여요.</p>
      <Form />
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}><List /></Suspense>
    </main>
  );
}
