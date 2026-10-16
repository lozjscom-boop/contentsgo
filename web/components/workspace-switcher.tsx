"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconChevron } from "./icons";

export default function WorkspaceSwitcher({ current, items }: { current: string; items: { id: string; name: string; role: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const cur = items.find((w) => w.id === current) ?? items[0];
  async function pick(id: string) {
    if (id === current) return setOpen(false);
    setBusy(true);
    await fetch("/api/workspace/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: id }) });
    setBusy(false);
    setOpen(false);
    router.refresh();
  }
  if (!cur) return null;
  return (
    <div className="relative">
      <button className="btn btn-ghost max-w-[14rem] !px-2.5" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} disabled={busy}>
        <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-xs font-bold text-accent-ink">{cur.name.slice(0, 1).toUpperCase()}</span>
        <span className="truncate text-foreground">{cur.name}</span>
        {items.length > 1 && <IconChevron className="shrink-0 opacity-60" />}
      </button>
      {open && items.length > 1 && (
        <>
          <button aria-label="닫기" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <ul role="listbox" className="card absolute left-0 top-full z-50 mt-1 w-64 p-1 shadow-xl">
            {items.map((w) => (
              <li key={w.id}>
                <button role="option" aria-selected={w.id === current} onClick={() => pick(w.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2">
                  <span className="truncate">{w.name}</span>
                  {w.id === current && <span className="badge badge-ok">사용 중</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
