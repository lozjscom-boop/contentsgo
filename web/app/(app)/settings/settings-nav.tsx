"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/settings", label: "브랜드·제품" },
  { href: "/settings/credits", label: "크레딧" },
  { href: "/settings/plan", label: "플랜·사용량" },
  { href: "/settings/team", label: "팀" },
];

export default function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="설정 메뉴" className="-mx-4 mt-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
      {ITEMS.map((i) => {
        const on = path === i.href;
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${on ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
