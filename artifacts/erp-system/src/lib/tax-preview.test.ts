import { describe, expect, it } from "vitest";
import { diffPreviews, isExpired, lineCategory, stableKey, submitTokens } from "./tax-preview";
import { mk } from "./tax-preview.fixture";

describe("tax-preview helpers", () => {
  it("stableKey ignores key order", () => expect(stableKey({ a: 1, b: [{ y: 1, x: 2 }] })).toBe(stableKey({ b: [{ x: 2, y: 1 }], a: 1 })));
  it("legacy sends only the preview token; unified adds the context token", () => {
    expect(submitTokens(mk())).toEqual({ taxPreviewToken: "pv-ctx" });
    expect(submitTokens(mk({ mode: "unified", token: "u" }))).toEqual({ taxPreviewToken: "pv-u", taxContextToken: "u" });
    expect(submitTokens(null)).toEqual({});
  });
  it("expiry", () => { expect(isExpired(mk({ exp: "2000-01-01T00:00:00Z" }), Date.now())).toBe(true); expect(isExpired(mk({ exp: "bad" }), 0)).toBe(true); });
  it("categories incl. not_registered", () => {
    const p = mk({ cat: "exempt" }); expect(lineCategory(p, p.totals.lines[0])).toBe("exempt");
    const q = mk({ registered: false, status: "not_registered" }); expect(lineCategory(q, q.totals.lines[0])).toBe("not_registered");
  });
  it("diffs policy and totals but not tokens", () => {
    expect(diffPreviews(mk({ token: "a" }), mk({ token: "b" }))).toEqual([]);
    const d = diffPreviews(mk(), mk({ mode: "unified", vat: 0, total: 100, cat: "zero" })).map((x) => x.label);
    expect(d).toEqual(expect.arrayContaining(["نمط الضريبة", "الضريبة", "الإجمالي", "قهوة: الفئة"]));
  });
});
