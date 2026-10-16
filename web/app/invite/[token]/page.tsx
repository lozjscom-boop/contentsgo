import { Suspense } from "react";
import Accept from "./accept";

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Suspense fallback={<div className="skeleton h-40 w-full max-w-sm" />}><Inner params={params} /></Suspense>
    </main>
  );
}

async function Inner({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Accept token={token} />;
}
