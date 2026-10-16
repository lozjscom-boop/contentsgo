import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";
import { createDeliverable } from "@/lib/deliverables/create";
import { featureEnabled } from "@/lib/settings";
import { BodyPart, BriefAnswers, Concept, CorePointsOutput, CtaPart, HookPart, ProductInput } from "@/lib/planning/schemas";

const Body = z.object({
  product: ProductInput, answers: BriefAnswers, core: CorePointsOutput, concept: Concept,
  hook: HookPart, body: BodyPart, cta: CtaPart,
  type: z.enum(["image", "carousel", "video"]),
  aspect: z.enum(["1:1", "4:5", "9:16"]).optional(),
});

export const POST = route("deliverable.create", async (req) => {
  const body = await parseBody(req, Body);
  const { supabase, workspaceId, canEdit } = await requireWorkspace();
  if (!canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");
  if (!(await featureEnabled(body.type))) throw new DomainError("feature_disabled", 503, "지금은 이 형식을 만들 수 없어요.");
  try {
    return json(await createDeliverable(supabase, { workspaceId, ...body }));
  } catch (e) {
    raise({ message: (e as Error).message }); // 플랜 한도(브랜드·제품 수) 등 DB 규칙 위반은 도메인 오류로 변환
    throw e;
  }
});
