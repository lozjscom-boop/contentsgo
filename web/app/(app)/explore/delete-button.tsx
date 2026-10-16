"use client";
import { useRouter } from "next/navigation";
export default function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button className="text-xs text-zinc-500 underline" onClick={async () => { if (!confirm("삭제할까요?")) return; await fetch(`/api/references/${id}`, { method: "DELETE" }); router.refresh(); }}>삭제</button>
  );
}
