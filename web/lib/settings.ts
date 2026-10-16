import "server-only";
import { createAdminSupabase } from "./supabase/admin";

type Json = Record<string, unknown>;
const DEFAULTS: Record<string, Json> = {
  trial: { enabled: true, credits: 30, days: 7, require_phone: false },
  billing: { mode: "disabled" },
  signup: { enabled: true },
  maintenance: { banner: "" },
  features: { image: true, carousel: true, video: false, analysis: true, explore: true, team: true },
  limits: { worker_global_concurrency: 6, daily_provider_budget_usd: 20 },
};

/** 사이트 설정(서버 전용). 테이블이 없거나 행이 없으면 기본값으로 동작한다 (DB 업데이트 전에도 사이트가 죽지 않게). */
export async function getSetting<T extends Json = Json>(key: string): Promise<T> {
  try {
    const { data } = await createAdminSupabase().from("site_settings").select("value_json").eq("key", key).maybeSingle();
    return { ...(DEFAULTS[key] ?? {}), ...((data?.value_json as Json) ?? {}) } as T;
  } catch {
    return (DEFAULTS[key] ?? {}) as T;
  }
}

export async function featureEnabled(name: string): Promise<boolean> {
  const f = await getSetting<Record<string, boolean>>("features");
  return f[name] !== false;
}
