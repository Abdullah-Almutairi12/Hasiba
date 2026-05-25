/**
 * Smart Multi-Currency Variance Analysis.
 *
 * When an intercompany imbalance fires, part of the difference may
 * simply be FX rate movement between the source document's issue
 * date and "now" (or the payment/settlement date). This helper
 * isolates the FX-attributable portion from the genuinely
 * operational portion so accountants can park the FX piece against
 * a Gain/Loss account instead of treating the whole gap as a
 * pricing error to chase down.
 *
 * Inputs are restricted to data the imbalance recorder already
 * carries (linkId, kind, source/target amounts) — the lookups
 * for currencies and dates happen here so callers don't need to
 * widen their joins.
 */

import {
  db,
  customerInvoicesTable,
  purchaseOrdersTable,
  salesOrdersTable,
  exchangeRatesTable,
  intercompanyLinksTable,
} from "@workspace/db";
import { and, desc, eq, lte } from "drizzle-orm";
import { logger } from "./logger";

export interface FxBreakdown {
  /** ISO currency code the source doc was issued in. */
  sourceCurrencyCode: string;
  /** Mirror/target currency, falls back to "SAR" when unknown. */
  targetCurrencyCode: string;
  /** Rate (sourceCurrency → SAR) at the source doc's date. */
  sourceExchangeRate: number;
  /** Rate (sourceCurrency → SAR) at "now". */
  currentExchangeRate: number;
  /**
   * sourceAmount × (currentRate − sourceRate), rounded to 4 decimals.
   * Positive = source-currency strengthened vs SAR (FX gain on
   * monetary asset / FX loss on monetary liability — accountant
   * decides direction at settle time).
   */
  fxVarianceAmount: number;
  /** Total observed difference minus FX-attributable portion. */
  operationalVarianceAmount: number;
}

interface LookupResult {
  currencyCode: string;
  /** Issue date in YYYY-MM-DD. */
  dateStr: string;
}

/**
 * Fetch the source doc's currency code and issue date for a given
 * intercompany link. Returns `null` when the document can't be
 * located (deleted, schema drift, unknown kind) — callers should
 * treat that as "no FX analysis possible" and skip silently.
 */
async function lookupSourceCurrencyAndDate(
  kind: string,
  sourceDocId: number,
): Promise<LookupResult | null> {
  if (kind === "sales_invoice") {
    const [row] = await db
      .select({
        currencyCode: customerInvoicesTable.currencyCode,
        invoiceDate: customerInvoicesTable.invoiceDate,
      })
      .from(customerInvoicesTable)
      .where(eq(customerInvoicesTable.id, sourceDocId))
      .limit(1);
    if (!row) return null;
    return {
      currencyCode: row.currencyCode ?? "SAR",
      dateStr: String(row.invoiceDate).slice(0, 10),
    };
  }
  if (kind === "purchase_order") {
    const [row] = await db
      .select({
        currencyCode: purchaseOrdersTable.currencyCode,
        orderDate: purchaseOrdersTable.orderDate,
      })
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.id, sourceDocId))
      .limit(1);
    if (!row) return null;
    return {
      currencyCode: row.currencyCode ?? "SAR",
      dateStr: String(row.orderDate).slice(0, 10),
    };
  }
  return null;
}

/**
 * Fetch the target/mirror doc's currency code for badge display.
 * Best-effort; returns "SAR" on miss so the UI can still render.
 */
async function lookupTargetCurrency(
  kind: string,
  targetDocId: number,
): Promise<string> {
  if (kind === "sales_invoice") {
    // Mirror is a supplier invoice — `invoices` table has no
    // currency column today, so we assume SAR (base currency).
    return "SAR";
  }
  if (kind === "purchase_order") {
    const [row] = await db
      .select({ currencyCode: salesOrdersTable.currencyCode })
      .from(salesOrdersTable)
      .where(eq(salesOrdersTable.id, targetDocId))
      .limit(1);
    return row?.currencyCode ?? "SAR";
  }
  return "SAR";
}

/**
 * Look up the active (currency → SAR) rate on a given calendar day,
 * falling back to the most recent rate dated on/before it. Returns
 * `null` when the FX table has no usable row — that's a legitimate
 * configuration state and must NOT crash imbalance recording.
 */
async function getRateOnOrBefore(
  currencyCode: string,
  dateStr: string,
): Promise<number | null> {
  if (currencyCode === "SAR") return 1;
  const [exact] = await db
    .select({ rate: exchangeRatesTable.rate })
    .from(exchangeRatesTable)
    .where(
      and(
        eq(exchangeRatesTable.fromCurrency, currencyCode),
        eq(exchangeRatesTable.toCurrency, "SAR"),
        eq(exchangeRatesTable.rateDate, dateStr),
      ),
    )
    .limit(1);
  if (exact) return Number(exact.rate);
  const [latest] = await db
    .select({ rate: exchangeRatesTable.rate })
    .from(exchangeRatesTable)
    .where(
      and(
        eq(exchangeRatesTable.fromCurrency, currencyCode),
        eq(exchangeRatesTable.toCurrency, "SAR"),
        lte(exchangeRatesTable.rateDate, dateStr),
      ),
    )
    .orderBy(desc(exchangeRatesTable.rateDate))
    .limit(1);
  return latest ? Number(latest.rate) : null;
}

/**
 * Pure helper that splits a total difference into the FX-attributable
 * portion (sourceAmount × Δrate) and the residual operational portion.
 * Exposed for unit tests + reuse by the settle endpoint.
 */
export function splitVariance(
  sourceAmount: number,
  totalDifference: number,
  sourceRate: number,
  currentRate: number,
): { fx: number; operational: number } {
  const fx = Number((sourceAmount * (currentRate - sourceRate)).toFixed(4));
  const operational = Number((totalDifference - fx).toFixed(4));
  return { fx, operational };
}

/**
 * Analyze the FX share of an intercompany imbalance. Returns `null`
 * when no FX analysis is possible (source doc in SAR, missing
 * exchange rate, unknown kind, deleted doc). Never throws — callers
 * can persist the result as-is.
 */
export async function analyzeFxVariance(input: {
  linkId: number;
  kind: string;
  sourceAmount: number;
  targetAmount: number;
  sourceDocId?: number;
}): Promise<FxBreakdown | null> {
  try {
    // sourceDocId may not be supplied by the caller — fall back to
    // the links table so this helper is usable from anywhere we have
    // a linkId.
    let sourceDocId = input.sourceDocId;
    if (sourceDocId === undefined) {
      const [link] = await db
        .select({ id: intercompanyLinksTable.sourceDocId })
        .from(intercompanyLinksTable)
        .where(eq(intercompanyLinksTable.id, input.linkId))
        .limit(1);
      if (!link) return null;
      sourceDocId = link.id;
    }
    const src = await lookupSourceCurrencyAndDate(input.kind, sourceDocId);
    if (!src) return null;
    if (src.currencyCode === "SAR") return null;

    const todayStr = new Date().toISOString().slice(0, 10);
    const [sourceRate, currentRate, targetCurrency] = await Promise.all([
      getRateOnOrBefore(src.currencyCode, src.dateStr),
      getRateOnOrBefore(src.currencyCode, todayStr),
      lookupTargetCurrency(input.kind, sourceDocId),
    ]);
    if (sourceRate === null || currentRate === null) return null;

    const totalDifference = Number(
      (input.sourceAmount - input.targetAmount).toFixed(4),
    );
    const { fx, operational } = splitVariance(
      input.sourceAmount,
      totalDifference,
      sourceRate,
      currentRate,
    );
    return {
      sourceCurrencyCode: src.currencyCode,
      targetCurrencyCode: targetCurrency,
      sourceExchangeRate: sourceRate,
      currentExchangeRate: currentRate,
      fxVarianceAmount: fx,
      operationalVarianceAmount: operational,
    };
  } catch (err) {
    logger.warn(
      { err, linkId: input.linkId, kind: input.kind },
      "analyzeFxVariance failed; persisting imbalance without FX breakdown",
    );
    return null;
  }
}
