"use client";
import { Msg, useOps } from "@/components/ops-action";

export default function ResolveButtons({ jobId }: { jobId: string }) {
  const { run, msg, busy } = useOps();
  const go = (outcome: "failed" | "ready") => {
    const note = prompt(outcome === "failed" ? "실패로 처리하고 크레딧을 돌려줍니다. 사유를 적어주세요." : "생성된 것으로 확인했고 크레딧을 확정합니다. 확인한 내용을 적어주세요.");
    if (note && note.trim().length >= 2) run({ action: "resolve_job", jobId, outcome, note: note.trim() });
  };
  return (<div className="mt-2 flex items-center gap-2"><button className="btn !py-1" disabled={busy} onClick={() => go("failed")}>실패 처리(크레딧 반환)</button><button className="btn !py-1" disabled={busy} onClick={() => go("ready")}>생성됨 확인(크레딧 확정)</button><Msg m={msg} /></div>);
}
