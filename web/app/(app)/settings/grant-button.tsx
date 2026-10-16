"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GrantButton({ amount }: { amount: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const r = await fetch("/api/credits/beta", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `${j.granted} 크레딧이 지급됐어요.` : j.error === "already_granted" ? "이미 지급받았어요." : `실패: ${j.error ?? r.status}`);
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3">
      <button onClick={go} disabled={busy} className="rounded bg-white px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40">테스트 크레딧 {amount} 받기</button>
      {msg && <span className="text-sm text-zinc-300">{msg}</span>}
    </div>
  );
}
