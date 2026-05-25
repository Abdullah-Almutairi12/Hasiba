/**
 * Phase 2 — Intercompany Liquidity & Cash Flow Forecast.
 *
 * Two read-only views over the same tenant-scoped data:
 *   - {@link getCorporateLiquidity}: full predictive cash-flow model
 *     for finance/holding (45-day forecast + threshold warnings).
 *   - {@link getRetailLiquidity}: simplified per-branch Net Position
 *     (Cash on Hand − Pending Payables) for store managers.
 *
 * Forecasting mirrors the linear-regression + EWMA blend already used
 * by `ai-models.ts predictSalesNext7Days`, but trained on the daily
 * net cash movement (debit − credit on bank-linked GL accounts)
 * instead of POS sales.
 */

import {
  db,
  accountsTable,
  bankAccountsTable,
  branchesTable,
  intercompanyImbalancesTable,
  invoicesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  posOrdersTable,
  posSessionsTable,
  purchaseOrdersTable,
  warehousesTable,
  type Branch,
} from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

/** Statuses that represent supplier invoices still owed by the company. */
const PENDING_PAYABLE_STATUSES = [
  "pending",
  "needs_review",
  "approved",
  "overdue",
] as const;

/** Look-back window (days) used to train the linear-regression+EWMA model. */
const LOOKBACK_DAYS = 60;

/** Forecast horizon (days). Phase 2 requirement: 45 days. */
export const FORECAST_HORIZON_DAYS = 45;

/** Single-day cash drop ratio that triggers a "sharp drop" warning. */
export const SHARP_DROP_RATIO = 0.3;

/** Severity scale used by both modes. */
export type LiquiditySeverity = "info" | "warning" | "critical";

export interface LiquidityWarning {
  /** Stable machine code (e.g. "BALANCE_NEGATIVE", "SHARP_DROP"). */
  code: string;
  severity: LiquiditySeverity;
  /** Human-readable Arabic explanation. */
  message: string;
  /** Day offset (1..horizon) the warning first triggers, if applicable. */
  dayOffset?: number;
  /** Projected balance on the offending day, for UX context. */
  projectedBalance?: number;
}

export interface ForecastPoint {
  date: string; // ISO yyyy-mm-dd
  projectedBalance: number;
  projectedNet: number; // expected net cash movement that day
}

export interface CorporateLiquiditySnapshot {
  currency: "SAR";
  cashOnHand: number;
  pendingPayables: number;
  intercompanyOpenNet: number;
  netPosition: number;
  /** Average daily net cash movement over the last 60 days. */
  averageDailyNet: number;
  /** Forecast for the next 45 days, projectedBalance is cumulative. */
  forecast: ForecastPoint[];
  warnings: LiquidityWarning[];
}

export interface RetailBranchPosition {
  branchId: number;
  branchName: string;
  cashOnHand: number;
  pendingPayables: number;
  /** Portion of `pendingPayables` derived from supplier bills directly attributable to this branch (via PO → warehouse → branch). */
  attributedPayables: number;
  /** Portion of `pendingPayables` from the unattributable pool split evenly across active branches. */
  sharedPayables: number;
  netPosition: number;
  openSessions: number;
}

export interface RetailLiquiditySnapshot {
  currency: "SAR";
  totalCashOnHand: number;
  totalPendingPayables: number;
  /** Sum of supplier-bill amounts that could be traced to a specific branch. */
  attributedPayables: number;
  /** Pool of supplier-bill amounts that couldn't be traced and were split evenly across branches. */
  unattributedPayables: number;
  netPosition: number;
  branches: RetailBranchPosition[];
}

// ============== Statistical helpers (mirrors ai-models.ts) ==============

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, n) => s + n, 0) / arr.length;
}

function linearRegression(
  xs: number[],
  ys: number[],
): { a: number; b: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { a: ys[0] ?? 0, b: 0, r2: 0 };
  const xm = mean(xs);
  const ym = mean(ys);
  let num = 0;
  let den = 0;
  let tot = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - xm) * (ys[i]! - ym);
    den += (xs[i]! - xm) ** 2;
    tot += (ys[i]! - ym) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  const a = ym - b * xm;
  let res = 0;
  for (let i = 0; i < n; i++) {
    const yh = a + b * xs[i]!;
    res += (ys[i]! - yh) ** 2;
  }
  const r2 = tot === 0 ? 0 : Math.max(0, 1 - res / tot);
  return { a, b, r2 };
}

function ewma(values: number[], alpha = 0.3): number {
  if (values.length === 0) return 0;
  let s = values[0]!;
  for (let i = 1; i < values.length; i++) s = alpha * values[i]! + (1 - alpha) * s;
  return s;
}

// ============== Internal queries ==============

/**
 * GL account ids backing every active bank account in the system.
 *
 * Tenant boundary: `bank_accounts` has no `company_id` column, and the
 * underlying `accounts` chart is also global. The actual tenant filter
 * is enforced one layer up — every balance/movement query joins through
 * `journal_entries` and filters on `journal_entries.company_id`, so a
 * Company A posting on an account Company B also uses can never bleed
 * into Company B's total. Opening balances are deliberately NOT added
 * for the same reason: they are company-agnostic and would leak.
 */
async function getBankGlAccountIds(): Promise<number[]> {
  const rows = await db
    .select({ id: bankAccountsTable.glAccountId })
    .from(bankAccountsTable)
    .where(eq(bankAccountsTable.isActive, true));
  return rows.map((r) => r.id);
}

/** Today's total cash-on-hand on bank-backed GL accounts for the company. */
async function getCashOnHand(companyId: number): Promise<number> {
  const bankAccountIds = await getBankGlAccountIds();
  if (bankAccountIds.length === 0) return 0;

  // Opening balances on bank_accounts are company-agnostic; they
  // represent the GL opening, so we only count posted movements
  // belonging to this tenant. This matches how the trial-balance
  // report treats opening balance + movement.
  const [row] = await db
    .select({
      balance: sql<string>`coalesce(sum(${journalEntryLinesTable.debit}::numeric - ${journalEntryLinesTable.credit}::numeric), 0)`,
    })
    .from(journalEntryLinesTable)
    .innerJoin(
      journalEntriesTable,
      eq(journalEntryLinesTable.entryId, journalEntriesTable.id),
    )
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "posted"),
        inArray(journalEntryLinesTable.accountId, bankAccountIds),
      ),
    );
  return Number(row?.balance ?? 0);
}

/** Sum of unpaid supplier invoices for the company. */
async function getPendingPayables(companyId: number): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${invoicesTable.amount}::numeric), 0)`,
    })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.companyId, companyId),
        inArray(invoicesTable.status, [...PENDING_PAYABLE_STATUSES]),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * Net of open intercompany imbalances where this company is the source:
 * positive = sibling owes us, negative = we owe sibling.
 */
async function getIntercompanyOpenNet(companyId: number): Promise<number> {
  const [row] = await db
    .select({
      net: sql<string>`coalesce(sum(${intercompanyImbalancesTable.sourceAmount}::numeric - ${intercompanyImbalancesTable.targetAmount}::numeric), 0)`,
    })
    .from(intercompanyImbalancesTable)
    .where(
      and(
        eq(intercompanyImbalancesTable.sourceCompanyId, companyId),
        eq(intercompanyImbalancesTable.basis, "open"),
        eq(intercompanyImbalancesTable.status, "open"),
      ),
    );
  return Number(row?.net ?? 0);
}

/**
 * Daily net cash movement (debit − credit) on bank GL accounts for
 * this company over the last {@link LOOKBACK_DAYS} days. Missing days
 * are filled with 0 so the regression sees the true cadence.
 */
async function getDailyNetCashSeries(companyId: number): Promise<number[]> {
  const bankAccountIds = await getBankGlAccountIds();
  if (bankAccountIds.length === 0) return new Array(LOOKBACK_DAYS).fill(0);

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  since.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      day: sql<string>`${journalEntriesTable.entryDate}::text`,
      net: sql<string>`sum(${journalEntryLinesTable.debit}::numeric - ${journalEntryLinesTable.credit}::numeric)`,
    })
    .from(journalEntryLinesTable)
    .innerJoin(
      journalEntriesTable,
      eq(journalEntryLinesTable.entryId, journalEntriesTable.id),
    )
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "posted"),
        gte(journalEntriesTable.entryDate, since.toISOString().slice(0, 10)),
        inArray(journalEntryLinesTable.accountId, bankAccountIds),
      ),
    )
    .groupBy(journalEntriesTable.entryDate);

  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, Number(r.net));

  const series: number[] = [];
  for (let i = LOOKBACK_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    series.push(byDay.get(d.toISOString().slice(0, 10)) ?? 0);
  }
  return series;
}

// ============== Pure forecasting + warnings ==============

/**
 * Pure: project the next {@link FORECAST_HORIZON_DAYS} days of cash
 * balance given the historical series and current balance.
 *
 * Blends a linear-regression trend with an EWMA-smoothed level. Trend
 * is suppressed when R² is below 0.05 (avoids extrapolating noise).
 */
export function projectCashFlow(
  history: number[],
  startingBalance: number,
): ForecastPoint[] {
  const xs = history.map((_, i) => i);
  const fit = linearRegression(xs, history);
  const useTrend = fit.r2 >= 0.05;
  const level = ewma(history, 0.3);

  const out: ForecastPoint[] = [];
  let balance = startingBalance;
  for (let i = 1; i <= FORECAST_HORIZON_DAYS; i++) {
    const x = history.length + i;
    const trendVal = useTrend ? fit.a + fit.b * x : level;
    // 60/40 blend so the level (recent reality) dominates unless the
    // regression has a strong fit.
    const trendWeight = Math.max(0.2, Math.min(0.6, fit.r2 * 2));
    const predicted = trendWeight * trendVal + (1 - trendWeight) * level;
    balance += predicted;
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push({
      date: d.toISOString().slice(0, 10),
      projectedBalance: Math.round(balance * 100) / 100,
      projectedNet: Math.round(predicted * 100) / 100,
    });
  }
  return out;
}

/**
 * Pure: derive warnings from a projected cash-flow trajectory.
 *
 *   - BALANCE_NEGATIVE: projected balance crosses zero (critical).
 *   - LOW_BALANCE: projected balance dips below 10% of current
 *     pending payables (warning).
 *   - SHARP_DROP: single-day drop > 30% of the previous balance
 *     (warning).
 */
export function deriveWarnings(
  forecast: ForecastPoint[],
  startingBalance: number,
  pendingPayables: number,
): LiquidityWarning[] {
  const out: LiquidityWarning[] = [];
  const threshold = pendingPayables * 0.1;
  let prev = startingBalance;

  let negativeDay: ForecastPoint | undefined;
  let lowDay: ForecastPoint | undefined;
  let dropDay: ForecastPoint | undefined;

  for (let i = 0; i < forecast.length; i++) {
    const p = forecast[i]!;
    if (!negativeDay && p.projectedBalance < 0) negativeDay = p;
    if (!lowDay && p.projectedBalance >= 0 && p.projectedBalance < threshold) {
      lowDay = p;
    }
    if (!dropDay && prev > 0) {
      const drop = (prev - p.projectedBalance) / prev;
      if (drop >= SHARP_DROP_RATIO) dropDay = p;
    }
    prev = p.projectedBalance;
  }

  if (negativeDay) {
    out.push({
      code: "BALANCE_NEGATIVE",
      severity: "critical",
      message: `يُتوقع نفاد السيولة بحلول ${negativeDay.date}.`,
      dayOffset: forecast.indexOf(negativeDay) + 1,
      projectedBalance: negativeDay.projectedBalance,
    });
  } else if (lowDay) {
    out.push({
      code: "LOW_BALANCE",
      severity: "warning",
      message: `يُتوقع انخفاض الرصيد إلى ما دون 10% من المستحقات بحلول ${lowDay.date}.`,
      dayOffset: forecast.indexOf(lowDay) + 1,
      projectedBalance: lowDay.projectedBalance,
    });
  }
  if (dropDay) {
    out.push({
      code: "SHARP_DROP",
      severity: "warning",
      message: `انخفاض حاد متوقع (>30%) في ${dropDay.date}.`,
      dayOffset: forecast.indexOf(dropDay) + 1,
      projectedBalance: dropDay.projectedBalance,
    });
  }
  return out;
}

// ============== Public API ==============

/** Full corporate liquidity snapshot for the given tenant. */
export async function getCorporateLiquidity(
  companyId: number,
): Promise<CorporateLiquiditySnapshot> {
  const [cashOnHand, pendingPayables, intercompanyOpenNet, history] =
    await Promise.all([
      getCashOnHand(companyId),
      getPendingPayables(companyId),
      getIntercompanyOpenNet(companyId),
      getDailyNetCashSeries(companyId),
    ]);

  const netPosition = cashOnHand - pendingPayables + intercompanyOpenNet;
  const forecast = projectCashFlow(history, cashOnHand);
  const warnings = deriveWarnings(forecast, cashOnHand, pendingPayables);

  return {
    currency: "SAR",
    cashOnHand: Math.round(cashOnHand * 100) / 100,
    pendingPayables: Math.round(pendingPayables * 100) / 100,
    intercompanyOpenNet: Math.round(intercompanyOpenNet * 100) / 100,
    netPosition: Math.round(netPosition * 100) / 100,
    averageDailyNet: Math.round(mean(history) * 100) / 100,
    forecast,
    warnings,
  };
}

/**
 * Per-branch pending payables, derived by tracing each open supplier
 * invoice back to a branch through its purchase order's receiving
 * warehouse:
 *
 *   invoice → purchase_orders.warehouseId → warehouses.branchId
 *
 * Invoices with no `poId`, with a PO that has no warehouse, or whose
 * warehouse points at a branch not in the active list are returned in
 * the second element of the tuple as a single "unattributed" pool —
 * the caller decides how to distribute that pool.
 *
 * Returns `[attributedByBranch, unattributedAmount]`.
 */
async function getPayablesByBranch(
  companyId: number,
  activeBranchIds: number[],
): Promise<[Map<number, number>, number]> {
  const total = await getPendingPayables(companyId);
  if (total === 0) return [new Map(), 0];

  const rows = await db
    .select({
      branchId: warehousesTable.branchId,
      total: sql<string>`coalesce(sum(${invoicesTable.amount}::numeric), 0)`,
    })
    .from(invoicesTable)
    .innerJoin(
      purchaseOrdersTable,
      eq(invoicesTable.poId, purchaseOrdersTable.id),
    )
    .innerJoin(
      warehousesTable,
      eq(purchaseOrdersTable.warehouseId, warehousesTable.id),
    )
    .where(
      and(
        eq(invoicesTable.companyId, companyId),
        inArray(invoicesTable.status, [...PENDING_PAYABLE_STATUSES]),
      ),
    )
    .groupBy(warehousesTable.branchId);

  const attributed = new Map<number, number>();
  const activeSet = new Set(activeBranchIds);
  let attributedTotal = 0;
  for (const r of rows) {
    if (!activeSet.has(r.branchId)) continue;
    const amount = Number(r.total);
    if (amount === 0) continue;
    attributed.set(r.branchId, (attributed.get(r.branchId) ?? 0) + amount);
    attributedTotal += amount;
  }
  const unattributed = Math.max(0, total - attributedTotal);
  return [attributed, unattributed];
}

/**
 * Per-branch cash position derived from active POS sessions:
 *   cashOnHand(branch) = sum(opening_cash on open sessions)
 *                      + sum(pos_orders.total where payment_method='cash'
 *                            and session is open)
 *
 * Pending payables are now attributed per branch via the supplier
 * invoice → PO → receiving-warehouse → branch chain. Invoices that
 * can't be traced (no PO, or PO with no warehouse) fall into an
 * "unattributed" pool that is split evenly across active branches —
 * the same naive proxy used previously, but applied only to the
 * residual instead of the whole figure. Total payables in the
 * snapshot still match the corporate figure.
 */
export async function getRetailLiquidity(
  companyId: number,
): Promise<RetailLiquiditySnapshot> {
  const branches: Branch[] = await db
    .select()
    .from(branchesTable)
    .where(
      and(eq(branchesTable.companyId, companyId), eq(branchesTable.isActive, true)),
    );

  const branchIds = branches.map((b) => b.id);
  const pendingPayables = await getPendingPayables(companyId);
  if (branchIds.length === 0) {
    return {
      currency: "SAR",
      totalCashOnHand: 0,
      totalPendingPayables: Math.round(pendingPayables * 100) / 100,
      attributedPayables: 0,
      unattributedPayables: Math.round(pendingPayables * 100) / 100,
      netPosition: -Math.round(pendingPayables * 100) / 100,
      branches: [],
    };
  }

  const [payablesByBranch, unattributedPool] = await getPayablesByBranch(
    companyId,
    branchIds,
  );

  // Opening cash on currently-open sessions, by branch.
  const openingRows = await db
    .select({
      branchId: posSessionsTable.branchId,
      opening: sql<string>`coalesce(sum(${posSessionsTable.openingCash}::numeric), 0)`,
      sessions: sql<string>`count(*)`,
    })
    .from(posSessionsTable)
    .where(
      and(
        inArray(posSessionsTable.branchId, branchIds),
        eq(posSessionsTable.status, "open"),
      ),
    )
    .groupBy(posSessionsTable.branchId);

  // Cash inflows on those open sessions, by branch (joining orders →
  // session for the branch_id; tenant-scoped via posOrders.companyId).
  const cashRows = await db
    .select({
      branchId: posSessionsTable.branchId,
      cash: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
    })
    .from(posOrdersTable)
    .innerJoin(
      posSessionsTable,
      eq(posOrdersTable.sessionId, posSessionsTable.id),
    )
    .where(
      and(
        eq(posOrdersTable.companyId, companyId),
        eq(posOrdersTable.paymentMethod, "cash"),
        eq(posSessionsTable.status, "open"),
        inArray(posSessionsTable.branchId, branchIds),
      ),
    )
    .groupBy(posSessionsTable.branchId);

  const openingByBranch = new Map<number, { cash: number; sessions: number }>();
  for (const r of openingRows) {
    openingByBranch.set(r.branchId, {
      cash: Number(r.opening),
      sessions: Number(r.sessions),
    });
  }
  const cashByBranch = new Map<number, number>();
  for (const r of cashRows) cashByBranch.set(r.branchId, Number(r.cash));

  const sharedPerBranch = unattributedPool / branches.length;
  const rows: RetailBranchPosition[] = branches.map((b) => {
    const opening = openingByBranch.get(b.id) ?? { cash: 0, sessions: 0 };
    const cashOnHand = opening.cash + (cashByBranch.get(b.id) ?? 0);
    const attributed = payablesByBranch.get(b.id) ?? 0;
    const payables = attributed + sharedPerBranch;
    return {
      branchId: b.id,
      branchName: b.nameAr || b.name,
      cashOnHand: Math.round(cashOnHand * 100) / 100,
      pendingPayables: Math.round(payables * 100) / 100,
      attributedPayables: Math.round(attributed * 100) / 100,
      sharedPayables: Math.round(sharedPerBranch * 100) / 100,
      netPosition: Math.round((cashOnHand - payables) * 100) / 100,
      openSessions: opening.sessions,
    };
  });

  const totalCash = rows.reduce((s, r) => s + r.cashOnHand, 0);
  const attributedTotal = Array.from(payablesByBranch.values()).reduce(
    (s, n) => s + n,
    0,
  );
  return {
    currency: "SAR",
    totalCashOnHand: Math.round(totalCash * 100) / 100,
    totalPendingPayables: Math.round(pendingPayables * 100) / 100,
    attributedPayables: Math.round(attributedTotal * 100) / 100,
    unattributedPayables: Math.round(unattributedPool * 100) / 100,
    netPosition: Math.round((totalCash - pendingPayables) * 100) / 100,
    branches: rows,
  };
}
