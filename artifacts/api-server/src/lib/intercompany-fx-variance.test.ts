import { describe, it, expect } from "vitest";
import { splitVariance } from "./intercompany-fx-variance";

describe("splitVariance", () => {
  it("returns zero FX when rates haven't moved", () => {
    const { fx, operational } = splitVariance(1000, 50, 3.75, 3.75);
    expect(fx).toBe(0);
    expect(operational).toBe(50);
  });

  it("attributes the rate movement to FX and leaves residual as operational", () => {
    // 1000 USD source, rate moved 3.75 → 3.80 = +0.05 SAR/USD
    // Expected FX = 1000 × 0.05 = 50; residual = total - 50
    const { fx, operational } = splitVariance(1000, 60, 3.75, 3.8);
    expect(fx).toBeCloseTo(50, 4);
    expect(operational).toBeCloseTo(10, 4);
  });

  it("handles rate depreciation (negative FX)", () => {
    const { fx, operational } = splitVariance(2000, -20, 3.8, 3.75);
    expect(fx).toBeCloseTo(-100, 4);
    expect(operational).toBeCloseTo(80, 4);
  });

  it("rounds to 4 decimals", () => {
    const { fx, operational } = splitVariance(123.456, 10, 3.751234, 3.762345);
    expect(Number.isFinite(fx)).toBe(true);
    expect(Number.isFinite(operational)).toBe(true);
    expect(String(fx).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});
