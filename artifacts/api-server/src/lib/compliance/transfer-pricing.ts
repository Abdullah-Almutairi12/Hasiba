/**
 * Phase 3 — Transfer Pricing compliance check.
 *
 * Runs inside the same DB transaction as the intercompany mirror so
 * a finding is a side-effect of the same atomic write that creates
 * the source document. Per-line: compares the actual unit price to
 * `products.marketReferencePrice` (the external benchmark). When the
 * relative deviation exceeds ±15% (`THRESHOLD_RATIO`):
 *   1. Inserts a critical `compliance_alerts` row of kind
 *      `transfer_pricing` with the deviation percentage and the
 *      benchmark/actual prices in `details`.
 *   2. Checks the `intercompany_agreements` registry for an active
 *      master agreement covering the (source, target) pair on the
 *      transaction date. If none exists, inserts a paired
 *      `agreement_missing` alert — that is the "mandatory PDF
 *      attachment" rail. Finance can satisfy it later by uploading
 *      the agreement and re-running the check.
 *
 * The check is non-blocking: an alert is recorded but the mirror is
 * still committed. Blocking writes would silently break legacy
 * intercompany flows for tenants that have not yet populated their
 * benchmark catalogue.
 *
 * Tenant boundary: alerts are stamped with `companyId =
 * sourceCompanyId`; the counterparty row gets its own alert via the
 * mirror's own pass (this function is called from both sides).
 */

import { and, eq, lte, gte, or, isNull, inArray } from "drizzle-orm";
import {
  complianceAlertsTable,
  intercompanyAgreementsTable,
  productsTable,
  type InsertComplianceAlert,
} from "@workspace/db";
import type { Tx } from "../intercompany-mirror";

export const TRANSFER_PRICING_THRESHOLD_RATIO = 0.15;

export interface TransferPricingLine {
  /** Product the line refers to. NULL/undefined lines are skipped — no benchmark to compare against. */
  productId?: number | null;
  description: string | null;
  /** Unit price the line was actually invoiced at, in the source currency. */
  unitPrice: number;
  quantity: number;
}

export interface TransferPricingCheckInput {
  tx: Tx;
  sourceCompanyId: number;
  targetCompanyId: number;
  refType: "sales_invoice" | "purchase_order";
  refId: number;
  ref: string;
  /** Source-document date, used to check whether an agreement is in force. */
  refDate: Date;
  lines: TransferPricingLine[];
}

interface BenchmarkRow {
  id: number;
  nameAr: string;
  marketReferencePrice: string | null;
}

/**
 * Returns the inserted compliance_alerts ids (empty array when the
 * transaction was fully within the ±15% band, or when no line had a
 * benchmark set). Safe to call with `lines: []` — it short-circuits.
 */
export async function runTransferPricingCheck(
  input: TransferPricingCheckInput,
): Promise<number[]> {
  const productIds = Array.from(
    new Set(
      input.lines
        .map((l) => l.productId)
        .filter((id): id is number => typeof id === "number" && id > 0),
    ),
  );
  if (productIds.length === 0) return [];

  const benchmarks = await input.tx
    .select({
      id: productsTable.id,
      nameAr: productsTable.nameAr,
      marketReferencePrice: productsTable.marketReferencePrice,
    })
    .from(productsTable)
    .where(inArray(productsTable.id, productIds));

  const byId = new Map<number, BenchmarkRow>(
    benchmarks.map((b) => [b.id, b as BenchmarkRow]),
  );

  const alertsToInsert: InsertComplianceAlert[] = [];
  let worstDeviation = 0;

  for (const line of input.lines) {
    if (typeof line.productId !== "number") continue;
    const b = byId.get(line.productId);
    if (!b || b.marketReferencePrice === null) continue;
    const benchmark = Number(b.marketReferencePrice);
    if (!Number.isFinite(benchmark) || benchmark <= 0) continue;
    const actual = Number(line.unitPrice);
    if (!Number.isFinite(actual)) continue;
    const deviation = (actual - benchmark) / benchmark;
    if (Math.abs(deviation) <= TRANSFER_PRICING_THRESHOLD_RATIO) continue;

    worstDeviation = Math.max(worstDeviation, Math.abs(deviation));
    const direction = deviation > 0 ? "أعلى" : "أقل";
    alertsToInsert.push({
      companyId: input.sourceCompanyId,
      kind: "transfer_pricing",
      severity: "critical",
      refType: input.refType,
      refId: input.refId,
      ref: input.ref,
      counterpartyCompanyId: input.targetCompanyId,
      message: `سعر "${b.nameAr}" ${direction} من المعيار بنسبة ${(deviation * 100).toFixed(2)}٪ في ${input.ref}`,
      deviationPct: (deviation * 100).toFixed(4),
      details: {
        productId: b.id,
        productName: b.nameAr,
        lineDescription: line.description,
        benchmarkPrice: benchmark,
        actualPrice: actual,
        quantity: line.quantity,
        thresholdPct: TRANSFER_PRICING_THRESHOLD_RATIO * 100,
      },
    });
  }

  if (alertsToInsert.length === 0) return [];

  // Check for an active agreement covering this transaction date.
  // An agreement is "active" when isActive AND effectiveFrom <= refDate
  // AND (effectiveTo IS NULL OR effectiveTo >= refDate).
  const refDateStr = input.refDate.toISOString().slice(0, 10);
  const [agreement] = await input.tx
    .select({ id: intercompanyAgreementsTable.id })
    .from(intercompanyAgreementsTable)
    .where(
      and(
        eq(intercompanyAgreementsTable.companyId, input.sourceCompanyId),
        eq(
          intercompanyAgreementsTable.counterpartyCompanyId,
          input.targetCompanyId,
        ),
        eq(intercompanyAgreementsTable.isActive, true),
        lte(intercompanyAgreementsTable.effectiveFrom, refDateStr),
        or(
          isNull(intercompanyAgreementsTable.effectiveTo),
          gte(intercompanyAgreementsTable.effectiveTo, refDateStr),
        ),
      ),
    )
    .limit(1);

  if (!agreement) {
    alertsToInsert.push({
      companyId: input.sourceCompanyId,
      kind: "agreement_missing",
      severity: "critical",
      refType: input.refType,
      refId: input.refId,
      ref: input.ref,
      counterpartyCompanyId: input.targetCompanyId,
      message: `لا توجد اتفاقية بين الشركات سارية لتغطية ${input.ref} — مطلوب رفع PDF`,
      deviationPct: (worstDeviation * 100).toFixed(4),
      details: {
        refDate: refDateStr,
        worstDeviationPct: worstDeviation * 100,
        thresholdPct: TRANSFER_PRICING_THRESHOLD_RATIO * 100,
      },
    });
  }

  const inserted = await input.tx
    .insert(complianceAlertsTable)
    .values(alertsToInsert)
    .returning({ id: complianceAlertsTable.id });
  return inserted.map((r) => r.id);
}
