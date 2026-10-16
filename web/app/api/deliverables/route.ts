import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireWorkspace } from "@/lib/auth";
import { createDeliverable } from "@/lib/deliverables/create";
import { BodyPart, BriefAnswers, Concept, CorePointsOutput, CtaPart, HookPart, ProductInput } from "@/lib/planning/schemas";

const Body = z.object({
  product: ProductInput, answers: BriefAnswers, core: CorePointsOutput, concept: Concept,
  hook: HookPart, body: BodyPart, cta: CtaPart,
  type: z.enum(["image", "carousel", "video"]),
  aspect: z.enum(["1:1", "4:5", "9:16"]).optional(),
});

export async function POST(req: Request) {
  try {
    const { supabase, workspaceId, canEdit } = await requireWorkspace();
    if (!canEdit) return NextResponse.json({ error: "편집 권한이 없어요" }, { status: 403 });
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_input", detail: parsed.error.issues }, { status: 400 });
    const out = await createDeliverable(supabase, { workspaceId, ...parsed.data });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("create deliverable failed", e);
    return NextResponse.json({ error: (e as Error).message ?? "create_failed" }, { status: 500 });
  }
}
