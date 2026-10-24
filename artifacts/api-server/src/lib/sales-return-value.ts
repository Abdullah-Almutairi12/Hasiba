import { FinancialRequestError } from "./financial-transaction";
import type { ComputedTotals, SalesLineInput } from "./sales-engine";

type Money = string | number;
type InvoiceValue = { total: Money; vat: Money };
type SourceLine = {
  id: number; quantity: Money; unitPrice: Money; discountPct: Money; taxRate: Money;
};
export type ReturnValueBudget = {
  quantity: bigint; net: bigint; vat: bigint; total: bigint; taxRate: number;
};

function scaled(value: Money, digits: number): bigint {
  const text = typeof value === "number" ? value.toFixed(digits) : value;
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new FinancialRequestError("قيمة مصدر المرتجع غير صالحة", 409);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.slice(digits).replace(/0/g, "")) throw new FinancialRequestError("دقة مصدر المرتجع غير مدعومة", 409);
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.slice(0, digits).padEnd(digits, "0") || "0");
}
export const returnCents = (value: Money) => scaled(value, 2);
export const returnQuantityUnits = (value: Money) => scaled(value, 4);
const quantity = returnQuantityUnits;
export const returnMoney = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
const roundRatio = (n: bigint, d: bigint) => (n + d / 2n) / d;
const amount = (value: bigint, scale = 100) => {
  if (!Number.isSafeInteger(Number(value))) throw new FinancialRequestError("قيمة المرتجع تتجاوز الدقة المدعومة", 409);
  return Number(value) / scale;
};

/** Allocate the original issued cents, not today's prices or undiscounted line totals.
 * Stable largest-remainder allocation preserves the invoice net and VAT exactly.
 */
function distribute(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (!sum) {
    if (total) throw new FinancialRequestError("بيانات الفاتورة لا تكفي لتوزيع قيمة المرتجع", 409);
    return weights.map(() => 0n);
  }
  const result = weights.map(w => total * w / sum);
  const ranked = weights.map((w, i) => ({ i, remainder: total * w % sum }))
    .sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  const left = total - result.reduce((a, b) => a + b, 0n);
  for (let i = 0; i < Number(left); i++) result[ranked[i].i] += 1n;
  return result;
}

export function invoiceReturnBudgets(invoice: InvoiceValue, source: SourceLine[]): Map<number, ReturnValueBudget> {
  const lines = [...source].sort((a, b) => a.id - b.id);
  const vat = returnCents(invoice.vat), total = returnCents(invoice.total);
  if (vat > total) throw new FinancialRequestError("ضريبة المصدر تتجاوز إجمالي الفاتورة", 409);
  const weights = lines.map(l => {
    const grossNet = roundRatio(quantity(l.quantity) * scaled(l.unitPrice, 4), 1_000_000n);
    const discount = scaled(l.discountPct, 2);
    if (discount > 10_000n) throw new FinancialRequestError("خصم المصدر غير صالح", 409);
    return grossNet - roundRatio(grossNet * discount, 10_000n);
  });
  const net = total - vat;
  if (net > weights.reduce((a, b) => a + b, 0n)) {
    throw new FinancialRequestError("صافي الفاتورة لا يتوافق مع أدلة بنودها؛ يلزم مراجعة المصدر", 409);
  }
  const nets = distribute(net, weights);
  const vats = distribute(vat, nets.map((n, i) => n * scaled(lines[i].taxRate, 2)));
  return new Map(lines.map((l, i) => [l.id, {
    quantity: quantity(l.quantity), net: nets[i], vat: vats[i], total: nets[i] + vats[i],
    taxRate: vats[i] ? Number(l.taxRate) : 0,
  }]));
}

/** Quantity slices use cumulative cents: the last slice receives any rounding cent.
 * Prior quantities include unissued reservations, so concurrent drafts cannot over-credit.
 */
export function operationalReturnTotals(
  input: Array<SalesLineInput & { invoiceLineId?: number | null }>,
  budgets: Map<number, ReturnValueBudget>,
  priorQuantities: Map<number, Money>,
): ComputedTotals {
  const prior = new Map([...priorQuantities].map(([id, q]) => [id, quantity(q)]));
  let netSum = 0n, vatSum = 0n;
  const lines = input.map(l => {
    const budget = l.invoiceLineId == null ? null : budgets.get(l.invoiceLineId);
    if (!budget || !budget.quantity) throw new FinancialRequestError("يلزم بند مصدر صالح لكل بند مرتجع تشغيلي", 400);
    const q = quantity(l.quantity), before = prior.get(l.invoiceLineId!) ?? 0n, after = before + q;
    if (!q || Number(q) / 10_000 !== l.quantity || after > budget.quantity) {
      throw new FinancialRequestError("كمية المرتجع تتجاوز المتبقي أو دقة الكمية المدعومة", 409);
    }
    const net = roundRatio(budget.net * after, budget.quantity) - roundRatio(budget.net * before, budget.quantity);
    const vat = roundRatio(budget.vat * after, budget.quantity) - roundRatio(budget.vat * before, budget.quantity);
    prior.set(l.invoiceLineId!, after); netSum += net; vatSum += vat;
    return { ...l, discountPct: 0, taxRate: budget.taxRate,
      unitPrice: amount(roundRatio(net * 1_000_000n, q), 10_000),
      lineSubtotal: amount(net), lineDiscount: 0, lineNet: amount(net), lineVat: amount(vat), lineTotal: amount(net + vat) };
  });
  return { subtotal: amount(netSum), discount: 0, vat: amount(vatSum), total: amount(netSum + vatSum), lines };
}
