import Nav from "@/components/nav";
import { createServerSupabase } from "@/lib/supabase/server";
import { Suspense } from "react";

async function Account() {
  const sb = await createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  const { data: w } = await sb.from("wallet_accounts").select("available").limit(1).maybeSingle();
  return (
    <div className="mt-auto flex flex-col gap-1 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
      <span className="truncate">{u.user?.email}</span>
      <span>크레딧 <b className="text-zinc-100">{w?.available ?? 0}</b></span>
      <form action="/auth/signout" method="post"><button className="underline">로그아웃</button></form>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b border-zinc-800 p-4 md:w-56 md:border-b-0 md:border-r">
        <div className="text-lg font-bold">컨텐츠고</div>
        <Suspense fallback={null}><Nav /></Suspense>
        <Suspense fallback={null}><Account /></Suspense>
      </aside>
      <div className="flex-1">{children}</div>
    </div>
  );
}
