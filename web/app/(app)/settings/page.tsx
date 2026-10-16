import { Suspense } from "react";
import Products from "./products";

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="skeleton h-40" />}>
      <Products />
    </Suspense>
  );
}
