"use client";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/** 파일을 Storage에 직접 올리고 자산 ID를 돌려준다. */
export async function uploadAsset(file: File, kind: "product_photo" | "reference"): Promise<string> {
  const sign = await fetch("/api/uploads/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, mime: file.type, bytes: file.size }) });
  const s = await sign.json();
  if (!sign.ok) throw new Error(s.error ?? "업로드 준비 실패");
  const { error } = await createBrowserSupabase().storage.from("creatives").uploadToSignedUrl(s.path, s.token, file, { contentType: file.type });
  if (error) throw new Error(`업로드 실패: ${error.message}`);
  const done = await fetch("/api/uploads/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, path: s.path, mime: file.type }) });
  const d = await done.json();
  if (!done.ok) throw new Error(d.error ?? "업로드 확인 실패");
  return d.assetId as string;
}
