"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { composePng, saveBlob } from "@/components/compose";

type Props = {
  sceneId: string; role: string; caption: string; overlayLines: string[];
  aspect: string; url: string | null; status: string; price: number;
  index: number; total: number; canReorder: boolean; deliverableId: string;
};
const ASPECT: Record<string, string> = { "1:1": "1 / 1", "4:5": "4 / 5", "9:16": "9 / 16" };
const ROLE: Record<string, string> = { hook: "훅", brand_line: "브랜드 한 줄", body: "내용", cta: "전환" };

export default function SceneCard(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(p.caption);
  const [lines, setLines] = useState(p.overlayLines.join("\n"));

  async function call(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setErr("");
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  const generate = () => call("gen", async () => {
    const r = await fetch(`/api/scenes/${p.sceneId}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestKey: crypto.randomUUID() }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error === "insufficient_credits" ? "크레딧이 부족해요." : j.error === "provider_not_configured" ? "AI 키 설정이 필요해요." : `${j.error ?? "실패"}${j.detail ? `: ${j.detail}` : ""}`);
    router.refresh();
  });

  const save = () => call("save", async () => {
    const r = await fetch(`/api/scenes/${p.sceneId}/edit`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ caption, overlay_lines: lines.split("\n").map((l) => l.trim()).filter(Boolean) }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error === "lint_failed" ? j.issues.map((i: { message: string }) => i.message).join(" ") : j.error ?? "저장 실패");
    setEditing(false);
    router.refresh();
  });

  const move = (direction: "up" | "down") => call("move", async () => {
    const r = await fetch(`/api/scenes/${p.sceneId}/move`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction }) });
    if (!r.ok) throw new Error((await r.json()).error ?? "이동 실패");
    router.refresh();
  });

  const download = () => call("dl", async () => {
    if (!p.url) return;
    saveBlob(await composePng(p.url, p.caption, p.overlayLines), `contentsgo-${p.deliverableId.slice(0, 8)}-${p.index + 1}.png`);
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{p.index + 1}. {ROLE[p.role] ?? p.role}</span>
        {p.canReorder && (
          <span className="flex gap-1">
            <button disabled={!!busy || p.index === 0} onClick={() => move("up")} className="rounded border border-zinc-700 px-1.5 disabled:opacity-30">↑</button>
            <button disabled={!!busy || p.index === p.total - 1} onClick={() => move("down")} className="rounded border border-zinc-700 px-1.5 disabled:opacity-30">↓</button>
          </span>
        )}
      </div>
      <div className="relative w-full max-w-xs overflow-hidden rounded border border-zinc-700 bg-zinc-900" style={{ aspectRatio: ASPECT[p.aspect] ?? "1 / 1" }}>
        {p.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.url} alt={p.caption} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-zinc-500">{busy === "gen" || p.status === "generating" ? "만드는 중…" : "아직 만들지 않았어요"}</div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/80 to-transparent p-3 text-white">
          <div className="text-base font-bold leading-tight">{p.caption}</div>
          {p.overlayLines.map((l, i) => <div key={i} className="text-sm opacity-90">{l}</div>)}
        </div>
      </div>

      {editing ? (
        <div className="flex max-w-xs flex-col gap-2">
          <input className="rounded border bg-transparent p-2 text-sm" value={caption} maxLength={80} onChange={(e) => setCaption(e.target.value)} />
          <textarea className="rounded border bg-transparent p-2 text-sm" rows={3} placeholder="추가 문구 (한 줄에 하나)" value={lines} onChange={(e) => setLines(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={save} disabled={!!busy} className="rounded bg-white px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40">{busy === "save" ? "저장 중…" : "저장"}</button>
            <button onClick={() => { setEditing(false); setCaption(p.caption); setLines(p.overlayLines.join("\n")); }} className="text-sm underline">취소</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={generate} disabled={!!busy} className="rounded bg-white px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40">
            {busy === "gen" ? "생성 중…" : p.url ? `다시 만들기 (${p.price}크레딧)` : `이미지 만들기 (${p.price}크레딧)`}
          </button>
          <button onClick={() => setEditing(true)} disabled={!!busy} className="rounded border border-zinc-600 px-3 py-1.5 text-sm">문구 수정</button>
          {p.url && <button onClick={download} disabled={!!busy} className="text-sm underline">{busy === "dl" ? "만드는 중…" : "문구 포함 PNG 저장"}</button>}
        </div>
      )}
      {err && <p className="max-w-xs text-xs text-red-400">{err}</p>}
    </div>
  );
}
