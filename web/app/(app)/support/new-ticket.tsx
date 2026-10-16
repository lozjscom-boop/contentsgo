"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const CATS = [["error", "오류가 나요"], ["quality", "결과물 품질"], ["credits", "크레딧·결제"], ["files", "파일 업로드"], ["team", "팀·초대"], ["signup", "가입·로그인"], ["other", "기타"]];

export default function NewTicket() {
  const router = useRouter();
  const [f, setF] = useState({ category: "error", subject: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await fetch("/api/support", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, t: j.detail ?? "보내지 못했어요. 잠시 뒤 다시 시도해 주세요." });
    setF({ category: "error", subject: "", body: "" });
    setMsg({ ok: true, t: "문의를 보냈어요." });
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <div><label className="label" htmlFor="cat">종류</label><select id="cat" className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label className="label" htmlFor="sub">제목</label><input id="sub" className="field" required maxLength={120} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>
      </div>
      <div><label className="label" htmlFor="body">내용</label><textarea id="body" className="field min-h-28" required maxLength={4000} placeholder="어떤 화면에서 무엇을 눌렀고, 어떻게 보였는지 적어주세요." value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
      <div className="flex items-center gap-3"><button className="btn btn-primary" disabled={busy}>{busy ? "보내는 중…" : "문의 보내기"}</button>{msg && <p role="status" className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.t}</p>}</div>
    </form>
  );
}
