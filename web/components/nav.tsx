"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconSpark, IconCompass, IconFilm, IconEdit, IconFolder, IconGear } from "./icons";

export const TABS = [
  { href: "/create", label: "오늘의 컨텐츠", short: "만들기", Icon: IconSpark },
  { href: "/explore", label: "컨텐츠 탐색", short: "탐색", Icon: IconCompass },
  { href: "/analyze", label: "영상 분석", short: "분석", Icon: IconFilm },
  { href: "/editor", label: "편집", short: "편집", Icon: IconEdit },
  { href: "/projects", label: "프로젝트", short: "보관함", Icon: IconFolder },
  { href: "/settings", label: "설정", short: "설정", Icon: IconGear },
] as const;

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

/** 데스크톱 좌측 사이드바 메뉴 */
export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="주 메뉴" className="flex flex-col gap-0.5">
      {TABS.map(({ href, label, Icon }) => {
        const on = isActive(path, href);
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${on ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-2/60 hover:text-foreground"}`}>
            <Icon className={on ? "text-accent" : "opacity-80 group-hover:opacity-100"} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 모바일 하단 탭 */
export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="주 메뉴" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {TABS.map(({ href, short, Icon }) => {
        const on = isActive(path, href);
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${on ? "text-accent" : "text-muted"}`}>
            <Icon />
            {short}
          </Link>
        );
      })}
    </nav>
  );
}

export default SideNav;
