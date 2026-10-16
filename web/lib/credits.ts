/**
 * 크레딧 가격표 (blueprint 10장 v1.5 제안값). 실제 가격은 운영하면서 조정할 수 있게 한곳에 둔다.
 * 단위: 크레딧. 실제 외부 호출 원가와 연동되는 값이 아니라 판매용 단위다.
 */
export const CREDIT_PRICES = {
  product_analysis: 3,
  planning: 5,
  video_analysis: 10,
  image_basic: 10,
  image_advanced: 30,
  carousel_5: 40,
  video_hybrid_15s: 100,
  video_generated_15s: 250,
} as const;
export type CreditSku = keyof typeof CREDIT_PRICES;

export function priceOf(sku: CreditSku, quantity = 1): number {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("invalid_quantity");
  return CREDIT_PRICES[sku] * quantity;
}

/** 예약 키: 같은 요청(재시도/더블클릭)이 같은 키를 갖도록 호출자가 요청 키에서 만든다. */
export const reservationKey = (requestKey: string) => `gen:${requestKey}`;

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> };

export class InsufficientCreditsError extends Error {
  constructor() {
    super("insufficient_credits");
  }
}

export async function reserve(admin: Rpc, workspaceId: string, amount: number, key: string) {
  const { error } = await admin.rpc("svc_reserve_credits", { p_ws: workspaceId, p_amount: amount, p_ref: key });
  if (error) {
    if (error.message.includes("insufficient_credits")) throw new InsufficientCreditsError();
    throw new Error(error.message);
  }
}

export async function settle(admin: Rpc, workspaceId: string, key: string, captured: number) {
  const { error } = await admin.rpc("svc_settle_credits", { p_ws: workspaceId, p_ref: key, p_captured: captured });
  if (error) throw new Error(error.message);
}

/** 장면 1개 생성 가격. 단일 이미지는 고급(나노바나나 프로) 요금, 캐러셀은 5장 세트 가격을 장당으로 나눈다. */
export function sceneImagePrice(type: "image" | "carousel" | "video"): number {
  if (type === "image") return CREDIT_PRICES.image_advanced;
  if (type === "carousel") return Math.ceil(CREDIT_PRICES.carousel_5 / 5);
  throw new Error("video_scene_not_supported_here");
}
