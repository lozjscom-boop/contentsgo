import { Suspense } from "react";
import { BRIEF_QUESTIONS } from "@/lib/planning/knowhow";
import { createServerSupabase } from "@/lib/supabase/server";
import Wizard from "./wizard";
import { RECIPES } from "@/lib/recipes";

async function Form({ recipeId }: { recipeId?: string }) {
  const recipe = RECIPES.find((r) => r.id === recipeId && r.available);
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
  return <Wizard initial={recipe ? { fmt: recipe.format, aspect: recipe.aspect, title: recipe.title } : undefined} saved={saved} questions={BRIEF_QUESTIONS.map((q) => ({ key: q.key, label: q.label, help: q.help, required: q.required }))} />;
}

export default async function NewCreatePage({ searchParams }: { searchParams: Promise<{ recipe?: string }> }) {
  return (
    <div className="page max-w-3xl">
      <h1 className="page-title">새 컨텐츠 설계</h1>
      <p className="page-sub">제품 → 핵심 파악 → 콘셉트 3안 → 훅/내용/전환 순서로 설계해요.</p>
      <div className="mt-6">
        <Suspense fallback={<div className="skeleton h-64" />}><Resolved sp={searchParams} /></Suspense>
      </div>
    </div>
  );
}

async function Resolved({ sp }: { sp: Promise<{ recipe?: string }> }) {
  const { recipe } = await sp;
  return <Form recipeId={recipe} />;
}
