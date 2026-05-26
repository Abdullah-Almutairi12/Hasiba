import {
  db,
  companiesTable,
  customerInvoicesTable,
  customersTable,
  posOrdersTable,
} from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

/**
 * ZATCA SMB thresholds (SAR / rolling 12 months):
 *   - ≥ 375,000  → MANDATORY VAT registration
 *   - ≥ 187,500  → may register VOLUNTARILY
 *   - <  187,500 → cannot register
 */
export const VAT_MANDATORY_THRESHOLD_SAR = 375_000;
export const VAT_VOLUNTARY_THRESHOLD_SAR = 187_500;

export type VatRegistrationStatus = "registered" | "voluntary" | "not_registered";

export interface VatThresholdSnapshot {
  /** Persisted registration status. */
  status: VatRegistrationStatus;
  /** Rolling-12-month taxable sales (POS net + customer invoices net), SAR. */
  rolling12mSales: number;
  /** % of the mandatory threshold (0–∞). */
  percentOfMandatory: number;
  /** Crossed the 80% near-mandatory line — should consider registration. */
  near80: boolean;
  /** Crossed mandatory threshold — registration is legally required. */
  crossedMandatory: boolean;
  /** Eligible for voluntary registration (≥ 187.5K). */
  eligibleVoluntary: boolean;
  /** SAR remaining until mandatory threshold (≥ 0; 0 when crossed). */
  remainingToMandatory: number;
  /** Echo of the constants — included in the API response per OpenAPI. */
  mandatoryThreshold: number;
  voluntaryThreshold: number;
  /** UTC ISO timestamp of the calculation. */
  computedAt: string;
  vatNumber: string | null;
  vatRegistrationDate: string | null;
}

/**
 * Compute the rolling 12-month taxable sales for a single tenant by
 * summing (1) POS order totals net of POS tax line, and (2) issued
 * customer invoice subtotals (i.e. net of VAT). Returns 0 on a fresh
 * tenant with no sales history.
 */
export async function computeRolling12mSales(companyId: number): Promise<number> {
  const oneYearAgo = new Date();
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);

  const [posRow] = await db
    .select({
      net: sql<string>`COALESCE(SUM(${posOrdersTable.subtotal} - ${posOrdersTable.discount}), 0)::text`,
    })
    .from(posOrdersTable)
    .where(
      and(
        eq(posOrdersTable.companyId, companyId),
        gte(posOrdersTable.createdAt, oneYearAgo),
      ),
    );

  // customer_invoices has no direct companyId column. Scope through
  // customers.companyId (rather than branches) because manual invoices
  // are created with branchId=null and a branch-join would drop them.
  // Statuses to include match the AR lifecycle in lib/db/src/schema/sales.ts:
  // draft → open → (partially_paid | paid). `cancelled` is excluded.
  //
  // IMPORTANT: exclude `source='pos'` — every POS order already inserts
  // a mirrored customer_invoices row (see routes/pos.ts), so summing
  // both tables would double-count POS-origin revenue and trigger
  // premature 80%/100% threshold alerts.
  const [invRow] = await db
    .select({
      net: sql<string>`COALESCE(SUM(${customerInvoicesTable.subtotal} - ${customerInvoicesTable.discount}), 0)::text`,
    })
    .from(customerInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, customerInvoicesTable.customerId))
    .where(
      and(
        eq(customersTable.companyId, companyId),
        gte(customerInvoicesTable.createdAt, oneYearAgo),
        sql`${customerInvoicesTable.status} IN ('open','partially_paid','paid')`,
        sql`${customerInvoicesTable.source} <> 'pos'`,
      ),
    );

  const pos = Number(posRow?.net ?? "0");
  const inv = Number(invRow?.net ?? "0");
  return pos + inv;
}

/** Compute the full VAT threshold snapshot for a tenant. */
export async function getVatThresholdSnapshot(companyId: number): Promise<VatThresholdSnapshot> {
  const [company] = await db
    .select({
      vatRegistrationStatus: companiesTable.vatRegistrationStatus,
      vatNumber: companiesTable.vatNumber,
      vatRegistrationDate: companiesTable.vatRegistrationDate,
    })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);

  if (!company) {
    throw new Error(`vat-threshold: company #${companyId} not found`);
  }

  const sales = await computeRolling12mSales(companyId);
  const status = isVatStatus(company.vatRegistrationStatus)
    ? company.vatRegistrationStatus
    : "registered";

  return {
    status,
    rolling12mSales: round2(sales),
    percentOfMandatory: round2((sales / VAT_MANDATORY_THRESHOLD_SAR) * 100),
    near80: sales >= VAT_MANDATORY_THRESHOLD_SAR * 0.8,
    crossedMandatory: sales >= VAT_MANDATORY_THRESHOLD_SAR,
    eligibleVoluntary: sales >= VAT_VOLUNTARY_THRESHOLD_SAR,
    remainingToMandatory: Math.max(0, round2(VAT_MANDATORY_THRESHOLD_SAR - sales)),
    mandatoryThreshold: VAT_MANDATORY_THRESHOLD_SAR,
    voluntaryThreshold: VAT_VOLUNTARY_THRESHOLD_SAR,
    computedAt: new Date().toISOString(),
    vatNumber: company.vatNumber ?? null,
    vatRegistrationDate: company.vatRegistrationDate
      ? company.vatRegistrationDate.toISOString()
      : null,
  };
}

/** Returns true when the tenant is registered (mandatory OR voluntary). */
export function isVatEnabled(status: string | null | undefined): boolean {
  return status === "registered" || status === "voluntary";
}

function isVatStatus(v: string): v is VatRegistrationStatus {
  return v === "registered" || v === "voluntary" || v === "not_registered";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================
// Task #259 — VAT what-if simulator (pure, no DB access).
//
// Given a baseline rolling-12m sales number and a few owner-tunable
// knobs (monthly growth %, # of months to look ahead, optional one-off
// boost), project the rolling-12m total month-by-month and report when
// each threshold (voluntary 187.5K / mandatory 375K) will be crossed.
//
// We model "rolling 12m" as a moving window: each projected month
// REPLACES the oldest month of the baseline with `monthly * (1+g)^i`.
// Baseline monthly sales = rolling12mSales / 12 (uniform). This is the
// same heuristic ZATCA-themed planning spreadsheets use; it is
// intentionally optimistic on the upside (no churn) and pessimistic on
// stickiness (replaces full month, not partial). Documented in the UI.
//
// `cashImpactRate` (default 0.15) approximates the SAR amount the
// tenant will start owing in monthly net VAT once registered, computed
// as `projectedMonthlySales * rate * 0.5` (only ~half of expenses are
// VATable on net basis for an SMB) — surfaced so owners can see the
// cash-flow trade-off of voluntary early registration.
// ============================================================
export interface SimulationInput {
  baselineRolling12mSales: number;
  /** Monthly growth rate (decimal, e.g. 0.05 = +5% m/m). Default 0. */
  monthlyGrowthRate?: number;
  /** Number of future months to project (1-36). Default 12. */
  months?: number;
  /** One-off SAR added on month 1 (e.g. seasonal spike). Default 0. */
  oneOffBoost?: number;
  /** Approximate net-VAT-payable / sales ratio for cash impact. */
  cashImpactRate?: number;
  /**
   * "What if we register voluntarily today?" — affects net cash impact
   * calculations. When false, the simulator computes cash assuming the
   * shop only starts collecting/remitting VAT after the mandatory line
   * is crossed.
   */
  voluntaryRegistrationChoice?: boolean;
  /**
   * Planned price change (decimal, e.g. 0.05 = +5% across the board).
   * Applied multiplicatively on top of the monthly growth.
   */
  priceChangePct?: number;
}

export interface SimulationPoint {
  /** 1-indexed month offset from now. */
  month: number;
  /** Calendar month label (ISO YYYY-MM, end of month). */
  date: string;
  /** Projected rolling-12-month sales at end of this month (SAR). */
  rolling12mSales: number;
  /** % of mandatory threshold. */
  percentOfMandatory: number;
  /** Approx monthly VAT cash outflow once registered (SAR). */
  estimatedMonthlyVatCash: number;
  /** Output VAT collected on sales this month (SAR). */
  vatCollected: number;
  /** Input VAT paid on expenses this month (SAR). */
  vatPaid: number;
}

export interface SimulationResult {
  baselineRolling12mSales: number;
  monthlyGrowthRate: number;
  months: number;
  oneOffBoost: number;
  cashImpactRate: number;
  voluntaryRegistrationChoice: boolean;
  priceChangePct: number;
  /** Month offset (1-based) when voluntary line is first crossed, or null. */
  voluntaryCrossedAtMonth: number | null;
  /** Month offset (1-based) when mandatory line is first crossed, or null. */
  mandatoryCrossedAtMonth: number | null;
  /** Calendar YYYY-MM when the voluntary line is first crossed, or null. */
  voluntaryCrossedDate: string | null;
  /** Calendar YYYY-MM when the mandatory line is first crossed, or null. */
  mandatoryCrossedDate: string | null;
  /**
   * Net SAR cash delta of registering voluntarily today vs waiting for
   * the mandatory crossing: sum over (vatCollected − vatPaid) for all
   * months BEFORE the mandatory line. Positive = you would remit MORE
   * cash by registering early; negative = you would NET RECOVER input
   * VAT by registering early.
   */
  netCashRegisterEarly: number;
  /** Per-month projected snapshot. */
  trajectory: SimulationPoint[];
  /** Echo of the constants for client-side rendering. */
  mandatoryThreshold: number;
  voluntaryThreshold: number;
}

// Saudi standard VAT rate.
const VAT_RATE = 0.15;
// SMB heuristic: ~half of monthly revenue is VATable input expenses on
// a net basis. Tuned to match ZATCA's own SMB planning spreadsheet.
const INPUT_VAT_EXPENSE_RATIO = 0.5;

export function simulateVatTrajectory(input: SimulationInput): SimulationResult {
  const baseline = Math.max(0, Number(input.baselineRolling12mSales) || 0);
  const growth = clamp(Number(input.monthlyGrowthRate) || 0, -0.5, 1);
  const months = Math.min(36, Math.max(1, Math.floor(input.months ?? 12)));
  const boost = Math.max(0, Number(input.oneOffBoost) || 0);
  const cashRate = clamp(Number(input.cashImpactRate ?? 0.15), 0, 1);
  const voluntaryChoice = Boolean(input.voluntaryRegistrationChoice ?? false);
  const priceChange = clamp(Number(input.priceChangePct) || 0, -0.5, 1);

  // Baseline uniform monthly slice.
  const baselineMonthly = baseline / 12;

  let voluntaryAt: number | null = null;
  let mandatoryAt: number | null = null;
  const trajectory: SimulationPoint[] = [];

  // True 12-month rolling window: seed it with the baseline uniform
  // months, then each iteration push the new projected month and shift
  // the oldest entry off. This stays correct beyond month 12 (where
  // the original baseline slices are fully gone and the window is
  // entirely composed of projected months).
  const window: number[] = Array.from({ length: 12 }, () => baselineMonthly);
  // Calendar anchor: month 1 == next calendar month from "now".
  const anchor = new Date();
  anchor.setUTCDate(1);

  for (let m = 1; m <= months; m++) {
    // Apply growth + flat price-change uplift on top of baseline slice.
    const projectedMonth =
      baselineMonthly * Math.pow(1 + growth, m) * (1 + priceChange) +
      (m === 1 ? boost : 0);
    window.push(projectedMonth);
    window.shift();
    const running = window.reduce((s, v) => s + v, 0);
    // Guard against negative growth dragging below zero.
    const rolling = Math.max(0, round2(running));
    const pct = round2((rolling / VAT_MANDATORY_THRESHOLD_SAR) * 100);

    if (voluntaryAt === null && rolling >= VAT_VOLUNTARY_THRESHOLD_SAR) {
      voluntaryAt = m;
    }
    if (mandatoryAt === null && rolling >= VAT_MANDATORY_THRESHOLD_SAR) {
      mandatoryAt = m;
    }

    const vatCollected = round2(projectedMonth * VAT_RATE);
    const vatPaid = round2(projectedMonth * INPUT_VAT_EXPENSE_RATIO * VAT_RATE);
    const monthDate = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + m, 1),
    );

    trajectory.push({
      month: m,
      date: `${monthDate.getUTCFullYear()}-${String(
        monthDate.getUTCMonth() + 1,
      ).padStart(2, "0")}`,
      rolling12mSales: rolling,
      percentOfMandatory: pct,
      estimatedMonthlyVatCash: round2(projectedMonth * cashRate * 0.5),
      vatCollected,
      vatPaid,
    });
  }

  // Net cash delta of registering EARLY (today) vs WAITING for the
  // mandatory crossing. We sum (collected − paid) for months that fall
  // strictly before the mandatory line. When the user chose NOT to
  // voluntarily register, the early scenario is moot and the delta is 0.
  const cutoff = mandatoryAt ?? months + 1;
  const earlyWindow = voluntaryChoice
    ? trajectory.filter((p) => p.month < cutoff)
    : [];
  const netCashRegisterEarly = round2(
    earlyWindow.reduce((s, p) => s + (p.vatCollected - p.vatPaid), 0),
  );

  return {
    baselineRolling12mSales: round2(baseline),
    monthlyGrowthRate: growth,
    months,
    oneOffBoost: round2(boost),
    cashImpactRate: cashRate,
    voluntaryRegistrationChoice: voluntaryChoice,
    priceChangePct: priceChange,
    voluntaryCrossedAtMonth: voluntaryAt,
    mandatoryCrossedAtMonth: mandatoryAt,
    voluntaryCrossedDate:
      voluntaryAt !== null ? trajectory[voluntaryAt - 1]!.date : null,
    mandatoryCrossedDate:
      mandatoryAt !== null ? trajectory[mandatoryAt - 1]!.date : null,
    netCashRegisterEarly,
    trajectory,
    mandatoryThreshold: VAT_MANDATORY_THRESHOLD_SAR,
    voluntaryThreshold: VAT_VOLUNTARY_THRESHOLD_SAR,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
