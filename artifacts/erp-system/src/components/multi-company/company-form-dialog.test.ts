import { describe, expect, it } from "vitest";
import { companyFormSchema } from "./company-form-dialog";

const valid = { name: "منشأة اختبار", baseCurrency: "sar", fiscalYearStartMonth: 12 };

describe("company form numeric month after validation-library upgrade", () => {
  it("keeps a numeric month and normalizes the currency", () => {
    const result = companyFormSchema.parse(valid);
    expect(result.fiscalYearStartMonth).toBe(12);
    expect(result.baseCurrency).toBe("SAR");
  });
  it("rejects a cleared number input, out-of-range months and fractions", () => {
    for (const fiscalYearStartMonth of [NaN, 0, 13, 1.5]) {
      const result = companyFormSchema.safeParse({ ...valid, fiscalYearStartMonth });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(["fiscalYearStartMonth"]);
    }
  });
  it("requires the number emitted by valueAsNumber rather than an unconverted string", () => {
    expect(companyFormSchema.safeParse({ ...valid, fiscalYearStartMonth: "12" }).success).toBe(false);
  });
});
