import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

const TYPE: Record<string, string> = { image: "이미지", carousel: "캐러셀", video: "영상" };

export default async function DeliverableList({ empty }: { empty: string }) {
  const sb = await createServerSupabase();
  const { data: rows } = await sb
    .from("deliverables")
    .select("id, type, status, created_at, tags_json, projects(title)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (!rows?.length) {
    return (
      <div className="rounded border border-zinc-700 p-6 text-sm text-zinc-400">
        {empty} <Link href="/create" className="underline">새로 만들기</Link>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const tags = (r.tags_json ?? {}) as { appeal?: string; hook_label?: string };
        const proj = r.projects as unknown as { title?: string } | null;
        return (
          <li key={r.id}>
            <Link href={`/d/${r.id}`} className="flex items-center justify-between gap-3 rounded border border-zinc-700 p-3 hover:bg-zinc-900">
              <span className="min-w-0">
                <span className="block truncate font-medium">{proj?.title ?? "제목 없음"}</span>
                <span className="block truncate text-xs text-zinc-400">{TYPE[r.type] ?? r.type} · {tags.appeal ?? "-"}{tags.hook_label ? ` · 훅 ${tags.hook_label}` : ""}</span>
              </span>
              <span className="shrink-0 text-xs text-zinc-500">{new Date(r.created_at).toLocaleDateString("ko-KR")}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
