import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/jobs/run 은 로그인 대신 CRON_SECRET(Bearer)으로 보호된다
const PUBLIC = ["/login", "/auth/callback", "/api/health", "/api/jobs/run"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const isPublic = PUBLIC.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!data.user && !isPublic) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized", detail: "로그인이 필요해요." }, { status: 401 });
    const url = request.nextUrl.clone();
    const back = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = back !== "/" ? `?next=${encodeURIComponent(back)}` : "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
