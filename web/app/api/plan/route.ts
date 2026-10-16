import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireWorkspace } from "@/lib/auth";
import { createGeminiLlm, ProviderNotConfiguredError } from "@/lib/providers/llm";
import { planConcepts, planCorePoints, planParts } from "@/lib/planning/engine";
import { BriefAnswers, Concept, CorePointsOutput, ProductInput } from "@/lib/planning/schemas";

export const maxDuration = 60;

const Body = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("core"), product: ProductInput, answers: BriefAnswers }),
  z.object({ stage: z.literal("concepts"), product: ProductInput, answers: BriefAnswers, core: CorePointsOutput }),
  z.object({ stage: z.literal("parts"), product: ProductInput, answers: BriefAnswers, concept: Concept }),
]);

export async function POST(req: Request) {
  try {
    await requireWorkspace();
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_input", detail: parsed.error.issues }, { status: 400 });
    const b = parsed.data;
    const llm = createGeminiLlm();
    const result =
      b.stage === "core"
        ? await planCorePoints(llm, b.product, b.answers)
        : b.stage === "concepts"
          ? await planConcepts(llm, b.product, b.answers, b.core)
          : await planParts(llm, b.product, b.answers, b.concept);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ProviderNotConfiguredError) return NextResponse.json({ error: "provider_not_configured", detail: e.message }, { status: 503 });
    console.error("plan failed", e);
    return NextResponse.json({ error: "plan_failed" }, { status: 502 });
  }
}
