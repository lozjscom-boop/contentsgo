"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** 운영 작업 버튼/폼 공통: JSON 을 /api/ops/action 에 보내고 결과를 보여준다. */
export function useOps() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return false;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/ops/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg({ ok: r.ok, t: r.ok ? "처리했어요." : j.detail ?? j.error ?? "실패했어요." });
    if (r.ok) router.refresh();
    return r.ok;
  }
  return { run, msg, busy };
}

export function Msg({ m }: { m: { ok: boolean; t: string } | null }) {
  return m ? <p role="status" className={`text-sm ${m.ok ? "text-ok" : "text-danger"}`}>{m.t}</p> : null;
}
