import { CREDIT_PRICES } from "./credits";

/**
 * 제작 방식(레시피) 카탈로그. "샘플 결과물"이 아니라 어떤 구조로 만드는지 보여주는 카드다.
 * 실제 결과물 예시는 생성 후 라이브러리에 쌓이고, 여기서는 가짜 결과를 보여주지 않는다.
 */
export type RecipeCategory = "all" | "product" | "ugc" | "short" | "ad" | "poster" | "market";
export const RECIPE_CATEGORIES: { id: RecipeCategory; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "product", label: "제품샷" },
  { id: "ugc", label: "UGC" },
  { id: "short", label: "숏폼" },
  { id: "ad", label: "광고" },
  { id: "poster", label: "포스터" },
  { id: "market", label: "마켓플레이스" },
];

export type Recipe = {
  id: string; title: string; summary: string; category: Exclude<RecipeCategory, "all">;
  format: "image" | "carousel" | "video"; aspect: "1:1" | "4:5" | "9:16";
  credits: number; steps: [string, string, string]; hue: number; available: boolean;
};

export const RECIPES: Recipe[] = [
  { id: "clean-product", title: "깔끔한 제품 대표컷", summary: "단색 배경에 제품을 또렷하게. 상세페이지·스토어 대표 이미지용.", category: "product", format: "image", aspect: "1:1", credits: CREDIT_PRICES.image_advanced, steps: ["제품 중심 구도", "핵심 특징 한 줄", "구매 안내"], hue: 38, available: true },
  { id: "lifestyle-scene", title: "사용 장면 연출컷", summary: "제품이 쓰이는 상황을 한 장면으로. 공감형 광고에 잘 맞아요.", category: "product", format: "image", aspect: "4:5", credits: CREDIT_PRICES.image_advanced, steps: ["문제 상황 암시", "제품이 해결하는 순간", "행동 유도"], hue: 160, available: true },
  { id: "benefit-carousel", title: "핵심 혜택 5장 캐러셀", summary: "훅 1장, 혜택 3장, 전환 1장으로 넘겨보게 만드는 구조.", category: "ad", format: "carousel", aspect: "4:5", credits: CREDIT_PRICES.carousel_5, steps: ["첫 장 훅", "혜택 3장", "마지막 장 CTA"], hue: 210, available: true },
  { id: "before-after", title: "전후 비교형", summary: "달라진 점을 나란히 보여주는 카드뉴스. 표현 검수를 꼭 거쳐요.", category: "ad", format: "carousel", aspect: "4:5", credits: CREDIT_PRICES.carousel_5, steps: ["이전 상태", "사용 후 변화", "근거와 안내"], hue: 285, available: true },
  { id: "poster-offer", title: "프로모션 포스터", summary: "할인·이벤트를 한눈에. 문구 위주의 강한 한 장.", category: "poster", format: "image", aspect: "4:5", credits: CREDIT_PRICES.image_advanced, steps: ["큰 문구", "제품 이미지", "기간·조건"], hue: 12, available: true },
  { id: "market-main", title: "마켓 상세 대표 이미지", summary: "쿠팡·스마트스토어 대표 이미지 규격에 맞춘 정방형.", category: "market", format: "image", aspect: "1:1", credits: CREDIT_PRICES.image_advanced, steps: ["흰 배경 제품", "핵심 스펙", "신뢰 요소"], hue: 95, available: true },
  { id: "ugc-review", title: "후기형 UGC 영상", summary: "실사용 후기처럼 보이는 세로 영상 구성. 영상 제작 연동 후 열려요.", category: "ugc", format: "video", aspect: "9:16", credits: CREDIT_PRICES.video_hybrid_15s, steps: ["공감 훅", "사용 장면", "추천 멘트"], hue: 330, available: false },
  { id: "short-hook", title: "15초 숏폼 훅 영상", summary: "릴스·틱톡·쇼츠용 15초. 3초 훅 중심 구성. 영상 제작 연동 후 열려요.", category: "short", format: "video", aspect: "9:16", credits: CREDIT_PRICES.video_hybrid_15s, steps: ["3초 훅", "핵심 시연", "전환 문구"], hue: 190, available: false },
];
