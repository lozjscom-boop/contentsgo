import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireUser } from "@/lib/auth";
import { raise } from "@/lib/errors";

/** 알림 읽음 처리. ids 가 없으면 내 알림 전체. RLS 가 본인 행만 허용한다. */
export const POST = route("notifications.read", async (req) => {
  const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().uuid()).max(100).optional() }));
  const { supabase } = await requireUser();
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (ids?.length) q = q.in("id", ids);
  const { error } = await q;
  raise(error);
  return json({ ok: true });
});
