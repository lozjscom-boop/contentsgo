import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { raise } from "@/lib/errors";

const Body = z.object({
  category: z.enum(["signup", "quality", "credits", "files", "team", "error", "other"]),
  subject: z.string().trim().min(1, "제목을 입력해 주세요").max(120),
  body: z.string().trim().min(1, "내용을 입력해 주세요").max(4000),
});

/** 문의 접수. 본인 워크스페이스 멤버만 만들 수 있고(RLS), 첫 메시지는 같이 저장한다. */
export const POST = route("support.create", async (req) => {
  const b = await parseBody(req, Body);
  const { supabase, workspaceId, user } = await requireWorkspace();
  const { data, error } = await supabase.from("support_tickets").insert({ workspace_id: workspaceId, requester_id: user.id, category: b.category, subject: b.subject }).select("id").single();
  raise(error);
  const { error: e2 } = await supabase.from("support_messages").insert({ ticket_id: data!.id, author_id: user.id, author_kind: "customer", visibility: "customer", body: b.body });
  raise(e2);
  return json({ id: data!.id }, 201);
});
