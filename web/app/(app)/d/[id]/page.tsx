import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { sceneImagePrice } from "@/lib/credits";
import { signedUrls } from "@/lib/storage";
import { DeliverableDocument } from "@/lib/planning/schemas";
import SceneCard from "./scene-card";

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createServerSupabase();
  const { data: d } = await sb.from("deliverables").select("id, type, status, current_version_id, project_id").eq("id", id).maybeSingle();
  if (!d || !d.current_version_id) notFound();
  const { data: ver } = await sb.from("creative_versions").select("document_json").eq("id", d.current_version_id).single();
  const doc = DeliverableDocument.parse(ver!.document_json);
  const { data: scenes } = await sb.from("scenes").select("id, scene_key, role, spec_json, status, asset_id").eq("creative_version_id", d.current_version_id).order("scene_key");
  const assetIds = (scenes ?? []).map((s) => s.asset_id).filter(Boolean);
  const { data: assets } = assetIds.length ? await sb.from("assets").select("id, object_key").in("id", assetIds) : { data: [] as { id: string; object_key: string }[] };
  const keyOf = new Map((assets ?? []).map((a) => [a.id, a.object_key]));
  const keys = [...keyOf.values()];
  const [view, dl] = await Promise.all([signedUrls(keys), signedUrls(keys, { download: true })]);
  const price = d.type === "video" ? 0 : sceneImagePrice(d.type as "image" | "carousel");
  const ordered = [...(scenes ?? [])].sort((a, b) => Number(a.scene_key.replace(/\D/g, "")) - Number(b.scene_key.replace(/\D/g, "")));

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href="/create" className="text-sm text-zinc-400 underline">← 새로 만들기</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">{d.type === "image" ? "이미지" : d.type === "carousel" ? "캐러셀" : "영상"} 제작물</h1>
      <p className="mb-1 text-sm text-zinc-400">소구: {doc.tags.appeal} · 훅 {doc.tags.hook_label} · 전환 {doc.tags.cta_label}</p>
      <p className="mb-6 text-xs text-zinc-500">제작물 ID: {d.id}</p>
      {doc.disclosures.length > 0 && <p className="mb-4 rounded bg-amber-500/10 p-2 text-xs text-amber-300">{doc.disclosures.join(" / ")}</p>}
      {d.type === "video" && <p className="mb-4 rounded bg-zinc-800 p-3 text-sm">영상 제작은 아직 연결 전이에요. 장면 구성까지만 확인할 수 있어요.</p>}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {ordered.map((s) => {
          const spec = s.spec_json as { caption: string; overlay_lines: string[] };
          const key = s.asset_id ? keyOf.get(s.asset_id) : undefined;
          return (
            <SceneCard key={s.id} sceneId={s.id} role={s.role} caption={spec.caption} overlayLines={spec.overlay_lines} aspect={doc.aspect}
              url={key ? view[key] ?? null : null} downloadUrl={key ? dl[key] ?? null : null} status={s.status} price={price} />
          );
        })}
      </div>
    </main>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">불러오는 중…</p>}><Content params={params} /></Suspense>;
}
