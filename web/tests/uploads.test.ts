import { describe, expect, it } from "vitest";
import { checkUpload } from "../lib/uploads";

describe("업로드 검증", () => {
  it("허용 형식·크기", () => {
    expect(checkUpload("product_photo", "image/png", 1000)).toBeNull();
    expect(checkUpload("reference", "video/mp4", 40 * 1024 * 1024)).toBeNull();
  });
  it("거부: 형식, 크기, 빈 파일, 알 수 없는 종류", () => {
    expect(checkUpload("product_photo", "application/pdf", 1000)).toMatch(/형식/);
    expect(checkUpload("reference", "video/mp4", 46 * 1024 * 1024)).toMatch(/너무 커요/);
    expect(checkUpload("reference", "video/mp4", 0)).toMatch(/비어/);
    expect(checkUpload("export", "video/mp4", 10)).toMatch(/지원/);
  });
});
