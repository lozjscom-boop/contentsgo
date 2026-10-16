"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TrialButton() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const r = await fetch("/api/trial/claim", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `${j.granted} 크레딧을 받았어요.` : j.detail ?? "받지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    setBusy(false);
    router.refresh();
  }
  return (<div className="flex flex-col gap-2"><button className="btn btn-primary" disabled={busy} onClick={go}>{busy ? "받는 중…" : "체험 크레딧 받기"}</button>{msg && <p role="status" className="text-sm text-muted">{msg}</p>}</div>);
}
