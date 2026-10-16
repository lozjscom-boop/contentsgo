"use client";
import { useState } from "react";
import type { Concept, CorePointsOutput, PartsOutput } from "@/lib/planning/schemas";
import { useRouter } from "next/navigation";

type Q = { key: string; label: string; help: string; required: boolean };
type Issue = { severity: string; message: string; path?: string };
type Stage<T> = { ok: boolean; data: T; issues: Issue[]; repaired: boolean };

async function call<T>(body: unknown): Promise<Stage<T>> {
  const r = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error === "provider_not_configured" ? "AI 키(GEMINI_API_KEY)가 아직 설정되지 않았어요." : j.error ?? "요청 실패");
  return j;
}

type Saved = { id: string; brandName: string; name: string; category: string; facts: string; forbidden: string };

export default function Wizard({ questions, saved }: { questions: Q[]; saved: Saved[] }) {
  const [product, setProduct] = useState({ brandName: "", name: "", category: "", forbidden: "" });
  const [facts, setFacts] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [core, setCore] = useState<Stage<CorePointsOutput> | null>(null);
  const [concepts, setConcepts] = useState<Stage<{ concepts: Concept[] }> | null>(null);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [parts, setParts] = useState<Stage<PartsOutput> | null>(null);
  const router = useRouter();
  const [pick, setPick] = useState({ hook: 0, body: 0, cta: 0 });
  const [fmt, setFmt] = useState<"image" | "carousel" | "video">("image");
  const [aspect, setAspect] = useState<"1:1" | "4:5" | "9:16">("4:5");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const productInput = () => ({
    brandName: product.brandName,
    name: product.name,
    category: product.category || undefined,
    facts: Object.fromEntries(facts.split("\n").map((l) => l.split(":")).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join(":").trim()])),
    forbiddenClaims: product.forbidden.split(",").map((s) => s.trim()).filter(Boolean),
  });
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const ready = product.brandName && product.name && questions.filter((q) => q.required).every((q) => answers[q.key]?.trim());

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">1. 제품</h2>
        {saved.length > 0 && (
          <select className="rounded border bg-transparent p-2 text-sm" defaultValue="" onChange={(e) => {
            const p = saved.find((x) => x.id === e.target.value);
            if (!p) return;
            setProduct({ brandName: p.brandName, name: p.name, category: p.category, forbidden: p.forbidden });
            setFacts(p.facts);
          }}>
            <option value="">등록한 제품 불러오기…</option>
            {saved.map((p) => <option key={p.id} value={p.id}>{p.brandName} · {p.name}</option>)}
          </select>
        )}
        <input className="rounded border p-2" placeholder="브랜드명" value={product.brandName} onChange={(e) => setProduct({ ...product, brandName: e.target.value })} />
        <input className="rounded border p-2" placeholder="제품명" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} />
        <input className="rounded border p-2" placeholder="카테고리 (선택)" value={product.category} onChange={(e) => setProduct({ ...product, category: e.target.value })} />
        <textarea className="rounded border p-2" rows={3} placeholder={"확인된 사실 (한 줄에 하나, '항목: 내용')\n예) 용량: 5g\n성분: 호호바오일"} value={facts} onChange={(e) => setFacts(e.target.value)} />
        <input className="rounded border p-2" placeholder="쓰면 안 되는 표현 (쉼표 구분, 선택)" value={product.forbidden} onChange={(e) => setProduct({ ...product, forbidden: e.target.value })} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">2. 제품 핵심 파악</h2>
        {questions.map((q) => (
          <label key={q.key} className="flex flex-col gap-1">
            <span className="text-sm font-medium">{q.label}{q.required && " *"}</span>
            <span className="text-xs text-zinc-500">{q.help}</span>
            <textarea className="rounded border p-2" rows={2} value={answers[q.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} />
          </label>
        ))}
        <button disabled={!ready || !!busy} className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-40"
          onClick={() => run("core", async () => { setCore(null); setConcepts(null); setConcept(null); setParts(null); setCore(await call({ stage: "core", product: productInput(), answers })); })}>
          {busy === "core" ? "정리 중…" : "핵심 포인트 정리하기"}
        </button>
      </section>

      {err && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      {core && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">핵심 포인트</h2>
          <IssueList issues={core.issues} ok={core.ok} />
          <ul className="flex flex-col gap-2">
            {core.data.core_points.map((p, i) => (
              <li key={i} className="rounded border p-3 text-sm"><b>{p.point}</b><br />{p.why_it_matters}{p.visualizable ? " · 화면으로 보여주기 쉬움" : ""}</li>
            ))}
          </ul>
          {core.data.missing_info_questions.length > 0 && (
            <div className="rounded bg-amber-50 p-3 text-sm">추가로 확인하면 좋아요: {core.data.missing_info_questions.join(" / ")}</div>
          )}
          <button disabled={!!busy} className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-40"
            onClick={() => run("concepts", async () => { setConcepts(null); setConcept(null); setParts(null); setConcepts(await call({ stage: "concepts", product: productInput(), answers, core: core.data })); })}>
            {busy === "concepts" ? "콘셉트 만드는 중…" : "콘셉트 3안 보기"}
          </button>
        </section>
      )}

      {concepts && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">콘셉트 3안</h2>
          <IssueList issues={concepts.issues} ok={concepts.ok} />
          {concepts.data.concepts.map((c, i) => (
            <button key={i} onClick={() => { setConcept(c); setParts(null); }} className={`rounded border p-3 text-left text-sm ${concept === c ? "border-black ring-1 ring-black" : ""}`}>
              <b>{c.title}</b> <span className="text-xs text-zinc-500">({c.pattern})</span><br />소구: {c.appeal}<br />훅 장면: {c.visual_hook}<br />
              <span className="text-xs text-zinc-500">근거: {c.rationale}{c.claim_status === "needs_confirmation" ? " · 확인 필요한 주장 포함" : ""}</span>
            </button>
          ))}
          <button disabled={!concept || !!busy} className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-40"
            onClick={() => run("parts", async () => setParts(await call({ stage: "parts", product: productInput(), answers, concept })))}>
            {busy === "parts" ? "만드는 중…" : "선택한 콘셉트로 훅/내용/전환 만들기"}
          </button>
        </section>
      )}

      {parts && core && concept && (
        <section className="flex flex-col gap-4">
          <h2 className="font-semibold">훅 → 내용 → 전환 고르기</h2>
          <IssueList issues={parts.issues} ok={parts.ok} />
          <Choice title="훅 (첫 3초)" items={parts.data.hooks.map((h) => ({ label: h.label, text: `${h.caption} — ${h.scene}` }))} value={pick.hook} onChange={(v) => setPick({ ...pick, hook: v })} />
          <Choice title="내용" items={parts.data.bodies.map((b) => ({ label: b.label, text: `${b.brand_line} (${b.beats.length}장면)` }))} value={pick.body} onChange={(v) => setPick({ ...pick, body: v })} />
          <Choice title="전환" items={parts.data.ctas.map((c) => ({ label: c.label, text: `${c.offer_line} / ${c.closer}` }))} value={pick.cta} onChange={(v) => setPick({ ...pick, cta: v })} />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">만들 형식</span>
            {(["image", "carousel"] as const).map((f) => (
              <label key={f} className="flex items-center gap-1"><input type="radio" checked={fmt === f} onChange={() => setFmt(f)} />{f === "image" ? "단일 이미지" : "캐러셀"}</label>
            ))}
            <label className="flex items-center gap-1 text-zinc-500"><input type="radio" disabled />영상 (연결 전)</label>
            <select className="rounded border bg-transparent p-1" value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>
              <option value="4:5">4:5 (피드)</option><option value="1:1">1:1</option><option value="9:16">9:16 (릴스)</option>
            </select>
          </div>
          <button disabled={!!busy} className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-40"
            onClick={() => run("deliverable", async () => {
              const r = await fetch("/api/deliverables", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ product: productInput(), answers, core: core.data, concept, hook: parts.data.hooks[pick.hook], body: parts.data.bodies[pick.body], cta: parts.data.ctas[pick.cta], type: fmt, aspect }),
              });
              const j = await r.json();
              if (!r.ok) throw new Error(j.error ?? "제작물을 만들지 못했어요");
              router.push(`/d/${j.deliverableId}`);
            })}>
            {busy === "deliverable" ? "만드는 중…" : "제작물 만들기"}
          </button>
        </section>
      )}
    </div>
  );
}

function Choice({ title, items, value, onChange }: { title: string; items: { label: string; text: string }[]; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">{title}</div>
      {items.map((it, i) => (
        <button key={i} type="button" onClick={() => onChange(i)} className={`rounded border p-3 text-left text-sm ${value === i ? "border-black ring-1 ring-black" : ""}`}>
          <b>{it.label}</b><br />{it.text}
        </button>
      ))}
    </div>
  );
}

function IssueList({ issues, ok }: { issues: Issue[]; ok: boolean }) {
  if (!issues.length) return null;
  return (
    <ul className={`rounded p-3 text-sm ${ok ? "bg-amber-50" : "bg-red-50"}`}>
      {!ok && <li className="font-medium">자동 검수에서 해결되지 않은 문제가 있어요. 확인 후 진행하세요.</li>}
      {issues.map((i, k) => <li key={k}>[{i.severity}] {i.path ? `${i.path}: ` : ""}{i.message}</li>)}
    </ul>
  );
}
