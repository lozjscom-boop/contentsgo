import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireUser } from "@/lib/auth";
import { raise } from "@/lib/errors";

export const POST = route("support.reply", async (req, ctx) => {
  const { id } = await ctx.params;
  const { body } = await parseBody(req, z.object({ body: z.string().trim().min(1).max(4000) }));
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("support_messages").insert({ ticket_id: id, author_id: user.id, author_kind: "customer", visibility: "customer", body });
  raise(error);
  return json({ ok: true }, 201);
});
