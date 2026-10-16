import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  await (await createServerSupabase()).auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
