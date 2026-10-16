import { connection, NextResponse } from "next/server";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "GEMINI_API_KEY",
  "GEMINI_TEXT_MODEL",
  "GEMINI_IMAGE_MODEL",
] as const;

async function status(url: string, init?: RequestInit) {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    return r.status;
  } catch {
    return "unreachable";
  }
}

/** 환경 점검용. 값은 절대 노출하지 않고, 설정 여부와 연결 상태 코드만 반환한다. */
export async function GET() {
  await connection(); // 요청 시점에 실행 (빌드 때 미리 만들어지지 않게)
  const set = Object.fromEntries(REQUIRED.map((k) => [k, Boolean(process.env[k]?.trim())]));
  const env = process.env;
  const checks: Record<string, unknown> = {};

  if (set.NEXT_PUBLIC_SUPABASE_URL && set.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    checks.supabase_auth = await status(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    });
  }
  if (set.NEXT_PUBLIC_SUPABASE_URL && set.SUPABASE_SECRET_KEY) {
    checks.supabase_secret_key = await status(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/workspaces?select=id&limit=1`, {
      headers: { apikey: env.SUPABASE_SECRET_KEY! },
    });
  }
  for (const [label, name] of [["gemini_text_model", "GEMINI_TEXT_MODEL"], ["gemini_image_model", "GEMINI_IMAGE_MODEL"]] as const) {
    if (set.GEMINI_API_KEY && set[name]) {
      checks[label] = await status(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env[name]!.trim())}`, {
        headers: { "x-goog-api-key": env.GEMINI_API_KEY! },
      });
    }
  }
  // DB 마이그레이션 적용 여부 (UPDATE_04_TO_LATEST.sql 실행 확인)
  if (set.NEXT_PUBLIC_SUPABASE_URL && set.SUPABASE_SECRET_KEY) {
    for (const t of ["plan_versions", "credit_buckets", "audit_events"]) {
      checks[`schema_${t}`] = await status(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${t}?select=*&limit=0`, { headers: { apikey: env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY!}` } });
    }
  }
  const ok = Object.values(set).every(Boolean) && Object.values(checks).every((v) => v === 200);
  return NextResponse.json({ ok, set, checks });
}
