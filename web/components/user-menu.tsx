"use client";
import { useState } from "react";
import Link from "next/link";

export default function UserMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="내 계정"
        className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface-2 text-sm font-semibold hover:border-[#3a4554]">
        {email.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <>
          <button aria-label="닫기" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="card absolute right-0 top-full z-50 mt-1 w-60 p-1 shadow-xl">
            <p className="truncate px-3 py-2 text-xs text-muted">{email}</p>
            <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2">계정·브랜드 설정</Link>
            <Link role="menuitem" href="/support" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2">도움말·문의</Link>
            <form action="/auth/signout" method="post">
              <button role="menuitem" className="block w-full rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-surface-2">로그아웃</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
