import { Suspense } from "react";
import SettingsNav from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <h1 className="page-title">설정</h1>
      <Suspense fallback={<div className="skeleton mt-4 h-9 w-72" />}><SettingsNav /></Suspense>
      <div className="mt-6">{children}</div>
    </div>
  );
}
