import { describe, expect, it } from "vitest";
import { configuredWidths, docUrls, fmtDate } from "./print-docs";
import { statusTone } from "./returns/shared";
import { toPatch, fromProfile } from "@/components/company-settings-tab";

describe("print documents", () => {
  it("builds base-path URLs from saved IDs", () => {
    expect(docUrls.receipt(7, 58)).toMatch(/\/api\/pos\/orders\/7\/receipt\.pdf\?width=58$/);
    expect(docUrls.creditNote(3)).toMatch(/\/api\/sales\/credit-notes\/3\/pdf$/);
    expect(docUrls.refund(4)).toMatch(/\/api\/pos\/refunds\/4\/pdf$/);
    expect(docUrls.closing(5)).toMatch(/\/api\/pos\/sessions\/5\/closing\.pdf$/);
  });
  it("only allows configured thermal widths", () => {
    expect(configuredWidths([80])).toEqual([80]);
    expect(configuredWidths([58, 80, 112, "58"])).toEqual([80, 58]);
    expect(configuredWidths(undefined)).toEqual([]);
  });
  it("labels partially paid and requested honestly", () => {
    expect(statusTone("partially_paid").text).toBe("مدفوع جزئيًا");
    expect(statusTone("requested").text).toContain("لم يُرسل");
    expect(fmtDate("bad")).toBe("—");
    expect(fmtDate("2025-03-01T10:00:00Z")).not.toBe("—");
  });
  it("sends the legal profile contract with address object and revision", () => {
    const f = fromProfile({ companyId: 1, revision: 4, nameAr: "شركة", nameEn: "Co", vatNumber: "3", crNumber: "1",
      address: "x", addressFields: { city: "الرياض" }, phone: "", email: "", bankName: "", bankIban: "",
      termsAr: "", termsEn: "", logoObjectKey: null, receiptWidths: [58, 80] });
    const p = toPatch(4, f);
    expect(p).toMatchObject({ revision: 4, address: { city: "الرياض" }, receiptWidths: [58, 80], logoObjectKey: null });
    expect(toPatch(4, { ...f, wide58: false }).receiptWidths).toEqual([80]);
  });
});
