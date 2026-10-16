"use client";
import { useRouter } from "next/navigation";

export default function MarkRead() {
  const router = useRouter();
  return <button className="btn" onClick={async () => { await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); router.refresh(); }}>모두 읽음으로 표시</button>;
}
