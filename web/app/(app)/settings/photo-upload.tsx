"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadAsset } from "@/components/upload-client";

export default function PhotoUpload({ productId }: { productId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setErr("");
    try {
      const assetId = await uploadAsset(f, "product_photo");
      const r = await fetch(`/api/products/${productId}/photo`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId }) });
      if (!r.ok) throw new Error((await r.json()).error ?? "연결 실패");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <label className="inline-block cursor-pointer rounded border border-zinc-600 px-2 py-1 text-xs">
        {busy ? "올리는 중…" : "제품 사진 올리기"}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {err && <span className="ml-2 text-xs text-red-400">{err}</span>}
    </div>
  );
}
