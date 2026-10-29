// Trusted server tax preview helpers. The browser never computes unified tax;
// it only binds a server quote to the exact request it was computed for.
import { previewPosTax as genPreviewPosTax, previewDirectInvoiceTax as genPreviewInvoiceTax, type PreviewPosTaxBody, type PreviewDirectInvoiceTaxBody } from "@workspace/api-client-react";

export type TaxCategory = "standard" | "zero" | "exempt" | "not_registered";
export type TaxPreviewLine = {
  productId: number | null;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  discountPct: number | string;
  taxRate: number | string;
  taxCategory?: string | null;
  lineSubtotal: number | string;
  lineDiscount: number | string;
  lineNet: number | string;
  lineVat: number | string;
  lineTotal: number | string;
};
export type TaxPreviewContext = {
  mode: "unified" | "legacy" | string;
  status: string;
  registered: boolean;
  priceIncludesVat: boolean;
  token: string;
  revision?: number;
  effectiveFrom?: string | null;
  [k: string]: unknown;
};
export type TaxPreview = {
  context: TaxPreviewContext;
  totals: { subtotal: number | string; discount: number | string; vat: number | string; total: number | string; lines: TaxPreviewLine[] };
  previewToken: string;
  expiresAt: string;
};

export type PosTaxPreviewBody = { sessionId: number; items: Array<{ productId: number; quantity: number }>; discount?: number };
export type DirectInvoicePreviewBody = { customerId: number; branchId?: number; invoiceDate?: string; orderDiscount?: number; lines: unknown[] };

export const previewPosTax = async (body: PosTaxPreviewBody) => (await genPreviewPosTax(body as PreviewPosTaxBody)) as unknown as TaxPreview;
export const previewDirectInvoiceTax = async (body: DirectInvoicePreviewBody) => (await genPreviewInvoiceTax(body as unknown as PreviewDirectInvoiceTaxBody)) as unknown as TaxPreview;

/** Deterministic key: object keys sorted so equal bodies always match. */
export function stableKey(value: unknown): string {
  const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
    : v;
  return JSON.stringify(norm(value));
}

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Facts a cashier reviews: context identity + server amounts (no tokens, no expiry). */
export function factsOf(p: TaxPreview) {
  return {
    mode: p.context.mode, status: p.context.status, registered: p.context.registered,
    priceIncludesVat: p.context.priceIncludesVat, revision: p.context.revision ?? null, effectiveFrom: p.context.effectiveFrom ?? null,
    subtotal: n(p.totals.subtotal), discount: n(p.totals.discount), vat: n(p.totals.vat), total: n(p.totals.total),
    lines: p.totals.lines.map((l) => ({ productId: l.productId, quantity: n(l.quantity), unitPrice: n(l.unitPrice), taxRate: n(l.taxRate),
      category: lineCategory(p, l), lineNet: n(l.lineNet), lineVat: n(l.lineVat), lineTotal: n(l.lineTotal) })),
  };
}
export const factsKey = (p: TaxPreview) => stableKey(factsOf(p));

export function lineCategory(p: TaxPreview, l: TaxPreviewLine): TaxCategory {
  if (!p.context.registered || p.context.status === "not_registered") return "not_registered";
  const c = l.taxCategory;
  return c === "zero" || c === "exempt" ? c : "standard";
}
export const CATEGORY_LABEL: Record<TaxCategory, string> = {
  standard: "خاضع للنسبة الأساسية", zero: "نسبة صفرية", exempt: "معفى", not_registered: "منشأة غير مسجلة — بلا ضريبة",
};

export type PreviewDiff = { label: string; before: string; after: string };
const fmt = (v: unknown) => v === null || v === undefined ? "—" : typeof v === "boolean" ? (v ? "نعم" : "لا") : typeof v === "number" ? v.toFixed(2) : String(v);

/** Human-readable differences between a reviewed quote and a new one. */
export function diffPreviews(before: TaxPreview, after: TaxPreview): PreviewDiff[] {
  const a = factsOf(before), b = factsOf(after);
  const out: PreviewDiff[] = [];
  const fields: Array<[keyof typeof a, string]> = [
    ["mode", "نمط الضريبة"], ["status", "حالة التسجيل"], ["registered", "مسجلة"], ["priceIncludesVat", "الأسعار شاملة الضريبة"],
    ["revision", "نسخة السياسة"], ["effectiveFrom", "تاريخ السريان"], ["subtotal", "المجموع قبل الضريبة"], ["discount", "الخصم"],
    ["vat", "الضريبة"], ["total", "الإجمالي"],
  ];
  for (const [k, label] of fields) if (stableKey(a[k]) !== stableKey(b[k])) out.push({ label, before: fmt(a[k]), after: fmt(b[k]) });
  const max = Math.max(a.lines.length, b.lines.length);
  for (let i = 0; i < max; i++) {
    const x = a.lines[i], y = b.lines[i];
    if (stableKey(x) === stableKey(y)) continue;
    const name = after.totals.lines[i]?.description || before.totals.lines[i]?.description || `بند ${i + 1}`;
    if (x?.category !== y?.category) out.push({ label: `${name}: الفئة`, before: x ? CATEGORY_LABEL[x.category] : "—", after: y ? CATEGORY_LABEL[y.category] : "—" });
    if (x?.lineVat !== y?.lineVat) out.push({ label: `${name}: ضريبة البند`, before: fmt(x?.lineVat), after: fmt(y?.lineVat) });
    if (x?.lineTotal !== y?.lineTotal) out.push({ label: `${name}: إجمالي البند`, before: fmt(x?.lineTotal), after: fmt(y?.lineTotal) });
  }
  return out;
}

export function isExpired(p: TaxPreview, now: number): boolean {
  const t = Date.parse(p.expiresAt);
  return !Number.isFinite(t) || t <= now;
}

/** Tokens for a FRESH reviewed submission: preview token in every mode, context token only in unified. */
export function submitTokens(p: TaxPreview | null): { taxPreviewToken?: string; taxContextToken?: string } {
  if (!p) return {};
  return p.context.mode === "unified" ? { taxPreviewToken: p.previewToken, taxContextToken: p.context.token } : { taxPreviewToken: p.previewToken };
}

export function isTaxPreview(v: unknown): v is TaxPreview {
  const p = v as TaxPreview;
  return !!p && typeof p === "object" && !!p.context && typeof p.context.token === "string" && typeof p.previewToken === "string" &&
    typeof p.expiresAt === "string" && !!p.totals && Array.isArray(p.totals.lines);
}

/**
 * Server price basis per cart row (totals.lines[i].inputUnitPrice, before VAT
 * conversion). Returns null unless every line matches the cart row's product
 * at the same index and carries a finite price, so a stale or foreign quote
 * never relabels the cart.
 */
export function previewUnitPrices(preview: { totals: { lines?: unknown[] } } | null | undefined, productIds: number[]): number[] | null {
  const lines = preview?.totals.lines;
  if (!Array.isArray(lines) || lines.length !== productIds.length) return null;
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as { productId?: unknown; inputUnitPrice?: unknown } | null;
    const p = Number(l?.inputUnitPrice);
    if (!l || l.productId !== productIds[i] || l.inputUnitPrice == null || !Number.isFinite(p)) return null;
    out.push(p);
  }
  return out;
}
