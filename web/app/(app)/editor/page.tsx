import { Suspense } from "react";
import DeliverableList from "@/components/deliverable-list";

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">편집</h1>
      <p className="mb-6 text-sm text-zinc-400">제작물을 열어 문구 수정, 장면 재생성, 캐러셀 순서 변경, 문구 포함 PNG 저장을 해요.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <DeliverableList empty="편집할 제작물이 없어요." />
      </Suspense>
    </main>
  );
}
