import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/storage";
import { afterFilter, decodeCursor, pageOf } from "@/lib/pagination";

const TYPE: Record<string, string> = { image: "이미지", carousel: "캐러셀", video: "영상" };
const STATUS: Record<string, { t: string; c: string }> = {
  draft: { t: "초안", c: "badge" }, queued: { t: "대기 중", c: "badge badge-warn" }, generating: { t: "만드는 중", c: "badge badge-warn" },
  review: { t: "검토 필요", c: "badge badge-warn" }, ready: { t: "완료", c: "badge badge-ok" }, failed: { t: "실패", c: "badge badge-danger" }, archived: { t: "보관", c: "badge" },
};
const PAGE = 24;

type Row = { id: string; type: string; status: string; updated_at: string; scene_total: number; scene_ready: number; cover_asset_id: string | null; tags_json: { appeal?: string } | null; projects: { title?: string } | null; assets: { object_key?: string } | null };

/** 제작물 카드 목록. 커서(updated_at,id) 페이지네이션이라 건수가 늘어도 한 화면 비용이 일정하다. */
export default async function DeliverableList({ empty, base, type, cursor }: { empty: string; base: string; type?: string; cursor?: string }) {
  const sb = await createServerSupabase();
  let q = sb.from("deliverables")
    .select("id, type, status, updated_at, scene_total, scene_ready, cover_asset_id, tags_json, projects(title), assets:cover_asset_id(object_key)")
    .order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE + 1);
  if (type && TYPE[type]) q = q.eq("type", type);
  const c = decodeCursor(cursor);
  if (c) q = q.or(afterFilter(c));
  const { data } = await q;
  const { items, next } = pageOf((data ?? []) as unknown as Row[], PAGE);

  const filters = (
    <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="형식 필터">
      {[["", "전체"], ["image", "이미지"], ["carousel", "캐러셀"], ["video", "영상"]].map(([v, l]) => (
        <Link key={v} href={v ? `${base}?type=${v}` : base} className="chip" data-active={(type ?? "") === v}>{l}</Link>
      ))}
    </div>
  );

  if (!items.length) {
    return (
      <>
        {filters}
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="font-semibold">{empty}</p>
          <p className="text-sm text-muted">제품 정보를 넣으면 콘셉트부터 이미지까지 이어서 만들 수 있어요.</p>
          <Link href="/create" className="btn btn-primary">새 컨텐츠 만들기</Link>
        </div>
      </>
    );
  }

  const urls = await signedUrls(items.map((r) => r.assets?.object_key).filter((k): k is string => !!k));
  return (
    <>
      {filters}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {items.map((r) => {
          const url = r.assets?.object_key ? urls[r.assets.object_key] : undefined;
          const st = STATUS[r.status] ?? STATUS.draft;
          return (
            <li key={r.id}>
              <Link href={`/d/${r.id}`} className="card card-link block overflow-hidden">
                <div className="relative aspect-[4/5] bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : (
                    <div className="grid h-full place-items-center text-xs text-muted">{r.status === "generating" ? "만드는 중…" : "아직 이미지가 없어요"}</div>
                  )}
                  <span className={`${st.c} absolute left-2 top-2`}>{st.t}</span>
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-semibold">{r.projects?.title ?? "제목 없음"}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {TYPE[r.type] ?? r.type}{r.scene_total > 0 ? ` · ${r.scene_ready}/${r.scene_total}장` : ""}{r.tags_json?.appeal ? ` · ${r.tags_json.appeal}` : ""}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {next && (
        <div className="mt-6 text-center">
          <Link href={`${base}?${type ? `type=${type}&` : ""}cursor=${next}`} className="btn">더 보기</Link>
        </div>
      )}
    </>
  );
}
