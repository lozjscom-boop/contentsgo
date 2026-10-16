import "server-only";
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

export type WalletSummary = { available: number; reserved: number; expiringSoon: number; expiresAt: string | null };

/** 화면용 잔액 요약. 요청당 1회만 조회(React cache). 만료는 sweeper 가 주기적으로 반영하고, 여기서는 만료 예정만 보여준다. */
export const getWalletSummary = cache(async (workspaceId: string): Promise<WalletSummary> => {
  const sb = await createServerSupabase();
  const [{ data: w }, { data: b }] = await Promise.all([
    sb.from("wallet_accounts").select("available, reserved").eq("workspace_id", workspaceId).maybeSingle(),
    sb.from("credit_buckets").select("remaining, expires_at").eq("workspace_id", workspaceId).gt("remaining", 0).not("expires_at", "is", null)
      .lte("expires_at", new Date(Date.now() + 7 * 864e5).toISOString()).order("expires_at").limit(20),
  ]);
  const soon = (b ?? []).reduce((s, x) => s + Number(x.remaining), 0);
  return { available: Number(w?.available ?? 0), reserved: Number(w?.reserved ?? 0), expiringSoon: soon, expiresAt: b?.[0]?.expires_at ?? null };
});
