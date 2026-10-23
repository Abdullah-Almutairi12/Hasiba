import { describe, expect, it } from "vitest";
import { closingPrintLabel, payoutPrintKind } from "@/pages/returns";
import { fmtSupply } from "@/components/vat-return-card";

describe("phase 1 print scope", () => {
  it("prints requested electronic refunds as unexecuted requests, never cash requests or cancelled", () => {
    expect(payoutPrintKind({ status: "requested", method: "card" })).toBe("request");
    expect(payoutPrintKind({ status: "requested", method: "cash" })).toBeNull();
    expect(payoutPrintKind({ status: "cancelled", method: "card" })).toBeNull();
    expect(payoutPrintKind({ status: "external_confirmed", method: "card" })).toBe("voucher");
    expect(payoutPrintKind({ status: "paid", method: "cash" })).toBe("voucher");
  });
  it("labels saved closings by current approval state", () => {
    expect(closingPrintLabel("pending_approval")).toContain("بانتظار الاعتماد");
    expect(closingPrintLabel("approved")).toContain("معتمد");
    expect(closingPrintLabel("closed")).toBe("تقرير إغلاق الوردية");
  });
  it("shows exempt null as unavailable but keeps proven zero", () => {
    expect(fmtSupply(null)).toBe("غير متاح");
    expect(fmtSupply(undefined, true)).toBe("Not available");
    expect(fmtSupply(0)).not.toBe("غير متاح");
    expect(fmtSupply(0, true)).toBe("0.00");
  });
});
