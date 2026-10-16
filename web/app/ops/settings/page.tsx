import { Suspense } from "react";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import SettingsForm from "./form";

const ENV: Record<string, string[]> = {
  gemini: ["GEMINI_API_KEY", "GEMINI_TEXT_MODEL", "GEMINI_IMAGE_MODEL"], higgsfield: ["HIGGSFIELD_API_KEY"], elevenlabs: ["ELEVENLABS_API_KEY"],
  email: ["RESEND_API_KEY"], captcha: ["TURNSTILE_SECRET_KEY"], supabase: ["SUPABASE_SECRET_KEY"], cron: ["CRON_SECRET"],
};

async function Body() {
  const [trial, features, maintenance, signup] = await Promise.all([getSetting("trial"), getSetting("features"), getSetting("maintenance"), getSetting("signup")]);
  const { data: integ } = await createAdminSupabase().from("integration_status").select("provider, status, last_error");
  return (
    <>
      <SettingsForm initial={{ trial, features, maintenance, signup } as never} />
      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold">연동 상태</h2>
        <ul className="card divide-y divide-line overflow-hidden">
          {Object.entries(ENV).map(([k, vars]) => {
            const set = vars.every((v) => !!process.env[v]?.trim());
            const rec = integ?.find((i) => i.provider === k);
            return (<li key={k} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span>{k} <span className="text-xs text-muted">{vars.join(", ")}</span></span><span className={`badge ${set ? "badge-ok" : "badge-warn"}`}>{set ? "환경변수 있음" : "미설정"}{rec?.status === "error" ? " · 오류" : ""}</span></li>);
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">실제 연결 확인은 /api/health 에서 해요. 값 자체는 어디에도 표시하지 않아요.</p>
      </section>
    </>
  );
}

export default function Page() {
  return (<><h1 className="page-title">사이트 설정</h1><div className="mt-6"><Suspense fallback={<div className="skeleton h-64" />}><Body /></Suspense></div></>);
}
