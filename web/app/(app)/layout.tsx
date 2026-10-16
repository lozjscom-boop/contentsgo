import Link from "next/link";
import { Suspense } from "react";
import { SideNav, BottomNav } from "@/components/nav";
import WorkspaceSwitcher from "@/components/workspace-switcher";
import UserMenu from "@/components/user-menu";
import { IconBell, IconCoin, IconHelp } from "@/components/icons";
import { listMyWorkspaces, requireWorkspace } from "@/lib/auth";
import { getWalletSummary } from "@/lib/wallet";
import { getSetting } from "@/lib/settings";

/** 상단 바: 워크스페이스 전환 · 크레딧 · 알림 · 계정 */
async function TopBar() {
  const [{ workspaceId, user, supabase }, items] = await Promise.all([requireWorkspace(), listMyWorkspaces()]);
  const [wallet, { count }] = await Promise.all([
    getWalletSummary(workspaceId),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
  ]);
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-background/90 px-3 py-2 backdrop-blur md:px-6">
      <div className="flex items-center gap-2">
        <Link href="/create" className="px-2 text-base font-bold tracking-tight md:hidden">컨텐츠고</Link>
        <WorkspaceSwitcher current={workspaceId} items={items} />
      </div>
      <div className="flex items-center gap-1.5">
        <Link href="/settings/credits" className="btn !px-3" title={wallet.expiringSoon > 0 ? `7일 안에 ${wallet.expiringSoon} 크레딧이 만료돼요` : "크레딧 내역"}>
          <IconCoin className="text-accent" />
          <span className="tabular-nums">{wallet.available.toLocaleString("ko-KR")}</span>
          {wallet.expiringSoon > 0 && <span className="badge badge-warn">곧 만료</span>}
        </Link>
        <Link href="/notifications" className="btn btn-ghost relative !px-2.5" aria-label={`알림${count ? ` ${count}개` : ""}`}>
          <IconBell />
          {!!count && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" />}
        </Link>
        <Link href="/support" className="btn btn-ghost hidden !px-2.5 md:inline-flex" aria-label="도움말"><IconHelp /></Link>
        <UserMenu email={user.email ?? "?"} />
      </div>
    </header>
  );
}

async function Banner() {
  const m = await getSetting<{ banner: string }>("maintenance");
  if (!m.banner) return null;
  return <p role="status" className="border-b border-line bg-accent/10 px-4 py-2 text-center text-sm text-accent">{m.banner}</p>;
}

function TopBarSkeleton() {
  return <div className="flex h-[53px] items-center border-b border-line px-6"><div className="skeleton h-6 w-40" /></div>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface/40 p-4 md:flex">
        <Link href="/create" className="flex items-center gap-2 px-2 pt-1 text-lg font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm font-black text-accent-ink">고</span>
          컨텐츠고
        </Link>
        <Suspense fallback={null}><SideNav /></Suspense>
        <div className="mt-auto card p-3 text-xs text-muted">
          <p className="font-semibold text-foreground">베타 운영 중</p>
          <p className="mt-1">불편한 점은 도움말·문의로 알려주세요.</p>
          <Link href="/support" className="mt-2 inline-block font-semibold text-accent">문의하기</Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={null}><Banner /></Suspense>
        <Suspense fallback={<TopBarSkeleton />}><TopBar /></Suspense>
        <main className="flex-1">{children}</main>
      </div>
      <Suspense fallback={null}><BottomNav /></Suspense>
    </div>
  );
}
