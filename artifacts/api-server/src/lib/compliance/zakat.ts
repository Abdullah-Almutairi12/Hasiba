/**
 * Phase 3 — Zakat compliance check.
 *
 * Saudi Zakat is levied on the company's adjusted equity (loosely:
 * equity + long-term liabilities − non-current assets). Large open
 * intercompany receivables can both inflate the assessable base
 * (receivable counts as a current asset on the lender's books) and
 * understate it on the borrower's (liability reduces the base).
 * Either way, a sustained intercompany imbalance is a known audit
 * flag for the Saudi tax authority.
 *
 * This check is intentionally simple — it aggregates net open
 * intercompany amounts per counterparty for `companyId` and raises
 * a `zakat` alert when the absolute exposure crosses
 * `ZAKAT_EXPOSURE_THRESHOLD_SAR`. It is idempotent within a 24h
 * window: a follow-up run does not duplicate an existing open alert
 * for the same (companyId, counterpartyCompanyId) pair.
 *
 * The threshold is conservative on purpose so single-company tenants
 * with no real intercompany activity do not see any zakat noise.
 */

import { and, eq, sql, isNotNull } from "drizzle-orm";
import {
  complianceAlertsTable,
  intercompanyImbalancesTable,
  companiesTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { logger } from "../logger";

export const ZAKAT_EXPOSURE_THRESHOLD_SAR = 100_000;

interface ExposureRow {
  counterpartyCompanyId: number;
  counterpartyName: string;
  netOpenAmount: number;
}

/**
 * Sums open intercompany imbalances (basis='open') per counterparty
 * for the given company. The sign of `difference` is preserved so a
 * net receivable (positive) is distinguishable from a net payable
 * (negative) in the alert details.
 */
async function getCounterpartyExposures(
  companyId: number,
): Promise<ExposureRow[]> {
  const rows = await db
    .select({
      counterpartyCompanyId: intercompanyImbalancesTable.targetCompanyId,
      counterpartyName: companiesTable.name,
      netOpenAmount: sql<string>`SUM(${intercompanyImbalancesTable.difference})`,
    })
    .from(intercompanyImbalancesTable)
    .innerJoin(
      companiesTable,
      eq(companiesTable.id, intercompanyImbalancesTable.targetCompanyId),
    )
    .where(
      and(
        eq(intercompanyImbalancesTable.sourceCompanyId, companyId),
        eq(intercompanyImbalancesTable.status, "open"),
        eq(intercompanyImbalancesTable.basis, "open"),
        isNotNull(intercompanyImbalancesTable.difference),
      ),
    )
    .groupBy(
      intercompanyImbalancesTable.targetCompanyId,
      companiesTable.name,
    );
  return rows.map((r) => ({
    counterpartyCompanyId: r.counterpartyCompanyId,
    counterpartyName: r.counterpartyName,
    netOpenAmount: Number(r.netOpenAmount ?? 0),
  }));
}

export interface ZakatCheckResult {
  companyId: number;
  alertsCreated: number;
  exposuresChecked: number;
}

/**
 * Idempotent zakat scan for one company. Returns counts for logging /
 * cron observability.
 */
export async function runZakatComplianceCheck(
  companyId: number,
): Promise<ZakatCheckResult> {
  const exposures = await getCounterpartyExposures(companyId);
  let created = 0;
  for (const exp of exposures) {
    if (Math.abs(exp.netOpenAmount) < ZAKAT_EXPOSURE_THRESHOLD_SAR) continue;

    // Skip if there's already an open zakat alert for this pair —
    // prevents the daily cron from spamming the same finding.
    const [existing] = await db
      .select({ id: complianceAlertsTable.id })
      .from(complianceAlertsTable)
      .where(
        and(
          eq(complianceAlertsTable.companyId, companyId),
          eq(complianceAlertsTable.kind, "zakat"),
          eq(complianceAlertsTable.status, "open"),
          eq(
            complianceAlertsTable.counterpartyCompanyId,
            exp.counterpartyCompanyId,
          ),
        ),
      )
      .limit(1);
    if (existing) continue;

    const direction = exp.netOpenAmount >= 0 ? "مستحقات" : "مستحقات عليها";
    // Idempotency: the partial unique index
    // `compliance_alerts_zakat_open_uniq` enforces at most one OPEN
    // zakat alert per (company, counterparty) pair. `onConflictDoNothing`
    // turns a concurrent insert into a no-op instead of a hard error.
    const inserted = await db
      .insert(complianceAlertsTable)
      .values({
        companyId,
        kind: "zakat",
        severity: "warning",
        refType: "intercompany_exposure",
        refId: exp.counterpartyCompanyId,
        ref: exp.counterpartyName,
        counterpartyCompanyId: exp.counterpartyCompanyId,
        message: `${direction} مفتوحة بقيمة ${Math.abs(exp.netOpenAmount).toFixed(2)} مع ${exp.counterpartyName} — قد تؤثر على وعاء الزكاة`,
        details: {
          netOpenAmount: exp.netOpenAmount,
          thresholdSar: ZAKAT_EXPOSURE_THRESHOLD_SAR,
          counterpartyName: exp.counterpartyName,
        },
      })
      .onConflictDoNothing()
      .returning({ id: complianceAlertsTable.id });
    if (inserted.length > 0) created++;
  }
  return {
    companyId,
    alertsCreated: created,
    exposuresChecked: exposures.length,
  };
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

async function tick(): Promise<void> {
  try {
    const companies = await db
      .select({ id: companiesTable.id })
      .from(companiesTable);
    for (const c of companies) {
      try {
        const r = await runZakatComplianceCheck(c.id);
        if (r.alertsCreated > 0) {
          logger.info(
            { ...r },
            "zakat compliance: alerts raised",
          );
        }
      } catch (err) {
        logger.warn({ err, companyId: c.id }, "zakat compliance: per-company tick failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "zakat compliance: tick failed");
  }
}

let started = false;
/** Daily zakat compliance scan across every tenant. */
export function startZakatComplianceCron(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), ONE_DAY_MS).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}
