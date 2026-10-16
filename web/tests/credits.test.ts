import { describe, expect, it, vi } from "vitest";
import { InsufficientCreditsError, priceOf, reserve, settle } from "../lib/credits";

describe("credits helper", () => {
  it("가격표 수량 계산", () => {
    expect(priceOf("image_basic", 3)).toBe(30);
    expect(() => priceOf("image_basic", 0)).toThrow();
    expect(() => priceOf("image_basic", 1.5)).toThrow();
  });
  it("잔액 부족 에러를 구분한다", async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ error: { message: "insufficient_credits" } }) };
    await expect(reserve(admin, "w", 10, "k")).rejects.toBeInstanceOf(InsufficientCreditsError);
  });
  it("다른 에러는 그대로 전달", async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ error: { message: "boom" } }) };
    await expect(settle(admin, "w", "k", 1)).rejects.toThrow("boom");
  });
});
