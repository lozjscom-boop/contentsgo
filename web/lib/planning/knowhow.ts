/**
 * 컨텐츠고 기획 노하우 상수.
 * 출처: contentsgo_blueprint_v1.5 35장(운영 노하우→제품 규칙), 53장(기획 엔진), 대표님 실패 체크리스트.
 * 이 값들은 "입증된 법칙"이 아니라 초기 가설/편집 기준이다. 운영하면서 버전을 올려 갱신한다.
 */

export const KNOWHOW_VERSION = "2026-10-16.1";

/** ① 제품 핵심 파악 질문. required=false는 건너뛰기 허용(직접 제작자는 답 대신 잠글 수 있음). */
export const BRIEF_QUESTIONS = [
  {
    key: "purchase_moment",
    label: "이 제품이 필요한 순간은 언제, 어디인가요?",
    help: "연령·성별보다 '어떤 상황의 누구'가 중요해요. 예: 약속 장소에 들어가기 직전",
    required: true,
  },
  {
    key: "desired_outcome",
    label: "그 순간 사는 사람이 얻고 싶은 건 뭔가요?",
    help: "제품 기능이 아니라 사람이 원하는 결과. 예: 향을 간편하게 챙기고 싶다",
    required: true,
  },
  {
    key: "purchase_barrier",
    label: "사기 전에 가장 망설이는 이유는 뭔가요?",
    help: "가격·사용법·차별성·신뢰 중 무엇인지",
    required: true,
  },
  {
    key: "proof",
    label: "화면이나 문구로 보여줄 수 있는 증거가 있나요?",
    help: "실제 시연 장면, 확인된 수치·성분, 인증 등 '확인된 사실'만 적어주세요",
    required: true,
  },
  {
    key: "one_scene",
    label: "제품의 핵심을 한 장면으로 보여준다면 어떤 장면인가요?",
    help: "예: 입술 초클로즈업으로 색을 보여준다 / 손목에 슥 바르는 동작",
    required: false,
  },
  {
    key: "offer",
    label: "지금 줄 수 있는 실제 혜택이나 판매 목적이 있나요?",
    help: "할인·구성·기간 등. 없으면 비워두세요",
    required: false,
  },
] as const;

export type BriefQuestionKey = (typeof BRIEF_QUESTIONS)[number]["key"];

/** 초기 광고 기획 패턴 6종 (35.3). 콘셉트 3안은 서로 다른 패턴이어야 한다. */
export const AD_PATTERNS = {
  use_moment: "사용 순간 — 언제 어떤 상황에서 쓰는지가 소구",
  objection_relief: "구매 망설임 해소 — 가격·사용법·신뢰 중 장벽 하나를 푼다",
  portability: "휴대·편의 — 간편하게 쓰고 챙긴다",
  texture_material: "질감·재료 — 실제 제형/소재/디테일을 보여준다",
  comparable_fact: "비교 가능한 사실 — 확인된 수치·구성으로 비교한다",
  real_benefit: "실제 혜택 — 가격·구성·기간 등 지금 사야 할 이유",
} as const;
export type AdPattern = keyof typeof AD_PATTERNS;
export const AD_PATTERN_KEYS = Object.keys(AD_PATTERNS) as [AdPattern, ...AdPattern[]];

/** 본문 유형 라이브러리. 형식은 껍데기이고 같은 유형도 컨셉에 따라 결과가 갈린다. */
export const BODY_TYPES = {
  info: "정보형 — 상황/날씨/패션 등 정보 안에 제품을 녹인다",
  situation_skit: "상황극형 — 짧은 연출 상황 속에서 제품이 등장한다",
  demo: "시연형 — 제품을 쓰는 동작·결과를 보여준다",
  review_staged: "후기 형식 연출형 — 후기 느낌으로 연출하되 연출임을 표시한다",
  comparison: "비교형 — 확인된 사실 기준으로 비교한다",
} as const;
export type BodyType = keyof typeof BODY_TYPES;
export const BODY_TYPE_KEYS = Object.keys(BODY_TYPES) as [BodyType, ...BodyType[]];

/** 영상 구조 규칙 (대표님 공식): 훅 0~3초 → 브랜드 한 줄 3~8초 → 본문 → 전환 */
export const VIDEO_RULES = {
  hookEndSec: 3,
  brandLineStartSec: 3,
  brandLineEndSec: 8,
  defaultTotalSec: 15,
} as const;

/** 캐러셀/이미지 설득 역할 (53.4) */
export const SLIDE_ROLES = ["attention", "message", "proof", "cta"] as const;
export type SlideRole = (typeof SLIDE_ROLES)[number];

/**
 * 이미지/영상 프롬프트 작성 규칙 — 대표님 실패 체크리스트에서 일반화 가능한 항목.
 * 부정문과 비유적 세분화 서술은 오히려 왜곡을 유발한 사례가 있어 금지한다.
 */
export const IMAGE_PROMPT_RULES = [
  "짧고 직접적인 긍정형 문장으로만 쓴다. 부정문('~없음', 'NOT ~', '~하지 않는')을 쓰지 않는다.",
  "부품이나 형태를 비유로 세분화해 설명하지 않는다. 보이는 모양을 있는 그대로 서술한다.",
  "한글 문구는 AI 이미지 안에 직접 그리지 않는다. 문구는 앱이 이미지 위에 별도 레이어로 얹는다(한글 깨짐 방지).",
  "제품 정확성이 중요한 장면은 제품 원본 사진을 참조로 보존한다. 분위기·맥락 장면만 생성한다.",
] as const;

/** 고위험 연출: AI가 안정적으로 만들기 어려운 장면. 경고 + 저위험 대안을 안내한다. */
export const HIGH_RISK_VISUALS: { code: string; pattern: RegExp; alt: string }[] = [
  {
    code: "hand_application",
    pattern: /(손으로|손가락으로|손등에|손목에|입술에|피부에).{0,8}(바르|발라|문지르|펴 ?바)/,
    alt: "실사 시연 클립이 없으면 정지컷 + 모션 처리(제품 클로즈업, 바른 뒤 결과 컷)로 대체하세요.",
  },
  {
    code: "label_closeup",
    pattern: /(라벨|로고|상표|한글 ?문구).{0,8}(클로즈업|확대|선명)/,
    alt: "라벨 글자는 AI가 깨뜨리기 쉬워요. 제품 원본 사진을 보존하고 문구는 레이어로 얹으세요.",
  },
  {
    code: "multi_person_interaction",
    pattern: /(두 사람|커플|여러 명|다수의 사람).{0,10}(포옹|키스|스킨십|대화)/,
    alt: "인물 한 명 중심 장면으로 줄이면 일관성이 좋아요.",
  },
];

/** 후기를 진짜처럼 보이게 하는 표현 — 연출 후기를 실제 후기/증언으로 표시하면 안 된다. */
export const REAL_TESTIMONIAL_PATTERNS: RegExp[] = [
  /실제 ?(구매자|고객|사용자)/,
  /리얼 ?후기/,
  /진짜 ?후기/,
  /(후기|리뷰) ?\d[\d,]*\s?(개|건|명)/,
  /고객님이 ?직접/,
];

/** 근거 없이 쓰면 안 되는 의료·효능 표현 (제품별 forbidden_claims와 합쳐서 검사) */
export const GLOBAL_FORBIDDEN_CLAIMS: string[] = [
  "치료",
  "완치",
  "의학적",
  "임상 ?입증",
  "100% ?(효과|보장)",
  "부작용 ?없",
];
