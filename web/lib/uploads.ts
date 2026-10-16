export const UPLOAD_RULES = {
  product_photo: { mimes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 10 * 1024 * 1024 },
  reference: { mimes: ["video/mp4", "video/quicktime", "video/webm"], maxBytes: 45 * 1024 * 1024 }, // Supabase 무료 플랜 파일당 50MB
} as const;
export type UploadKind = keyof typeof UPLOAD_RULES;

export function checkUpload(kind: string, mime: string, bytes: number): string | null {
  const rule = UPLOAD_RULES[kind as UploadKind];
  if (!rule) return "지원하지 않는 업로드 종류예요";
  if (!(rule.mimes as readonly string[]).includes(mime)) return `이 형식은 올릴 수 없어요 (${rule.mimes.map((m) => m.split("/")[1]).join(", ")})`;
  if (!Number.isFinite(bytes) || bytes <= 0) return "파일이 비어 있어요";
  if (bytes > rule.maxBytes) return `파일이 너무 커요 (최대 ${Math.round(rule.maxBytes / 1024 / 1024)}MB)`;
  return null;
}

export const extOf = (mime: string) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" } as Record<string, string>)[mime] ?? "bin";
