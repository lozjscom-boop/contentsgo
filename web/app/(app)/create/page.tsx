import { Suspense } from "react";
import { BRIEF_QUESTIONS } from "@/lib/planning/knowhow";
import { createServerSupabase } from "@/lib/supabase/server";
import Wizard from "./wizard";

async function Form() {
  const sb = await createServerSupabase();
  const { data } = await sb.from("products").select("id, name, category, facts_json, forbidden_claims, brands(name)").order("created_at", { ascending: false }).limit(30);
  const saved = (data ?? []).map((p) => ({
    id: p.id as string,
    brandName: ((p.brands as unknown as { name: string } | null)?.name ?? "") as string,
    name: p.name as string,
    category: (p.category ?? "") as string,
    facts: Object.entries((p.facts_json ?? {}) as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join("\n"),
    forbidden: ((p.forbidden_claims ?? []) as string[]).join(", "),
  }));
  return <Wizard saved={saved} questions={BRIEF_QUESTIONS.map((q) => ({ key: q.key, label: q.label, help: q.help, required: q.required }))} />;
}

export default function CreatePage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">오늘의 컨텐츠 만들기</h1>
      <p className="mb-6 text-sm text-zinc-500">제품 → 핵심 파악 → 콘셉트 3안 → 훅/내용/전환 순서로 설계해요.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}><Form /></Suspense>
    </main>
  );
}
