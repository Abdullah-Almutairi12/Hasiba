import { describe, expect, it } from "vitest";
import { invoiceReturnBudgets, operationalReturnTotals } from "./sales-return-value";

const source = (id = 1, quantity = "1.0000", unitPrice = "10.0000", taxRate = "0.00") =>
  ({ id, quantity, unitPrice, taxRate, discountPct: "0.00" });
const input = (invoiceLineId = 1, quantity = 1) =>
  ({ invoiceLineId, productId: 1, description: "أصل تاريخي", quantity, unitPrice: 999, taxRate: 99 });

describe("historical invoice net return budgets", () => {
  it("returns the discounted nine, never the undiscounted ten or client price/tax", () => {
    const budgets = invoiceReturnBudgets({ total: "9.00", vat: "0.00" }, [source()]);
    const result = operationalReturnTotals([input()], budgets, new Map());
    expect(result).toMatchObject({ subtotal: 9, vat: 0, total: 9 });
    expect(result.lines[0]).toMatchObject({ unitPrice: 9, taxRate: 0, lineTotal: 9 });
  });
  it("preserves the original net and mixed-rate VAT cents over all lines", () => {
    const budgets = invoiceReturnBudgets({ total: "19.35", vat: "1.35" },
      [source(1), source(2, "1.0000", "10.0000", "15.00")]);
    const result = operationalReturnTotals([input(1), input(2)], budgets, new Map());
    expect(result).toMatchObject({ subtotal: 18, vat: 1.35, total: 19.35 });
    expect(result.lines.map(l => l.lineTotal)).toEqual([9, 10.35]);
  });
  it("allocates a rounding cent cumulatively without multiplying it across partial returns", () => {
    const budgets = invoiceReturnBudgets({ total: "0.01", vat: "0.00" }, [source(1, "3.0000", "0.0100")]);
    const slices = [0, 1, 2].map(q =>
      operationalReturnTotals([input()], budgets, new Map([[1, String(q)]])).total);
    expect(slices).toEqual([0, 0.01, 0]);
    expect(slices.reduce((a, b) => a + b, 0)).toBe(0.01);
    expect(() => operationalReturnTotals([input()], budgets, new Map([[1, "3"]]))).toThrow();
  });
  it("applies original line-level discount before allocating the original invoice header net", () => {
    const budgets = invoiceReturnBudgets({ total: "8.10", vat: "0.00" },
      [{ ...source(), discountPct: "10.00" }]);
    expect(operationalReturnTotals([input()], budgets, new Map()).total).toBe(8.1);
  });
  it("refuses unsupported financial source evidence rather than inventing extra credit", () => {
    expect(() => invoiceReturnBudgets({ total: "10.01", vat: "0" }, [source()])).toThrow();
    expect(() => invoiceReturnBudgets({ total: "1", vat: "2" }, [source()])).toThrow();
    expect(() => operationalReturnTotals([input(2)], invoiceReturnBudgets({ total: "9", vat: "0" }, [source()]), new Map())).toThrow();
  });
});
