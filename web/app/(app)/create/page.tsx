import { BRIEF_QUESTIONS } from "@/lib/planning/knowhow";
import Wizard from "./wizard";

export default function CreatePage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">오늘의 컨텐츠 만들기</h1>
      <p className="mb-6 text-sm text-zinc-500">제품 → 핵심 파악 → 콘셉트 3안 → 훅/내용/전환 순서로 설계해요.</p>
      <Wizard questions={BRIEF_QUESTIONS.map((q) => ({ key: q.key, label: q.label, help: q.help, required: q.required }))} />
    </main>
  );
}
