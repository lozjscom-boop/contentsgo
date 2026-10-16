"use client";
import { useState } from "react";

export default function Accept({ token }: { token: string }) {
  const [state, setState] = useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: "", ok: false });
  async function go() {
    setState({ busy: true, msg: "", ok: false });
    const r = await fetch("/api/team/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return void (window.location.href = "/create");
    setState({ busy: false, ok: false, msg: r.status === 401 ? "먼저 초대받은 이메일로 로그인해 주세요." : j.detail ?? "초대를 수락하지 못했어요." });
  }
  return (
    <div className="card w-full max-w-sm p-6 text-center">
      <h1 className="text-xl font-bold">팀 초대를 받았어요</h1>
      <p className="mt-2 text-sm text-muted">초대받은 이메일로 로그인한 상태에서 수락해 주세요.</p>
      <button className="btn btn-primary mt-5 w-full" disabled={state.busy} onClick={go}>{state.busy ? "확인 중…" : "초대 수락하기"}</button>
      {state.msg && <p role="alert" className="mt-4 text-sm text-danger">{state.msg} {state.msg.includes("로그인") && <a className="underline" href="/login">로그인</a>}</p>}
    </div>
  );
}
