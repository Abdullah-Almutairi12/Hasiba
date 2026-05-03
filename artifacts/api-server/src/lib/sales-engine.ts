import {
  db,
  pricelistsTable,
  pricelistItemsTable,
  productsTable,
  customersTable,
  discountRulesTable,
} from "@workspace/db";
import { and, eq, lte, gte, sql, desc, isNull, or } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

export type DbOrTx = typeof db | PgTransaction<any, any, any>;

const VAT_RATE_DEFAULT = 15;

/**
 * Resolve the unit price for a product on a given pricelist.
 *
 * Order of precedence:
 *  1. Explicit pricelist item (with quantity tier matching)
 *  2. Pricelist-wide percentage discount entry (productId IS NULL row)
 *  3. Product list price.
 */
export async function resolvePrice(
  tx: DbOrTx,
  args: { productId: number; pricelistId?: number | null; quantity: number },
): Promise<{ unitPrice: number; source: "pricelist" | "product" }> {
  const { productId, pricelistId, quantity } = args;
  const [product] = await tx
    .select({ price: productsTable.price })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  const listPrice = Number(product?.price ?? 0);

  if (!pricelistId) return { unitPrice: listPrice, source: "product" };

  const items = await tx
    .select()
    .from(pricelistItemsTable)
    .where(
      and(
        eq(pricelistItemsTable.pricelistId, pricelistId),
        or(
          eq(pricelistItemsTable.productId, productId),
          isNull(pricelistItemsTable.productId),
        ),
      ),
    );
  const productMatches = items
    .filter((i) => i.productId === productId && Number(i.minQuantity) <= quantity)
    .sort((a, b) => Number(b.minQuantity) - Number(a.minQuantity));
  if (productMatches[0]) {
    const m = productMatches[0];
    if (m.discountPct) {
      return {
        unitPrice: listPrice * (1 - Number(m.discountPct) / 100),
        source: "pricelist",
      };
    }
    return { unitPrice: Number(m.unitPrice), source: "pricelist" };
  }
  const wide = items.find((i) => i.productId === null && i.discountPct);
  if (wide && wide.discountPct) {
    return {
      unitPrice: listPrice * (1 - Number(wide.discountPct) / 100),
      source: "pricelist",
    };
  }
  return { unitPrice: listPrice, source: "product" };
}

/**
 * Generate a sequential reference like SO-2026-00001 / QUO- / DO- / INV- /
 * RCT- / CN-.
 */
export async function nextRef(
  tx: DbOrTx,
  prefix: string,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  // Postgres identifiers can't contain hyphens or other punctuation; sanitize
  // the prefix into a safe sequence name so callers can pass human-readable
  // reference prefixes like "POS-SO" without breaking sequence creation.
  const safe = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const seqName = `${safe}_seq_${year}`;
  await tx.execute(
    sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${seqName} MINVALUE 1 START 1`),
  );
  const r = await tx.execute(sql.raw(`SELECT nextval('${seqName}')::bigint AS n`));
  const rows = (r as unknown as { rows?: Array<{ n: string | number }> }).rows
    ?? (r as unknown as Array<{ n: string | number }>);
  const seq = Number(rows?.[0]?.n ?? 1);
  return `${prefix}-${year}-${String(seq).padStart(5, "0")}`;
}

/**
 * Compute totals for a list of (qty, unitPrice, discountPct, taxRate) lines.
 * Returns rounded totals to 2 decimals plus a per-line lineTotal (qty * unitPrice * (1-disc)).
 */
export interface SalesLineInput {
  productId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxRate?: number;
}

export interface ComputedLine extends SalesLineInput {
  discountPct: number;
  taxRate: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineNet: number;
  lineVat: number;
  lineTotal: number;
}

export interface ComputedTotals {
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  lines: ComputedLine[];
}

export function computeTotals(
  lines: SalesLineInput[],
  orderDiscount = 0,
): ComputedTotals {
  const computed: ComputedLine[] = lines.map((ln) => {
    const taxRate = ln.taxRate ?? VAT_RATE_DEFAULT;
    const discountPct = ln.discountPct ?? 0;
    const lineSubtotal = +(ln.quantity * ln.unitPrice).toFixed(2);
    const lineDiscount = +(lineSubtotal * (discountPct / 100)).toFixed(2);
    const lineNet = +(lineSubtotal - lineDiscount).toFixed(2);
    const lineVat = +(lineNet * (taxRate / 100)).toFixed(2);
    const lineTotal = +(lineNet + lineVat).toFixed(2);
    return {
      ...ln,
      discountPct,
      taxRate,
      lineSubtotal,
      lineDiscount,
      lineNet,
      lineVat,
      lineTotal,
    };
  });
  const subtotal = +computed.reduce((a, l) => a + l.lineSubtotal, 0).toFixed(2);
  const lineDiscountSum = +computed.reduce((a, l) => a + l.lineDiscount, 0).toFixed(2);
  const orderDisc = +Math.max(0, orderDiscount).toFixed(2);
  // Order-level discount is split proportionally before VAT.
  const netBeforeOrderDisc = subtotal - lineDiscountSum;
  const orderDiscApplied = Math.min(orderDisc, netBeforeOrderDisc);
  const netAfter = +(netBeforeOrderDisc - orderDiscApplied).toFixed(2);
  // Recompute VAT on net after order discount, prorated using each line's taxRate.
  let vat = 0;
  if (netBeforeOrderDisc > 0) {
    for (const ln of computed) {
      const share = ln.lineNet / netBeforeOrderDisc;
      const lineNetAfter = +(ln.lineNet - orderDiscApplied * share).toFixed(2);
      vat += +(lineNetAfter * (ln.taxRate / 100)).toFixed(2);
    }
  }
  vat = +vat.toFixed(2);
  const total = +(netAfter + vat).toFixed(2);
  return {
    subtotal,
    discount: +(lineDiscountSum + orderDiscApplied).toFixed(2),
    vat,
    total,
    lines: computed,
  };
}

/**
 * Resolve active order-level discount rules and aggregate them into a single
 * applied discount + a per-account breakdown. Pricing is invoked from the
 * SO/Quote/Invoice POSTs so reason codes feed the right GL bucket and so the
 * discount metadata stays consistent across the document lifecycle.
 *
 * - Percent rules apply against `baseNet` sequentially.
 * - Fixed rules subtract their absolute value (capped at 0).
 * - The total discount is split per-account so the JE can post each bucket
 *   separately (e.g. "loyalty" vs "promo" discount accounts).
 */
export interface AppliedDiscountRule {
  id: number;
  name: string;
  reasonCode: string;
  accountSystemKey: string;
  amount: number;
}
export async function applyDiscountRules(
  tx: DbOrTx,
  args: { baseNet: number; scope?: "line" | "order" },
): Promise<{
  discountAmount: number;
  applied: AppliedDiscountRule[];
}> {
  const scope = args.scope ?? "order";
  const rules = await tx
    .select()
    .from(discountRulesTable)
    .where(
      and(
        eq(discountRulesTable.isActive, true),
        eq(discountRulesTable.scope, scope),
      ),
    );
  let remaining = +args.baseNet.toFixed(2);
  const applied: AppliedDiscountRule[] = [];
  for (const r of rules) {
    if (remaining <= 0) break;
    let amt = 0;
    if (r.kind === "percent") {
      amt = +(remaining * (Number(r.value) / 100)).toFixed(2);
    } else {
      amt = Math.min(remaining, +Number(r.value).toFixed(2));
    }
    if (amt <= 0) continue;
    remaining = +(remaining - amt).toFixed(2);
    applied.push({
      id: r.id,
      name: r.name,
      reasonCode: r.reasonCode,
      accountSystemKey: r.accountSystemKey,
      amount: amt,
    });
  }
  const discountAmount = +applied.reduce((a, x) => a + x.amount, 0).toFixed(2);
  return { discountAmount, applied };
}

/**
 * Apply active line-scope discount rules in-place. Each rule reduces every
 * eligible line's net by its percent/fixed value and we bump that line's
 * `discountPct` so downstream `computeTotals` sees the new effective price.
 * Returns the per-rule aggregated amount so the invoice JE can post each
 * rule's discount to its configured GL account, just like order-scope rules.
 */
export async function applyLineDiscountRules(
  tx: DbOrTx,
  lines: SalesLineInput[],
): Promise<{ applied: AppliedDiscountRule[] }> {
  const rules = await tx
    .select()
    .from(discountRulesTable)
    .where(
      and(
        eq(discountRulesTable.isActive, true),
        eq(discountRulesTable.scope, "line"),
      ),
    );
  const agg = new Map<number, AppliedDiscountRule>();
  for (const rule of rules) {
    for (const ln of lines) {
      const baseDisc = ln.discountPct ?? 0;
      const lineSubtotal = ln.quantity * ln.unitPrice;
      if (lineSubtotal <= 0) continue;
      const lineNet = lineSubtotal * (1 - baseDisc / 100);
      let extra = 0;
      if (rule.kind === "percent") {
        extra = lineNet * (Number(rule.value) / 100);
      } else {
        extra = Math.min(lineNet, Number(rule.value));
      }
      extra = +extra.toFixed(2);
      if (extra <= 0) continue;
      const newNet = Math.max(0, lineNet - extra);
      ln.discountPct = +((1 - newNet / lineSubtotal) * 100).toFixed(4);
      const cur = agg.get(rule.id) ?? {
        id: rule.id,
        name: rule.name,
        reasonCode: rule.reasonCode,
        accountSystemKey: rule.accountSystemKey,
        amount: 0,
      };
      cur.amount = +(cur.amount + extra).toFixed(2);
      agg.set(rule.id, cur);
    }
  }
  return { applied: [...agg.values()] };
}

/**
 * Pick the pricelist that should apply to a customer.
 * Priority: customer.defaultPricelistId → first active pricelist matching segment → default.
 */
export async function resolveCustomerPricelist(
  tx: DbOrTx,
  customerId: number,
): Promise<number | null> {
  const [customer] = await tx
    .select()
    .from(customersTable)
    .where(eq(customersTable.id, customerId))
    .limit(1);
  if (!customer) return null;
  if (customer.defaultPricelistId) return customer.defaultPricelistId;
  const today = new Date().toISOString().slice(0, 10);
  const [bySegment] = await tx
    .select({ id: pricelistsTable.id })
    .from(pricelistsTable)
    .where(
      and(
        eq(pricelistsTable.isActive, true),
        eq(pricelistsTable.segment, customer.segment ?? "retail"),
        or(
          isNull(pricelistsTable.startDate),
          lte(pricelistsTable.startDate, today),
        ),
        or(
          isNull(pricelistsTable.endDate),
          gte(pricelistsTable.endDate, today),
        ),
      ),
    )
    .orderBy(desc(pricelistsTable.isDefault))
    .limit(1);
  if (bySegment) return bySegment.id;
  const [def] = await tx
    .select({ id: pricelistsTable.id })
    .from(pricelistsTable)
    .where(eq(pricelistsTable.isDefault, true))
    .limit(1);
  return def?.id ?? null;
}
