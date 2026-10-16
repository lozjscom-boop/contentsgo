import { Suspense } from "react";
import DeliverableList from "@/components/deliverable-list";

async function List({ sp }: { sp: Promise<{ type?: string; cursor?: string }> }) {
  const { type, cursor } = await sp;
  return <DeliverableList base="/editor" type={type} cursor={cursor} empty="편집할 제작물이 없어요." />;
}

export default function Page({ searchParams }: { searchParams: Promise<{ type?: string; cursor?: string }> }) {
  return (
    <div className="page">
      <h1 className="page-title">편집</h1>
      <p className="page-sub">제작물을 열어 문구 수정, 장면 다시 만들기, 캐러셀 순서 변경, 문구 포함 PNG 저장을 해요.</p>
      <div className="mt-6">
        <Suspense fallback={<div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-[4/5]" />)}</div>}>
          <List sp={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
