"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadAsset } from "@/components/upload-client";

export default function Uploader({ price }: { price: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function onPick(file: File) {
    setErr("");
    try {
      setBusy("올리는 중… (파일이 크면 오래 걸려요)");
      const assetId = await uploadAsset(file, "reference");
      setBusy("AI가 분석하는 중… 1~3분 걸려요. 이 화면을 닫지 마세요.");
      const r = await fetch("/api/analyses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId, requestKey: crypto.randomUUID() }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error === "insufficient_credits" ? "크레딧이 부족해요." : j.error === "migration_missing" ? j.detail : `${j.error ?? "실패"}${j.detail ? `: ${j.detail}` : ""}`);
      router.push(`/analyze/${j.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy("");
      router.refresh();
    }
  }

  return (
    <div className="mb-8 rounded border border-dashed border-zinc-600 p-5">
      <p className="mb-3 text-sm text-zinc-300">분석할 영상을 올려주세요 (mp4·mov·webm, 45MB 이하). 분석 1회 {price}크레딧, 실패하면 차감되지 않아요.</p>
      <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
      <button disabled={!!busy} onClick={() => input.current?.click()} className="rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">영상 올리고 분석하기</button>
      {busy && <p className="mt-3 text-sm text-zinc-400">{busy}</p>}
      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
    </div>
  );
}
