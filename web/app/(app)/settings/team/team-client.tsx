"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLE: Record<string, string> = { owner: "소유자", admin: "관리자", editor: "편집자", viewer: "보기 전용" };
type Member = { userId: string; role: string; email: string };
type Invite = { id: string; email: string; role: string; expires_at: string };

async function send(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

export default function TeamClient({ me, canManage, members, invites }: { me: string; canManage: boolean; members: Member[]; invites: Invite[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(""); setLink("");
    const { ok, j } = await send("/api/team/invitations", "POST", { email, role });
    setBusy(false);
    if (!ok) return setMsg(j.detail ?? "초대하지 못했어요.");
    setLink(j.link); setEmail("");
    router.refresh();
  }
  async function act(fn: () => Promise<{ ok: boolean; j: { detail?: string } }>) {
    const { ok, j } = await fn();
    if (!ok) setMsg(j.detail ?? "처리하지 못했어요.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">멤버 {members.length}명</h2>
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 truncate">{m.email}{m.userId === me && <span className="badge ml-2">나</span>}</span>
              <span className="flex items-center gap-2">
                {canManage && m.userId !== me ? (
                  <>
                    <select aria-label="역할" className="rounded-lg border px-2 py-1 text-sm" value={m.role} onChange={(e) => act(() => send("/api/team/members", "PATCH", { userId: m.userId, role: e.target.value }))}>
                      {Object.entries(ROLE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <button className="btn btn-ghost !py-1 text-danger" onClick={() => confirm(`${m.email} 님을 팀에서 내보낼까요?`) && act(() => send("/api/team/members", "PATCH", { userId: m.userId, remove: true }))}>내보내기</button>
                  </>
                ) : <span className="badge">{ROLE[m.role] ?? m.role}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {canManage && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold">팀원 초대</h2>
          <form onSubmit={invite} className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input className="field flex-1" type="email" required placeholder="초대할 이메일" aria-label="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="field sm:w-36" aria-label="역할" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">관리자</option><option value="editor">편집자</option><option value="viewer">보기 전용</option>
            </select>
            <button className="btn btn-primary" disabled={busy}>초대 만들기</button>
          </form>
          {link && (
            <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-sm" role="status">
              <p className="font-medium">초대 링크가 만들어졌어요. 이 창을 닫으면 다시 볼 수 없어요.</p>
              <div className="mt-2 flex gap-2"><input readOnly className="field" value={link} onFocus={(e) => e.currentTarget.select()} aria-label="초대 링크" /><button className="btn" onClick={() => navigator.clipboard.writeText(link)}>복사</button></div>
              <p className="mt-2 text-xs text-muted">초대받은 분이 같은 이메일로 가입·로그인한 뒤 링크를 열면 합류해요. 7일 동안 유효해요.</p>
            </div>
          )}
          {msg && <p role="alert" className="mt-3 text-sm text-danger">{msg}</p>}
          {invites.length > 0 && (
            <ul className="mt-5 divide-y divide-line border-t border-line">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{i.email} <span className="text-muted">· {ROLE[i.role]} · {new Date(i.expires_at).toLocaleDateString("ko-KR")}까지</span></span>
                  <button className="btn btn-ghost !py-1" onClick={() => act(() => send(`/api/team/invitations/${i.id}`, "DELETE"))}>취소</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
