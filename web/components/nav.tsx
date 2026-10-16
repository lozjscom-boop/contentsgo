"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const TABS = [
  { href: "/create", label: "오늘의 컨텐츠", desc: "이미지 · 캐러셀 · 영상 만들기" },
  { href: "/explore", label: "컨텐츠 탐색", desc: "참고 광고 저장·분석" },
  { href: "/analyze", label: "영상 분석", desc: "영상을 올려 구조 분석" },
  { href: "/editor", label: "편집", desc: "만든 이미지·영상 수정" },
  { href: "/projects", label: "프로젝트", desc: "제작물 보관함" },
  { href: "/settings", label: "설정", desc: "브랜드 · 크레딧" },
] as const;

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
      {TABS.map((t) => {
        const active = path === t.href || path.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`whitespace-nowrap rounded px-3 py-2 text-sm ${active ? "bg-white font-semibold text-black" : "text-zinc-300 hover:bg-zinc-800"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
