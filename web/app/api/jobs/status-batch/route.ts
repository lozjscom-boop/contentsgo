import { route, json } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError } from "@/lib/errors";

/** 진행 중인 작업 상태를 한 번에 조회 (브라우저가 작업마다 따로 polling하지 않도록). RLS로 내 워크스페이스 작업만 보인다. */
export const GET = route("jobs.status_batch", async (req) => {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 20);
  if (ids.some((i) => !/^[0-9a-f-]{36}$/i.test(i))) throw new DomainError("invalid_input", 422, "잘못된 요청이에요.");
  if (!ids.length) return json({ jobs: [] });
  const auth = await requireWorkspace();
  const { data } = await auth.supabase.from("jobs").select("id, status, last_error, kind, deliverable_id, payload").in("id", ids);
  return json({
    jobs: (data ?? []).map((j) => ({ id: j.id, status: j.status, error: j.status === "failed" ? j.last_error : null, kind: j.kind, deliverableId: j.deliverable_id, analysisId: (j.payload as { analysisId?: string })?.analysisId ?? null })),
  });
});
