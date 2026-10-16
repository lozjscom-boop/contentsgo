import { Suspense } from "react";
import DeliverableList from "@/components/deliverable-list";

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">프로젝트</h1>
      <p className="mb-6 text-sm text-zinc-400">내가 만든 제작물이 모여 있어요. 눌러서 열고, 문구 수정·재생성·다운로드를 해요.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <DeliverableList empty="아직 만든 제작물이 없어요." />
      </Suspense>
    </main>
  );
}
