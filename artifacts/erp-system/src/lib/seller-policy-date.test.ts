import { afterEach, describe, expect, it, vi } from "vitest";
import { fmtSellerPolicyDate } from "./sellers";

afterEach(() => vi.unstubAllEnvs());

describe("Saudi seller-policy civil date", () => {
  it("shows Riyadh midnight on the chosen Gregorian day even in a US browser timezone", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const text = fmtSellerPolicyDate("2026-10-22T21:00:00.000Z")
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
    expect(text).toMatch(/23.*أكتوبر.*2026/);
    expect(text).not.toMatch(/22.*أكتوبر/);
  });
  it("reports invalid stored dates explicitly", () => {
    expect(fmtSellerPolicyDate("invalid")).toBe("تاريخ غير صحيح");
  });
});
