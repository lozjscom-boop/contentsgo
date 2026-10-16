import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthError, requirePlatformAdmin } from "@/lib/auth";

const ITEMS = [["/ops", "개요"], ["/ops/customers", "고객"], ["/ops/support", "문의"], ["/ops/jobs", "작업"], ["/ops/audit", "감사 기록"], ["/ops/settings", "사이트 설정"]];

async function Guard({ children }: { children: React.ReactNode }) {
  try {
    const { role, user } = await requirePlatformAdmin();
    return (
      <div className="min-h-screen">
        <header className="border-b border-line bg-surface/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <span className="font-bold">운영 콘솔</span>
            <nav className="flex flex-1 flex-wrap gap-1 text-sm">{ITEMS.map(([h, l]) => <Link key={h} href={h} className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-foreground">{l}</Link>)}</nav>
            <span className="text-xs text-muted">{user.email} · {role}</span>
            <Link href="/create" className="btn btn-ghost !py-1">서비스로</Link>
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
      </div>
    );
  } catch (e) {
    if (e instanceof AuthError) notFound(); // 운영 화면의 존재 자체를 숨긴다
    throw e;
  }
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="p-8"><div className="skeleton h-8 w-48" /></div>}><Guard>{children}</Guard></Suspense>;
}
