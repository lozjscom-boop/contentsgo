import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { raise } from "@/lib/errors";
import type { JobKind } from "./types";

export type EnqueueInput = {
  workspaceId: string; kind: JobKind; deliverableId?: string | null; requestKey: string;
  payload: Record<string, unknown>; credits: number;
};

/** 접수: 한도 확인 + 크레딧 예약 + job 생성이 DB에서 한 트랜잭션으로 일어난다. 같은 requestKey는 기존 job을 돌려준다. */
export async function enqueueJob(i: EnqueueInput): Promise<{ jobId: string; created: boolean; status: string }> {
  const { data, error } = await createAdminSupabase().rpc("svc_enqueue_job", {
    p_ws: i.workspaceId, p_kind: i.kind, p_deliverable: i.deliverableId ?? null,
    p_request_key: i.requestKey, p_payload: i.payload, p_credits: i.credits,
  });
  raise(error);
  const row = (Array.isArray(data) ? data[0] : data) as { job_id: string; created: boolean; status: string } | undefined;
  if (!row) throw new Error("enqueue returned nothing");
  return { jobId: row.job_id, created: row.created, status: row.status };
}
