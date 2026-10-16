"use client";
import Link from "next/link";
import { useState } from "react";
import { RECIPES, RECIPE_CATEGORIES, type RecipeCategory } from "@/lib/recipes";

const FORMAT = { image: "이미지", carousel: "캐러셀", video: "영상" } as const;

/** 제작 방식 갤러리. 카드는 샘플 결과물이 아니라 "이 구조로 만든다"는 레시피 소개다. */
export default function RecipeGallery() {
  const [cat, setCat] = useState<RecipeCategory>("all");
  const list = RECIPES.filter((r) => cat === "all" || r.category === cat);
  return (
    <div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0" role="group" aria-label="카테고리">
        {RECIPE_CATEGORIES.map((c) => (
          <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.label}</button>
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((r) => {
          const body = (
            <>
              <div className="relative flex aspect-[16/10] flex-col justify-end gap-1 p-4"
                style={{ background: `linear-gradient(135deg, hsl(${r.hue} 38% 20%), hsl(${(r.hue + 40) % 360} 30% 11%))` }}>
                <div className="absolute right-3 top-3 flex gap-1.5">
                  <span className="badge !bg-black/40 !text-white">{FORMAT[r.format]}</span>
                  <span className="badge !bg-black/40 !text-white">{r.aspect}</span>
                </div>
                <ol className="space-y-1 text-sm text-white/90">
                  {["훅", "내용", "전환"].map((l, i) => (
                    <li key={l} className="flex gap-2"><span className="w-8 shrink-0 text-white/50">{l}</span>{r.steps[i]}</li>
                  ))}
                </ol>
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{r.title}</h3>
                  {r.available ? <span className="shrink-0 text-xs text-muted">{r.credits} 크레딧</span> : <span className="badge badge-warn shrink-0">준비 중</span>}
                </div>
                <p className="mt-1 text-sm text-muted">{r.summary}</p>
              </div>
            </>
          );
          return (
            <li key={r.id}>
              {r.available ? (
                <Link href={`/create/new?recipe=${r.id}`} className="card card-link block overflow-hidden">{body}</Link>
              ) : (
                <div className="card block overflow-hidden opacity-60" aria-disabled="true">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
