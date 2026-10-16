"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  sceneId: string; role: string; caption: string; overlayLines: string[];
  aspect: string; url: string | null; downloadUrl: string | null; status: string; price: number;
};
const ASPECT: Record<string, string> = { "1:1": "1 / 1", "4:5": "4 / 5", "9:16": "9 / 16" };
const ROLE: Record<string, string> = { hook: "훅", brand_line: "브랜드 한 줄", body: "내용", cta: "전환" };

export default function SceneCard(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function generate() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/scenes/${p.sceneId}/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestKey: crypto.randomUUID() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error === "insufficient_credits" ? "크레딧이 부족해요." : j.error === "provider_not_configured" ? "AI 키 설정이 필요해요." : `${j.error ?? "실패"}${j.detail ? `: ${j.detail}` : ""}`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-zinc-400">{ROLE[p.role] ?? p.role}</div>
      <div className="relative w-full max-w-xs overflow-hidden rounded border border-zinc-700 bg-zinc-900" style={{ aspectRatio: ASPECT[p.aspect] ?? "1 / 1" }}>
        {p.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.url} alt={p.caption} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-zinc-500">{busy || p.status === "generating" ? "만드는 중…" : "아직 만들지 않았어요"}</div>
        )}
        {/* 문구는 이미지에 그리지 않고 앱이 위에 얹는다 */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/80 to-transparent p-3 text-white">
          <div className="text-base font-bold leading-tight">{p.caption}</div>
          {p.overlayLines.map((l, i) => <div key={i} className="text-sm opacity-90">{l}</div>)}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={generate} disabled={busy} className="rounded bg-white px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40">
          {busy ? "생성 중…" : p.url ? `다시 만들기 (${p.price}크레딧)` : `이미지 만들기 (${p.price}크레딧)`}
        </button>
        {p.downloadUrl && <a href={p.downloadUrl} className="text-sm underline">다운로드</a>}
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
