import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * service role(secret key) 클라이언트: RLS를 우회한다. 서버 route handler 안에서만 사용.
 * 사용 전에 반드시 요청자가 해당 workspace 구성원인지 직접 검증해야 한다 (lib/auth.ts requireWorkspace).
 */
export function createAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_SECRET_KEY 가 설정되지 않았습니다");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
