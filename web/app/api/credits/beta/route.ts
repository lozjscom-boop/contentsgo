import { NextResponse } from "next/server";
import { AuthError, requireWorkspace } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/admin";

/** 베타 테스트 크레딧 1회 지급. 환경변수 BETA_GRANT_AMOUNT(1~5000)가 설정된 배포에서만 켜진다. 워크스페이스당 1회. */
export async function POST() {
  const amount = Number(process.env.BETA_GRANT_AMOUNT);
  if (!Number.isInteger(amount) || amount < 1 || amount > 5000) return NextResponse.json({ error: "disabled" }, { status: 404 });
  try {
    const { workspaceId, role } = await requireWorkspace();
    if (role !== "owner") return NextResponse.json({ error: "owner_only" }, { status: 403 });
    const { error } = await createAdminSupabase().rpc("svc_grant_credits", {
      p_ws: workspaceId, p_amount: amount, p_event_key: `beta-grant:${workspaceId}`, p_note: "베타 테스트 지급",
    });
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "already_granted" }, { status: 409 });
      throw new Error(error.message);
    }
    return NextResponse.json({ granted: amount });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("beta grant failed", e);
    return NextResponse.json({ error: "grant_failed" }, { status: 500 });
  }
}
