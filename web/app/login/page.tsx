"use client";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const POINTS = [
  { t: "제품 핵심부터 찾아요", d: "제품 정보를 넣으면 소구점 후보와 시안 방향을 먼저 정리해 줘요." },
  { t: "훅 → 내용 → 전환 구조", d: "이미지·캐러셀·영상 모두 같은 구조로 기획하고, 문구는 금지 표현 검수를 거쳐요." },
  { t: "쓴 만큼만 크레딧 차감", d: "실패하면 되돌려 드려요. 생성 전에 필요한 크레딧을 먼저 보여줘요." },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [msg, setMsg] = useState<{ tone: "err" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = createBrowserSupabase();
    const { error, data } = mode === "in" ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setMsg({ tone: "err", text: error.message });
    if (mode === "up" && !data.session) return setMsg({ tone: "ok", text: "확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요." });
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/create";
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between border-r border-line bg-surface/50 p-12 lg:flex">
        <div className="flex items-center gap-2 text-lg font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-black text-accent-ink">고</span>컨텐츠고
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">광고 콘텐츠를<br />기획부터 한 번에.</h1>
          <ul className="mt-10 space-y-6">
            {POINTS.map((p) => (
              <li key={p.t}>
                <p className="font-semibold">{p.t}</p>
                <p className="mt-1 text-sm text-muted">{p.d}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted">© 컨텐츠고</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold tracking-tight">{mode === "in" ? "다시 오셨네요" : "무료로 시작하기"}</h2>
          <p className="mt-1 text-sm text-muted">{mode === "in" ? "이메일로 로그인하세요." : "가입하면 체험 크레딧을 받을 수 있어요."}</p>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <div><label className="label" htmlFor="email">이메일</label>
              <input id="email" className="field" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label className="label" htmlFor="pw">비밀번호</label>
              <input id="pw" className="field" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} placeholder="8자 이상" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <button disabled={busy} className="btn btn-primary !py-2.5">{busy ? "처리 중…" : mode === "in" ? "로그인" : "가입하기"}</button>
          </form>
          {msg && <p role="alert" className={`mt-4 text-sm ${msg.tone === "err" ? "text-danger" : "text-ok"}`}>{msg.text}</p>}
          <button className="mt-6 text-sm text-muted hover:text-foreground" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}>
            {mode === "in" ? "처음이세요? 가입하기" : "이미 계정이 있어요"}
          </button>
        </div>
      </section>
    </main>
  );
}
