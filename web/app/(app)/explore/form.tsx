"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const PLATFORMS = [["meta", "메타"], ["tiktok", "틱톡"], ["instagram", "인스타"], ["youtube", "유튜브"], ["other", "기타"]] as const;

export default function Form() {
  const router = useRouter();
  const [f, setF] = useState({ title: "", url: "", platform: "meta", notes: "", tags: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/references", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error === "invalid_input" ? `입력을 확인해주세요${j.detail ? ` (${j.detail})` : ""}` : j.detail ?? j.error);
    setF({ title: "", url: "", platform: f.platform, notes: "", tags: "" });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mb-8 flex flex-col gap-2 card p-4">
      <div className="flex gap-2">
        <input required placeholder="제목 (예: 경쟁사 A 사용 장면 광고)" className="min-w-0 flex-1 rounded-lg border border-line bg-transparent p-2 text-sm" value={f.title} maxLength={120} onChange={set("title")} />
        <select className="rounded-lg border border-line bg-zinc-900 p-2 text-sm" value={f.platform} onChange={set("platform")}>
          {PLATFORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <input placeholder="링크 (광고 라이브러리·게시물 주소)" className="rounded-lg border border-line bg-transparent p-2 text-sm" value={f.url} onChange={set("url")} />
      <textarea placeholder="메모: 왜 좋은지, 우리가 가져올 점" rows={2} className="rounded-lg border border-line bg-transparent p-2 text-sm" value={f.notes} onChange={set("notes")} />
      <input placeholder="태그 (쉼표로 구분)" className="rounded-lg border border-line bg-transparent p-2 text-sm" value={f.tags} onChange={set("tags")} />
      <div className="flex items-center gap-3">
        <button disabled={busy} className="btn btn-primary disabled:opacity-40">{busy ? "저장 중…" : "저장"}</button>
        {err && <span className="text-sm text-danger">{err}</span>}
      </div>
    </form>
  );
}
