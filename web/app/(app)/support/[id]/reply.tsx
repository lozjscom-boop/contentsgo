"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Reply({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch(`/api/support/${ticketId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
    setBusy(false);
    if (!r.ok) return setErr("보내지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    setBody(""); router.refresh();
  }
  return (
    <form onSubmit={send} className="mt-6 space-y-3">
      <label className="label" htmlFor="reply">추가로 남길 내용</label>
      <textarea id="reply" className="field min-h-24" required maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex items-center gap-3"><button className="btn btn-primary" disabled={busy}>보내기</button>{err && <p role="alert" className="text-sm text-danger">{err}</p>}</div>
    </form>
  );
}
