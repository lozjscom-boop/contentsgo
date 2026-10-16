import Link from "next/link";
import { Suspense } from "react";
import RecipeGallery from "./recipe-gallery";
import { createServerSupabase } from "@/lib/supabase/server";
import { IconPlus } from "@/components/icons";

async function Resume() {
  const sb = await createServerSupabase();
  const { data } = await sb.from("deliverables").select("id, type, status, scene_total, scene_ready, projects(title)")
    .in("status", ["draft", "queued", "generating", "review"]).order("updated_at", { ascending: false }).limit(3);
  if (!data?.length) return null;
  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold">이어서 작업하기</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {data.map((d) => (
          <li key={d.id}>
            <Link href={`/d/${d.id}`} className="card card-link flex items-center justify-between gap-3 p-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{(d.projects as unknown as { title?: string } | null)?.title ?? "제목 없음"}</span>
                <span className="block text-xs text-muted">{d.scene_total > 0 ? `${d.scene_ready}/${d.scene_total}장 완료` : "설계됨"}</span>
              </span>
              <span className="badge badge-warn shrink-0">{d.status === "generating" ? "만드는 중" : "진행 중"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CreatePage() {
  return (
    <div className="page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">오늘의 컨텐츠</h1>
          <p className="page-sub">만들고 싶은 방식을 고르거나, 처음부터 설계해 보세요.</p>
        </div>
        <Link href="/create/new" className="btn btn-primary"><IconPlus /> 새로 설계하기</Link>
      </div>
      <Suspense fallback={null}><Resume /></Suspense>
      <section className="mt-10">
        <h2 className="mb-3 text-base font-semibold">제작 방식</h2>
        <RecipeGallery />
      </section>
    </div>
  );
}
