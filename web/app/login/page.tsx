"use client";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const sb = createBrowserSupabase();
    const { error, data } =
      mode === "in" ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setMsg(error.message);
    if (mode === "up" && !data.session) return setMsg("가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.");
    window.location.href = "/create";
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">컨텐츠고</h1>
      <p className="text-sm text-zinc-500">제품의 핵심을 찾고, 훅 → 내용 → 전환으로 콘텐츠를 만들어요.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className="rounded border p-2" type="email" required placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="rounded border p-2" type="password" required minLength={8} placeholder="비밀번호 (8자 이상)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="rounded bg-black p-2 text-white disabled:opacity-50">{mode === "in" ? "로그인" : "가입하기"}</button>
      </form>
      <button className="text-sm underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
        {mode === "in" ? "처음이세요? 가입하기" : "이미 계정이 있어요"}
      </button>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </main>
  );
}
