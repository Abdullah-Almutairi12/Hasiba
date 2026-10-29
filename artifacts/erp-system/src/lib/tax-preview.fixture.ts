import type { TaxPreview } from "./tax-preview";

export const mk = (o: Partial<{ mode: string; status: string; registered: boolean; vat: number; total: number; token: string; exp: string; cat: string }> = {}): TaxPreview => ({
  context: { mode: o.mode ?? "legacy", status: o.status ?? "registered", registered: o.registered ?? true, priceIncludesVat: false, token: o.token ?? "ctx" },
  totals: { subtotal: 100, discount: 0, vat: o.vat ?? 15, total: o.total ?? 115, lines: [{ productId: 1, description: "قهوة", quantity: 1, unitPrice: 100, discountPct: 0, taxRate: 15, taxCategory: o.cat ?? "standard", lineSubtotal: 100, lineDiscount: 0, lineNet: 100, lineVat: o.vat ?? 15, lineTotal: o.total ?? 115 }] },
  previewToken: "pv-" + (o.token ?? "ctx"), expiresAt: o.exp ?? "2999-01-01T00:00:00Z",
});

