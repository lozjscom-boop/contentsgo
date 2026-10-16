import { Suspense } from "react";
import { requireWorkspace } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/admin";
import TeamClient from "./team-client";

async function Body() {
  const { supabase, workspaceId, user, canManage } = await requireWorkspace();
  const { data: ms } = await supabase.from("memberships").select("user_id, role").eq("workspace_id", workspaceId).eq("status", "active").order("created_at");
  const admin = createAdminSupabase();
  const members = await Promise.all((ms ?? []).map(async (m) => {
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    return { userId: m.user_id as string, role: m.role as string, email: data.user?.email ?? "(알 수 없음)" };
  }));
  const { data: inv } = canManage
    ? await supabase.from("invitations").select("id, email, role, expires_at").eq("workspace_id", workspaceId).eq("status", "pending").order("created_at", { ascending: false })
    : { data: [] };
  return <TeamClient me={user.id} canManage={canManage} members={members} invites={(inv ?? []) as { id: string; email: string; role: string; expires_at: string }[]} />;
}

export default function Page() {
  return <Suspense fallback={<div className="skeleton h-64" />}><Body /></Suspense>;
}
