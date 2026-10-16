export default function TabPlan({ title, summary, items, status = "만드는 중" }: { title: string; summary: string; items: string[]; status?: string }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">{status}</span>
      </div>
      <p className="mb-6 text-sm text-zinc-400">{summary}</p>
      <h2 className="mb-2 text-sm font-semibold text-zinc-300">1차에 들어갈 기능</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">
        {items.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </main>
  );
}
