import { cookies } from "next/headers";
import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace, WS_COOKIE } from "@/lib/auth";

/** 활성 워크스페이스 전환. 소속을 DB에서 확인한 뒤에만 쿠키에 저장한다. */
export const POST = route("workspace.switch", async (req) => {
  const { workspaceId } = await parseBody(req, z.object({ workspaceId: z.string().uuid() }));
  const auth = await requireWorkspace(workspaceId);
  (await cookies()).set(WS_COOKIE, auth.workspaceId, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 180 });
  return json({ ok: true });
});
