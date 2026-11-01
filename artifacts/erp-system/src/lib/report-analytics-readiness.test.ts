import { describe, expect, it } from "vitest";
import { verifiedReportAnalytics } from "./report-analytics-readiness";

describe("report analytics must not display old samples as company facts", () => {
  const verified = { data: { dataSource: "verified-tenant-data" } };
  it("rejects the old cached summary, fixed profit and invented alerts", () => {
    expect(verifiedReportAnalytics([
      { data: { summary: "illustration" } }, { data: { netProfitToday: 12450 } },
      { data: [{ type: "illustrative alert", amount: 234.5 }] },
    ])).toBe(false);
  });
  it("does not interpret missing or failed data as zero", () => {
    expect(verifiedReportAnalytics([verified, { data: undefined }, verified])).toBe(false);
    expect(verifiedReportAnalytics([verified, { ...verified, isError: true }, verified])).toBe(false);
  });
  it("requires all three responses to carry verified provenance", () => {
    expect(verifiedReportAnalytics([verified, verified, { data: { dataSource: "example" } }])).toBe(false);
    expect(verifiedReportAnalytics([])).toBe(false);
  });
  it("recognizes the provenance contract, not a current implemented service", () => {
    // All three HTTP services currently return 503; this is only a predicate test.
    expect(verifiedReportAnalytics([verified, verified, verified])).toBe(true);
  });
});
