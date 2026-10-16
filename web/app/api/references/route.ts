import { z } from "zod";
import { route, json, parseBody } from "@/lib/api/route";
import { requireWorkspace } from "@/lib/auth";
import { DomainError, raise } from "@/lib/errors";

const Body = z.object({
  title: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), "http(s) 주소만 가능해요").optional().or(z.literal("").transform(() => undefined)),
  platform: z.enum(["meta", "tiktok", "instagram", "youtube", "other"]),
  notes: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});

export const POST = route("reference.create", async (req) => {
  const p = await parseBody(req, Body);
  const { supabase, workspaceId, canEdit, user } = await requireWorkspace();
  if (!canEdit) throw new DomainError("forbidden", 403, "편집 권한이 없어요.");
  const { error, data } = await supabase.from("reference_items").insert({ workspace_id: workspaceId, created_by: user.id, ...p, url: p.url ?? null, notes: p.notes ?? "" }).select("id").single();
  raise(error);
  return json({ id: data!.id });
});
