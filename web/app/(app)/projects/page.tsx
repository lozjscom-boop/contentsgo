import { Suspense } from "react";
import DeliverableList from "@/components/deliverable-list";

async function List({ sp }: { sp: Promise<{ type?: string; cursor?: string }> }) {
  const { type, cursor } = await sp;
  return <DeliverableList base="/projects" type={type} cursor={cursor} empty="아직 만든 제작물이 없어요." />;
}

export default function Page({ searchParams }: { searchParams: Promise<{ type?: string; cursor?: string }> }) {
  return (
    <div className="page">
      <h1 className="page-title">프로젝트</h1>
      <p className="page-sub">만든 제작물이 모여 있어요. 열어서 수정하고 다운로드할 수 있어요.</p>
      <div className="mt-6">
        <Suspense fallback={<div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-[4/5]" />)}</div>}>
          <List sp={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
