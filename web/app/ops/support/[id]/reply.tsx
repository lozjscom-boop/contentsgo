"use client";
import { useState } from "react";
import { Msg, useOps } from "@/components/ops-action";

export default function Reply({ ticketId, status }: { ticketId: string; status: string }) {
  const { run, msg, busy } = useOps();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  return (
    <div className="mt-6 space-y-3">
      <textarea className="field min-h-24" aria-label="답변" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> 내부 메모(고객에게 안 보임)</label>
        <button className="btn btn-primary" disabled={busy || !body.trim()} onClick={async () => { if (await run({ action: "ticket_reply", ticketId, body, internal })) setBody(""); }}>{internal ? "메모 저장" : "답변 보내기"}</button>
        <select aria-label="상태" className="field !w-auto" value={status} onChange={(e) => run({ action: "ticket_status", ticketId, status: e.target.value })}>
          {["open", "triaged", "in_progress", "waiting_customer", "resolved", "closed"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <Msg m={msg} />
      </div>
    </div>
  );
}
