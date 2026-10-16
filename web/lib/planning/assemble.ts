import { KNOWHOW_VERSION, VIDEO_RULES } from "./knowhow";
import {
  DeliverableDocument,
  SCHEMA_VERSION,
  type BodyPart,
  type Concept,
  type CtaPart,
  type HookPart,
  type SceneSpec,
} from "./schemas";

export type AssembleInput = {
  type: "image" | "carousel" | "video";
  aspect?: "1:1" | "4:5" | "9:16";
  productName: string;
  concept: Concept;
  hook: HookPart;
  body: BodyPart;
  cta: CtaPart;
  totalSec?: number;
};

const CTA_SEC = 3;

/** 브랜드 한 줄 장면: 제품을 정확히 보여주는 장면. 긍정형 직접 서술. */
const brandLineVisual = (productName: string) =>
  `${productName} 제품을 화면 중앙에 두고 차분한 단색 배경에서 정면으로 보여준다`;

const roundHalf = (n: number) => Math.round(n * 2) / 2;

function assembleVideo(i: AssembleInput): SceneSpec[] {
  const total = i.totalSec ?? VIDEO_RULES.defaultTotalSec;
  const bodyStart = VIDEO_RULES.brandLineEndSec;
  const bodyEnd = total - CTA_SEC;
  if (bodyEnd <= bodyStart) {
    throw new Error(`영상 길이(${total}초)가 너무 짧아요. 훅 3초 + 브랜드 한 줄 5초 + 전환 ${CTA_SEC}초 + 본문이 필요해요.`);
  }
  const share = (bodyEnd - bodyStart) / i.body.beats.length;

  const scenes: SceneSpec[] = [
    {
      scene_key: "s1",
      role: "hook",
      start_sec: 0,
      end_sec: VIDEO_RULES.hookEndSec,
      caption: i.hook.caption,
      overlay_lines: [],
      visual_prompt: i.hook.visual_prompt,
      caption_mode: "overlay",
      preserve_product: true,
    },
    {
      scene_key: "s2",
      role: "brand_line",
      start_sec: VIDEO_RULES.brandLineStartSec,
      end_sec: VIDEO_RULES.brandLineEndSec,
      caption: i.body.brand_line,
      overlay_lines: [],
      visual_prompt: brandLineVisual(i.productName),
      caption_mode: "overlay",
      preserve_product: true,
    },
  ];

  i.body.beats.forEach((beat, idx) => {
    scenes.push({
      scene_key: `s${idx + 3}`,
      role: "body",
      start_sec: roundHalf(bodyStart + share * idx),
      end_sec: idx === i.body.beats.length - 1 ? bodyEnd : roundHalf(bodyStart + share * (idx + 1)),
      slide_role: beat.role,
      caption: beat.caption,
      overlay_lines: [],
      visual_prompt: beat.visual_prompt,
      caption_mode: "overlay",
      preserve_product: beat.role === "proof",
    });
  });

  scenes.push({
    scene_key: `s${i.body.beats.length + 3}`,
    role: "cta",
    start_sec: bodyEnd,
    end_sec: total,
    caption: i.cta.offer_line,
    overlay_lines: [i.cta.closer],
    visual_prompt: i.cta.visual_prompt,
    caption_mode: "overlay",
    preserve_product: true,
  });
  return scenes;
}

function assembleCarousel(i: AssembleInput): SceneSpec[] {
  const scenes: SceneSpec[] = [
    {
      scene_key: "p1",
      role: "hook",
      slide_role: "attention",
      caption: i.hook.caption,
      overlay_lines: [],
      visual_prompt: i.hook.visual_prompt,
      caption_mode: "overlay",
      preserve_product: true,
    },
    {
      scene_key: "p2",
      role: "brand_line",
      slide_role: "message",
      caption: i.body.brand_line,
      overlay_lines: [],
      visual_prompt: brandLineVisual(i.productName),
      caption_mode: "overlay",
      preserve_product: true,
    },
  ];
  i.body.beats.forEach((beat, idx) =>
    scenes.push({
      scene_key: `p${idx + 3}`,
      role: "body",
      slide_role: beat.role,
      caption: beat.caption,
      overlay_lines: [],
      visual_prompt: beat.visual_prompt,
      caption_mode: "overlay",
      preserve_product: beat.role === "proof",
    }),
  );
  scenes.push({
    scene_key: `p${i.body.beats.length + 3}`,
    role: "cta",
    slide_role: "cta",
    caption: i.cta.offer_line,
    overlay_lines: [i.cta.closer],
    visual_prompt: i.cta.visual_prompt,
    caption_mode: "overlay",
    preserve_product: true,
  });
  return scenes;
}

/** 단일 이미지: 한 장 안에 attention → message → cta 우선순위로 문구를 쌓는다 */
function assembleImage(i: AssembleInput): SceneSpec[] {
  return [
    {
      scene_key: "i1",
      role: "hook",
      slide_role: "attention",
      caption: i.hook.caption,
      overlay_lines: [i.body.brand_line, i.cta.offer_line],
      visual_prompt: i.hook.visual_prompt,
      caption_mode: "overlay",
      preserve_product: true,
    },
  ];
}

export function assembleDeliverable(i: AssembleInput): DeliverableDocument {
  const scenes =
    i.type === "video" ? assembleVideo(i) : i.type === "carousel" ? assembleCarousel(i) : assembleImage(i);

  const disclosures: string[] = [];
  if (i.body.body_type === "review_staged" && i.body.staged_disclosure) {
    disclosures.push(i.body.staged_disclosure);
  }

  const doc = {
    schema_version: SCHEMA_VERSION,
    type: i.type,
    total_sec: i.type === "video" ? (i.totalSec ?? VIDEO_RULES.defaultTotalSec) : undefined,
    aspect: i.aspect ?? (i.type === "video" ? "9:16" : i.type === "carousel" ? "4:5" : "1:1"),
    scenes,
    tags: {
      appeal: i.concept.appeal,
      pattern: i.concept.pattern,
      hook_label: i.hook.label,
      body_label: i.body.label,
      cta_label: i.cta.label,
      body_type: i.body.body_type,
      knowhow_version: KNOWHOW_VERSION,
    },
    disclosures,
  };
  // 스키마로 한 번 더 검증해서 저장 전에 계약 위반을 잡는다
  return DeliverableDocument.parse(doc);
}
