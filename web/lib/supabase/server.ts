import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/** 로그인한 사용자 권한(RLS 적용)으로 동작하는 서버 클라이언트 */
export async function createServerSupabase() {
  const { url, key } = supabaseEnv();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Component에서 호출된 경우 무시 (proxy가 세션을 갱신한다)
        }
      },
    },
  });
}
