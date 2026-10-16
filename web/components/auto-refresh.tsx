"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 진행 중인 작업이 있는 동안만 서버 데이터를 주기적으로 새로 읽는다 (탭이 보일 때만, 목록 전체 polling 방지). */
export default function AutoRefresh({ active, everyMs = 6000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
