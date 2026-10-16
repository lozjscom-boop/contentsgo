"use client";
import { useState } from "react";
import { Msg, useOps } from "@/components/ops-action";

type S = { trial: { enabled: boolean; credits: number; days: number }; features: Record<string, boolean>; maintenance: { banner: string }; signup: { enabled: boolean } };
const FEATURE_LABEL: Record<string, string> = { image: "이미지", carousel: "캐러셀", video: "영상", analysis: "영상 분석", explore: "탐색", team: "팀" };

export default function SettingsForm({ initial }: { initial: S }) {
  const { run, msg, busy } = useOps();
  const [s, setS] = useState(initial);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">기능 켜기/끄기</h2>
        {Object.entries(FEATURE_LABEL).map(([k, l]) => (
          <label key={k} className="flex items-center justify-between text-sm">{l}<input type="checkbox" checked={s.features[k] !== false} onChange={(e) => setS({ ...s, features: { ...s.features, [k]: e.target.checked } })} /></label>
        ))}
        <button className="btn btn-primary" disabled={busy} onClick={() => run({ action: "setting", key: "features", value: s.features }, "기능 설정을 저장할까요? 바로 적용돼요.")}>저장</button>
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">체험 크레딧</h2>
        <label className="flex items-center justify-between text-sm">지급 사용<input type="checkbox" checked={s.trial.enabled} onChange={(e) => setS({ ...s, trial: { ...s.trial, enabled: e.target.checked } })} /></label>
        <label className="flex items-center justify-between gap-3 text-sm">크레딧<input className="field !w-28" type="number" min={0} value={s.trial.credits} onChange={(e) => setS({ ...s, trial: { ...s.trial, credits: Number(e.target.value) } })} /></label>
        <label className="flex items-center justify-between gap-3 text-sm">유효 일수<input className="field !w-28" type="number" min={1} value={s.trial.days} onChange={(e) => setS({ ...s, trial: { ...s.trial, days: Number(e.target.value) } })} /></label>
        <button className="btn btn-primary" disabled={busy} onClick={() => run({ action: "setting", key: "trial", value: s.trial })}>저장</button>
      </section>
      <section className="card space-y-3 p-5 lg:col-span-2">
        <h2 className="text-sm font-semibold">공지 배너</h2>
        <input className="field" maxLength={200} placeholder="비우면 표시하지 않아요" aria-label="공지" value={s.maintenance.banner} onChange={(e) => setS({ ...s, maintenance: { banner: e.target.value } })} />
        <button className="btn btn-primary" disabled={busy} onClick={() => run({ action: "setting", key: "maintenance", value: s.maintenance })}>저장</button>
      </section>
      <div className="lg:col-span-2"><Msg m={msg} /></div>
    </div>
  );
}
