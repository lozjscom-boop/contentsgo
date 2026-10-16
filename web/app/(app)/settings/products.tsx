import { createServerSupabase } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/storage";
import PhotoUpload from "./photo-upload";

export default async function Products() {
  const sb = await createServerSupabase();
  const { data: products } = await sb.from("products").select("id, name, category, facts_json, forbidden_claims, main_image_asset_id, brands(name)").order("created_at", { ascending: false });
  const ids = (products ?? []).map((p) => p.main_image_asset_id).filter(Boolean) as string[];
  const { data: assets } = ids.length ? await sb.from("assets").select("id, object_key").in("id", ids) : { data: [] as { id: string; object_key: string }[] };
  const urls = await signedUrls((assets ?? []).map((a) => a.object_key));
  const keyOf = new Map((assets ?? []).map((a) => [a.id, a.object_key]));

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-zinc-300">제품</h2>
      {(products ?? []).length === 0 && <p className="text-sm text-zinc-500">아직 제품이 없어요. 오늘의 컨텐츠에서 제작물을 만들면 자동으로 등록돼요.</p>}
      <ul className="flex flex-col gap-4">
        {(products ?? []).map((p) => {
          const key = p.main_image_asset_id ? keyOf.get(p.main_image_asset_id) : undefined;
          const brand = (p.brands as unknown as { name: string } | null)?.name;
          return (
            <li key={p.id} className="flex gap-3 rounded border border-zinc-800 p-3">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded bg-zinc-900">
                {key && urls[key] ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={urls[key]} alt={p.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">사진 없음</div>}
              </div>
              <div className="flex flex-1 flex-col gap-1 text-sm">
                <div><b>{brand}</b> · {p.name}{p.category ? ` · ${p.category}` : ""}</div>
                <div className="text-xs text-zinc-500">확인된 사실 {Object.keys(p.facts_json ?? {}).length}개 · 금지 표현 {(p.forbidden_claims ?? []).length}개</div>
                <PhotoUpload productId={p.id} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-zinc-500">제품 사진을 올려두면, 제품 모양이 중요한 장면을 만들 때 원본을 참조해요.</p>
    </section>
  );
}
