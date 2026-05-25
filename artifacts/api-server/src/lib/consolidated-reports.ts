/**
 * Multi-Company Phase 6 — Consolidated group reports.
 *
 * Aggregates P&L, Balance Sheet and Cash Flow across an arbitrary
 * subset of companies the caller has access to, and eliminates
 * intercompany sales-invoice pairs so revenue and AR (and the
 * matching expense and AP on the buyer side) are not double-counted.
 *
 * Design notes:
 *   - Calculator only — formatting and exporting live in their own modules
 *     (`report-exporters` / `routes/exports.ts`).
 *   - Reads ONLY posted journal entries to match the per-company reports.
 *   - Bypasses scopedDb deliberately: queries span multiple tenants and
 *     filter by `companyId IN (...)` explicitly.
 *   - Eliminates ONLY matched intercompany `sales_invoice` links whose
 *     BOTH endpoints live in the selected scope. PO/SO mirrors don't
 *     post to the ledger, so they are ignored.
 *   - Cash Flow is summed without eliminations: intercompany settlement
 *     is real cash leaving one bank and entering another.
 */

import {
  db,
  accountsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  intercompanyLinksTable,
  customerInvoicesTable,
  invoicesTable,
  companiesTable,
} from "@workspace/db";
import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";

// =====================================================================
// Public types
// =====================================================================

export interface CompanyAmount {
  companyId: number;
  companyName: string;
  amount: number;
}

export interface EliminationEntry {
  linkId: number;
  sourceCompanyId: number;
  sourceCompanyName: string;
  sourceRef: string;
  targetCompanyId: number;
  targetCompanyName: string;
  targetRef: string;
  /** Net amount removed on the consolidated line (always >= 0). */
  amount: number;
  /** Per-side amounts so the UI can show a mismatch. */
  sourceAmount: number;
  targetAmount: number;
  /** True when |sourceAmount - targetAmount| > 0.01. */
  imbalance: boolean;
}

/**
 * An intercompany_links row that points to a missing source or target
 * document (or company). Surfaced separately rather than silently
 * dropped so the user can resolve it via `/intercompany`.
 */
export interface InvalidReference {
  linkId: number;
  kind: string;
  status: string;
  reason:
    | "missing_source_doc"
    | "missing_target_doc"
    | "missing_source_company"
    | "missing_target_company";
  sourceCompanyId: number;
  sourceDocId: number;
  sourceRef: string;
  targetCompanyId: number;
  targetDocId: number;
  targetRef: string;
}

export interface ConsolidatedAccountRow {
  code: string;
  nameAr: string;
  type: string;
  /** Total across all selected companies BEFORE eliminations. */
  gross: number;
  /** Amount eliminated on this line type. 0 for accounts not touched. */
  eliminated: number;
  /** Net = gross - eliminated. */
  amount: number;
}

export interface ConsolidatedPL {
  scope: { companyIds: number[]; from: string | null; to: string | null };
  revenue: ConsolidatedAccountRow[];
  expenses: ConsolidatedAccountRow[];
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
  eliminations: EliminationEntry[];
  invalidReferences: InvalidReference[];
  totalRevenueEliminated: number;
  totalExpenseEliminated: number;
  /** |sum(source) - sum(target)| across eliminated pairs. > 0.01 -> imbalance. */
  imbalance: number;
  hasImbalance: boolean;
}

export interface ConsolidatedBS {
  scope: { companyIds: number[]; asOf: string | null };
  assets: ConsolidatedAccountRow[];
  liabilities: ConsolidatedAccountRow[];
  equity: ConsolidatedAccountRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netIncome: number;
  isBalanced: boolean;
  eliminations: EliminationEntry[];
  invalidReferences: InvalidReference[];
  totalArEliminated: number;
  totalApEliminated: number;
  imbalance: number;
  hasImbalance: boolean;
}

export interface ConsolidatedCF {
  scope: { companyIds: number[]; from: string | null; to: string | null };
  inflow: number;
  outflow: number;
  net: number;
  bySource: { source: string; inflow: number; outflow: number; net: number }[];
  byCompany: CompanyAmount[];
  /** Always empty — CF eliminations are intentionally out of scope. */
  eliminations: EliminationEntry[];
  invalidReferences: InvalidReference[];
}

// =====================================================================
// Internal helpers
// =====================================================================

interface AccountTotalsRow {
  accountId: number;
  code: string;
  nameAr: string;
  type: string;
  debit: number;
  credit: number;
}

/**
 * Pull posted JE-line totals per account across a set of companies in a
 * date window. Mirrors `postedAccountTotals` in `routes/exports.ts` but
 * scoped to multiple companies.
 */
async function postedAccountTotalsMulti(
  companyIds: number[],
  from?: string | null,
  to?: string | null,
): Promise<AccountTotalsRow[]> {
  if (companyIds.length === 0) return [];
  const wheres = [
    eq(journalEntriesTable.status, "posted"),
    inArray(journalEntriesTable.companyId, companyIds),
  ];
  if (from) wheres.push(gte(journalEntriesTable.entryDate, from));
  if (to) wheres.push(lte(journalEntriesTable.entryDate, to));
  const rows = await db
    .select({
      accountId: accountsTable.id,
      code: accountsTable.code,
      nameAr: accountsTable.nameAr,
      type: accountsTable.type,
      debit: sql<string>`coalesce(sum(${journalEntryLinesTable.baseDebit}::numeric),0)`,
      credit: sql<string>`coalesce(sum(${journalEntryLinesTable.baseCredit}::numeric),0)`,
    })
    .from(accountsTable)
    .innerJoin(
      journalEntryLinesTable,
      eq(journalEntryLinesTable.accountId, accountsTable.id),
    )
    .innerJoin(
      journalEntriesTable,
      eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
    )
    .where(and(...wheres))
    .groupBy(
      accountsTable.id,
      accountsTable.code,
      accountsTable.nameAr,
      accountsTable.type,
    );
  return rows.map((r) => ({
    accountId: r.accountId,
    code: r.code,
    nameAr: r.nameAr,
    type: r.type,
    debit: Number(r.debit),
    credit: Number(r.credit),
  }));
}

interface RawIntercompanyAmounts {
  linkId: number;
  sourceCompanyId: number;
  sourceCompanyName: string;
  sourceRef: string;
  targetCompanyId: number;
  targetCompanyName: string;
  targetRef: string;
  /** Source invoice subtotal (revenue side, excl. VAT). */
  sourceSubtotal: number;
  /** Source invoice total (AR side, face value). */
  sourceTotal: number;
  /** Source invoice still-outstanding AR (`total - amountPaid`, never < 0). */
  sourceOpen: number;
  /** Mirror supplier invoice subtotal (expense side). */
  targetSubtotal: number;
  /** Mirror supplier invoice total (AP side, face value). */
  targetTotal: number;
  /** Mirror supplier invoice still-outstanding AP. */
  targetOpen: number;
  /** Source invoiceDate — used to filter into the reporting window. */
  invoiceDate: string;
}

interface EliminationFetchResult {
  pairs: RawIntercompanyAmounts[];
  invalidReferences: InvalidReference[];
}

/**
 * Fetch every matched intercompany sales-invoice pair where BOTH sides
 * live inside the consolidation scope. Uses LEFT JOINs so links that
 * reference missing documents/companies are surfaced as
 * `invalidReferences` instead of being silently dropped.
 *
 * `windowFrom`/`windowTo` filter by the source invoice's invoice_date
 * (the natural P&L period boundary). For Balance Sheet we still want
 * outstanding AR/AP up to `asOf`, which is the only date passed in.
 */
async function fetchEliminationPairs(
  companyIds: number[],
  windowFrom?: string | null,
  windowTo?: string | null,
): Promise<EliminationFetchResult> {
  if (companyIds.length < 2) return { pairs: [], invalidReferences: [] };

  const srcInv = customerInvoicesTable;
  const tgtInv = invoicesTable;
  const srcCo = companiesTable;

  const rows = await db
    .select({
      linkId: intercompanyLinksTable.id,
      kind: intercompanyLinksTable.kind,
      linkStatus: intercompanyLinksTable.status,
      sourceCompanyId: intercompanyLinksTable.sourceCompanyId,
      sourceDocId: intercompanyLinksTable.sourceDocId,
      sourceRef: intercompanyLinksTable.sourceRef,
      targetCompanyId: intercompanyLinksTable.targetCompanyId,
      targetDocId: intercompanyLinksTable.targetDocId,
      targetRef: intercompanyLinksTable.targetRef,
      sourceSubtotal: srcInv.subtotal,
      sourceTotal: srcInv.total,
      sourceAmountPaid: srcInv.amountPaid,
      sourceStatus: srcInv.status,
      invoiceDate: srcInv.invoiceDate,
      targetAmount: tgtInv.amount,
      targetStatus: tgtInv.status,
      targetNotes: tgtInv.notes,
      sourceCompanyName: srcCo.name,
    })
    .from(intercompanyLinksTable)
    .leftJoin(srcInv, eq(srcInv.id, intercompanyLinksTable.sourceDocId))
    .leftJoin(tgtInv, eq(tgtInv.id, intercompanyLinksTable.targetDocId))
    .leftJoin(srcCo, eq(srcCo.id, intercompanyLinksTable.sourceCompanyId))
    .where(
      and(
        eq(intercompanyLinksTable.kind, "sales_invoice"),
        eq(intercompanyLinksTable.status, "matched"),
        inArray(intercompanyLinksTable.sourceCompanyId, companyIds),
        inArray(intercompanyLinksTable.targetCompanyId, companyIds),
      ),
    );

  // Resolve every target company name in one shot.
  const targetIds = Array.from(new Set(rows.map((r) => r.targetCompanyId)));
  const targetNames =
    targetIds.length === 0
      ? new Map<number, string>()
      : new Map(
          (
            await db
              .select({ id: companiesTable.id, name: companiesTable.name })
              .from(companiesTable)
              .where(inArray(companiesTable.id, targetIds))
          ).map((c) => [c.id, c.name]),
        );

  const pairs: RawIntercompanyAmounts[] = [];
  const invalidReferences: InvalidReference[] = [];

  for (const r of rows) {
    const baseInvalid = {
      linkId: r.linkId,
      kind: r.kind,
      status: r.linkStatus,
      sourceCompanyId: r.sourceCompanyId,
      sourceDocId: r.sourceDocId,
      sourceRef: r.sourceRef,
      targetCompanyId: r.targetCompanyId,
      targetDocId: r.targetDocId,
      targetRef: r.targetRef,
    };
    if (r.sourceCompanyName === null) {
      invalidReferences.push({ ...baseInvalid, reason: "missing_source_company" });
      continue;
    }
    if (!targetNames.has(r.targetCompanyId)) {
      invalidReferences.push({ ...baseInvalid, reason: "missing_target_company" });
      continue;
    }
    if (r.sourceTotal === null || r.invoiceDate === null) {
      invalidReferences.push({ ...baseInvalid, reason: "missing_source_doc" });
      continue;
    }
    if (r.targetAmount === null) {
      invalidReferences.push({ ...baseInvalid, reason: "missing_target_doc" });
      continue;
    }
    // Skip cancelled source/target invoices: there's nothing to eliminate.
    if (r.sourceStatus === "cancelled") continue;
    if (r.targetStatus === "cancelled" || r.targetStatus === "reversed") continue;
    if (windowFrom && r.invoiceDate < windowFrom) continue;
    if (windowTo && r.invoiceDate > windowTo) continue;

    // Mirror invoice stores subtotal/vat/total in the notes JSON blob.
    // Fall back to `amount` (= total) if parsing fails.
    let targetSubtotal = Number(r.targetAmount);
    const targetTotal = Number(r.targetAmount);
    if (r.targetNotes) {
      try {
        const parsed = JSON.parse(r.targetNotes) as { subtotal?: unknown };
        if (typeof parsed.subtotal === "number") {
          targetSubtotal = parsed.subtotal;
        } else if (typeof parsed.subtotal === "string") {
          const n = Number(parsed.subtotal);
          if (Number.isFinite(n)) targetSubtotal = n;
        }
      } catch {
        // notes wasn't JSON — keep the fallback.
      }
    }

    const sourceTotal = Number(r.sourceTotal);
    const sourceAmountPaid = Number(r.sourceAmountPaid ?? 0);
    const sourceOpen = Math.max(0, sourceTotal - sourceAmountPaid);
    // Supplier invoices don't track amountPaid; treat status='paid' as
    // fully settled, otherwise the full face value remains outstanding.
    // This is a conservative mirror of the source's open amount.
    const targetOpen = r.targetStatus === "paid" ? 0 : targetTotal;

    pairs.push({
      linkId: r.linkId,
      sourceCompanyId: r.sourceCompanyId,
      sourceCompanyName: r.sourceCompanyName,
      sourceRef: r.sourceRef,
      targetCompanyId: r.targetCompanyId,
      targetCompanyName: targetNames.get(r.targetCompanyId) ?? "—",
      targetRef: r.targetRef,
      sourceSubtotal: Number(r.sourceSubtotal),
      sourceTotal,
      sourceOpen,
      targetSubtotal,
      targetTotal,
      targetOpen,
      invoiceDate: r.invoiceDate,
    });
  }
  return { pairs, invalidReferences };
}

function buildEliminationEntries(
  pairs: RawIntercompanyAmounts[],
  mode: "subtotal" | "open",
): EliminationEntry[] {
  return pairs.map((p) => {
    const sourceAmount = mode === "subtotal" ? p.sourceSubtotal : p.sourceOpen;
    const targetAmount = mode === "subtotal" ? p.targetSubtotal : p.targetOpen;
    return {
      linkId: p.linkId,
      sourceCompanyId: p.sourceCompanyId,
      sourceCompanyName: p.sourceCompanyName,
      sourceRef: p.sourceRef,
      targetCompanyId: p.targetCompanyId,
      targetCompanyName: p.targetCompanyName,
      targetRef: p.targetRef,
      amount: Math.min(sourceAmount, targetAmount),
      sourceAmount,
      targetAmount,
      imbalance: Math.abs(sourceAmount - targetAmount) > 0.01,
    };
  });
}

function aggregateAccounts(
  totals: AccountTotalsRow[],
  filter: (t: AccountTotalsRow) => boolean,
  signedAmount: (t: AccountTotalsRow) => number,
): { code: string; nameAr: string; type: string; gross: number }[] {
  const map = new Map<string, { code: string; nameAr: string; type: string; gross: number }>();
  for (const t of totals) {
    if (!filter(t)) continue;
    const key = t.code;
    const v = signedAmount(t);
    const prev = map.get(key);
    if (prev) prev.gross += v;
    else map.set(key, { code: t.code, nameAr: t.nameAr, type: t.type, gross: v });
  }
  return Array.from(map.values())
    .filter((r) => Math.abs(r.gross) > 0.005)
    .sort((a, b) => a.code.localeCompare(b.code));
}

interface InvoiceLineTotal {
  accountCode: string;
  accountType: string;
  netDebit: number;
  netCredit: number;
}

/**
 * Pull per-account JE-line totals for a specific (company, reference)
 * pair. Used to drive *account-targeted* eliminations instead of
 * proportional spreading: we only zero-out the accounts actually
 * touched by the intercompany invoice's posting.
 *
 * Matches by `(journal_entries.reference = ref OR sourceRef = ref)`
 * limited to posted entries inside the company. `ref` covers both
 * the customer-invoice reference (source side) and the supplier
 * mirror's "INV-<n>" reference (target side).
 */
async function fetchInvoiceJournalLines(
  companyId: number,
  refs: string[],
): Promise<InvoiceLineTotal[]> {
  if (refs.length === 0) return [];
  const rows = await db
    .select({
      code: accountsTable.code,
      type: accountsTable.type,
      debit: sql<string>`coalesce(sum(${journalEntryLinesTable.baseDebit}::numeric),0)`,
      credit: sql<string>`coalesce(sum(${journalEntryLinesTable.baseCredit}::numeric),0)`,
    })
    .from(journalEntryLinesTable)
    .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
    .innerJoin(
      journalEntriesTable,
      eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
    )
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "posted"),
        sql`(${journalEntriesTable.reference} IN (${sql.join(
          refs.map((r) => sql`${r}`),
          sql`, `,
        )}) OR ${journalEntriesTable.sourceRef} IN (${sql.join(
          refs.map((r) => sql`${r}`),
          sql`, `,
        )}))`,
      ),
    )
    .groupBy(accountsTable.code, accountsTable.type);
  return rows.map((r) => ({
    accountCode: r.code,
    accountType: r.type,
    netDebit: Number(r.debit),
    netCredit: Number(r.credit),
  }));
}

interface AccountEliminationMap {
  /** account code → amount removed from that specific account row */
  byAccount: Map<string, number>;
  /** Sum across all entries — used for the totals/imbalance display. */
  total: number;
}

function emptyElimMap(): AccountEliminationMap {
  return { byAccount: new Map(), total: 0 };
}

function addToMap(m: AccountEliminationMap, code: string, amount: number) {
  if (amount <= 0.005) return;
  m.byAccount.set(code, (m.byAccount.get(code) ?? 0) + amount);
  m.total += amount;
}

/**
 * Walk every matched intercompany pair and compute *account-targeted*
 * eliminations by inspecting the actual JE lines posted for each
 * invoice. Returns four maps:
 *
 *   - revenue (source-side credit-debit on revenue accounts)
 *   - expense (target-side debit-credit on expense accounts; usually 0
 *     because the mirror posts to Inventory, not an expense account)
 *   - ar (source-side debit-credit on asset accounts, scaled by the
 *     still-open ratio so partial payments are honored)
 *   - ap (target-side credit-debit on liability accounts, scaled by
 *     the still-open ratio on the target side)
 */
async function buildPerAccountEliminations(
  pairs: RawIntercompanyAmounts[],
): Promise<{
  revenue: AccountEliminationMap;
  expense: AccountEliminationMap;
  ar: AccountEliminationMap;
  ap: AccountEliminationMap;
}> {
  const revenue = emptyElimMap();
  const expense = emptyElimMap();
  const ar = emptyElimMap();
  const ap = emptyElimMap();
  for (const p of pairs) {
    const srcLines = await fetchInvoiceJournalLines(p.sourceCompanyId, [p.sourceRef]);
    // The target JE posted by intercompany-mirror uses `INV-<targetRef>`
    // as its journal reference (see routes/invoices.ts createInvoice).
    // We try both shapes to stay resilient.
    const tgtLines = await fetchInvoiceJournalLines(p.targetCompanyId, [
      p.targetRef,
      `INV-${p.targetRef}`,
    ]);
    const openRatioSrc =
      p.sourceTotal > 0 ? Math.min(1, p.sourceOpen / p.sourceTotal) : 0;
    const openRatioTgt =
      p.targetTotal > 0 ? Math.min(1, p.targetOpen / p.targetTotal) : 0;
    for (const l of srcLines) {
      const rev = l.netCredit - l.netDebit;
      const asset = l.netDebit - l.netCredit;
      if (l.accountType === "revenue" && rev > 0) {
        addToMap(revenue, l.accountCode, rev);
      } else if (l.accountType === "asset" && asset > 0) {
        addToMap(ar, l.accountCode, asset * openRatioSrc);
      }
    }
    for (const l of tgtLines) {
      const exp = l.netDebit - l.netCredit;
      const liab = l.netCredit - l.netDebit;
      if (l.accountType === "expense" && exp > 0) {
        addToMap(expense, l.accountCode, exp);
      } else if (l.accountType === "liability" && liab > 0) {
        addToMap(ap, l.accountCode, liab * openRatioTgt);
      }
    }
  }
  return { revenue, expense, ar, ap };
}

// =====================================================================
// Public API
// =====================================================================

/**
 * Build a consolidated profit & loss for the selected companies.
 * Eliminates revenue (source) and expense (target) for every matched
 * intercompany sales-invoice pair whose date falls in the window.
 */
export async function generateConsolidatedPL(
  companyIds: number[],
  from?: string | null,
  to?: string | null,
): Promise<ConsolidatedPL> {
  const totals = await postedAccountTotalsMulti(companyIds, from, to);
  const { pairs, invalidReferences } = await fetchEliminationPairs(
    companyIds,
    from,
    to,
  );
  const eliminations = buildEliminationEntries(pairs, "subtotal");

  // Account-targeted eliminations: look up the actual revenue/expense
  // accounts the source/target JEs touched, instead of prorating
  // across every revenue/expense row.
  const perAccount = await buildPerAccountEliminations(pairs);
  const totalRevenueEliminated = perAccount.revenue.total;
  const totalExpenseEliminated = perAccount.expense.total;

  const revenueAccounts = aggregateAccounts(
    totals,
    (t) => t.type === "revenue",
    (t) => t.credit - t.debit,
  );
  const expenseAccounts = aggregateAccounts(
    totals,
    (t) => t.type === "expense",
    (t) => t.debit - t.credit,
  );

  const revenue: ConsolidatedAccountRow[] = revenueAccounts.map((r) => {
    const eliminated = Math.min(
      r.gross,
      perAccount.revenue.byAccount.get(r.code) ?? 0,
    );
    return { ...r, eliminated, amount: r.gross - eliminated };
  });
  const expenses: ConsolidatedAccountRow[] = expenseAccounts.map((r) => {
    const eliminated = Math.min(
      r.gross,
      perAccount.expense.byAccount.get(r.code) ?? 0,
    );
    return { ...r, eliminated, amount: r.gross - eliminated };
  });

  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenses.reduce((s, r) => s + r.amount, 0);
  // Use validateIntercompanyBalance as the canonical signal so the
  // UI's imbalance banner and offender list stay consistent.
  const validation = validateIntercompanyBalance(eliminations);
  const imbalance = validation.imbalance;

  return {
    scope: { companyIds, from: from ?? null, to: to ?? null },
    revenue,
    expenses,
    totalRevenue,
    totalExpense,
    netIncome: totalRevenue - totalExpense,
    eliminations,
    invalidReferences,
    totalRevenueEliminated,
    totalExpenseEliminated,
    imbalance,
    hasImbalance: imbalance > 0.01 || invalidReferences.length > 0,
  };
}

/**
 * Build a consolidated balance sheet as of a given date.
 * Eliminates AR (source) and AP (target) at face value (total incl. VAT).
 */
export async function generateConsolidatedBS(
  companyIds: number[],
  asOf?: string | null,
): Promise<ConsolidatedBS> {
  const totals = await postedAccountTotalsMulti(companyIds, null, asOf);
  // For the BS we eliminate the still-outstanding AR/AP balance only —
  // i.e. `total - amountPaid` on the source side, and the mirror's
  // total when its status is not `paid`. Eliminating the face value of
  // fully-settled invoices would understate the assets/liabilities
  // that the cash settlement has already restored.
  const { pairs, invalidReferences } = await fetchEliminationPairs(
    companyIds,
    null,
    asOf,
  );
  const eliminations = buildEliminationEntries(pairs, "open");

  // Account-targeted: only zero-out the specific AR account on the
  // source side and the specific AP account on the target side. The
  // per-account map already scales each pair by its open-ratio so
  // partial settlements are honored.
  const perAccount = await buildPerAccountEliminations(pairs);
  const totalArEliminated = perAccount.ar.total;
  const totalApEliminated = perAccount.ap.total;

  const assetRows = aggregateAccounts(
    totals,
    (t) => t.type === "asset",
    (t) => t.debit - t.credit,
  );
  const liabilityRows = aggregateAccounts(
    totals,
    (t) => t.type === "liability",
    (t) => t.credit - t.debit,
  );
  const equityRows = aggregateAccounts(
    totals,
    (t) => t.type === "equity",
    (t) => t.credit - t.debit,
  );

  const assets: ConsolidatedAccountRow[] = assetRows.map((r) => {
    const eliminated = Math.min(r.gross, perAccount.ar.byAccount.get(r.code) ?? 0);
    return { ...r, eliminated, amount: r.gross - eliminated };
  });
  const liabilities: ConsolidatedAccountRow[] = liabilityRows.map((r) => {
    const eliminated = Math.min(r.gross, perAccount.ap.byAccount.get(r.code) ?? 0);
    return { ...r, eliminated, amount: r.gross - eliminated };
  });

  // Net income flows into equity. Compute it from revenue & expense in
  // the same posted set so the sheet ties out.
  const revenue = totals
    .filter((t) => t.type === "revenue")
    .reduce((s, t) => s + (t.credit - t.debit), 0);
  const expense = totals
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + (t.debit - t.credit), 0);
  // Revenue and expense eliminations are equal-and-opposite in a matched
  // pair, so the elimination drops out of net income at the BS level.
  const netIncome = revenue - expense;
  const equity: ConsolidatedAccountRow[] = [
    ...equityRows.map((r) => ({ ...r, eliminated: 0, amount: r.gross })),
    {
      code: "NI",
      nameAr: "صافي الدخل (الحالي)",
      type: "equity",
      gross: netIncome,
      eliminated: 0,
      amount: netIncome,
    },
  ];

  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalEquity = equity.reduce((s, r) => s + r.amount, 0);
  const validation = validateIntercompanyBalance(eliminations);
  const imbalance = validation.imbalance;

  return {
    scope: { companyIds, asOf: asOf ?? null },
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    netIncome,
    isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    eliminations,
    invalidReferences,
    totalArEliminated,
    totalApEliminated,
    imbalance,
    hasImbalance: imbalance > 0.01 || invalidReferences.length > 0,
  };
}

/**
 * Build a consolidated cash flow. No eliminations: intercompany
 * settlement is a real cash movement between bank accounts and must
 * remain visible on the consolidated statement.
 */
export async function generateConsolidatedCF(
  companyIds: number[],
  from?: string | null,
  to?: string | null,
): Promise<ConsolidatedCF> {
  if (companyIds.length === 0) {
    return {
      scope: { companyIds, from: from ?? null, to: to ?? null },
      inflow: 0,
      outflow: 0,
      net: 0,
      bySource: [],
      byCompany: [],
      eliminations: [],
      invalidReferences: [],
    };
  }

  const wheres = [
    eq(journalEntriesTable.status, "posted"),
    inArray(journalEntriesTable.companyId, companyIds),
  ];
  if (from) wheres.push(gte(journalEntriesTable.entryDate, from));
  if (to) wheres.push(lte(journalEntriesTable.entryDate, to));

  const rows = await db
    .select({
      companyId: journalEntriesTable.companyId,
      companyName: companiesTable.name,
      source: journalEntriesTable.source,
      debit: journalEntryLinesTable.baseDebit,
      credit: journalEntryLinesTable.baseCredit,
    })
    .from(journalEntryLinesTable)
    .innerJoin(
      accountsTable,
      eq(accountsTable.id, journalEntryLinesTable.accountId),
    )
    .innerJoin(
      journalEntriesTable,
      eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
    )
    .innerJoin(
      companiesTable,
      eq(companiesTable.id, journalEntriesTable.companyId),
    )
    .where(and(...wheres, sql`${accountsTable.systemKey} IN ('cash','bank')`));

  let inflow = 0;
  let outflow = 0;
  const bySource = new Map<string, { inflow: number; outflow: number }>();
  const byCompany = new Map<number, { name: string; amount: number }>();
  for (const r of rows) {
    const d = Number(r.debit);
    const c = Number(r.credit);
    inflow += d;
    outflow += c;
    const sKey = r.source ?? "unknown";
    const prev = bySource.get(sKey) ?? { inflow: 0, outflow: 0 };
    prev.inflow += d;
    prev.outflow += c;
    bySource.set(sKey, prev);
    const co = byCompany.get(r.companyId) ?? { name: r.companyName, amount: 0 };
    co.amount += d - c;
    byCompany.set(r.companyId, co);
  }

  return {
    scope: { companyIds, from: from ?? null, to: to ?? null },
    inflow,
    outflow,
    net: inflow - outflow,
    bySource: Array.from(bySource.entries()).map(([source, v]) => ({
      source,
      inflow: v.inflow,
      outflow: v.outflow,
      net: v.inflow - v.outflow,
    })),
    byCompany: Array.from(byCompany.entries()).map(([companyId, v]) => ({
      companyId,
      companyName: v.name,
      amount: v.amount,
    })),
    eliminations: [],
    invalidReferences: [],
  };
}

/**
 * Throws if the source/target amount difference on any matched pair
 * exceeds the tolerance. The route handler converts this into the red
 * banner the UI shows above the report.
 */
export function validateIntercompanyBalance(
  eliminations: EliminationEntry[],
  tolerance = 0.01,
): { imbalance: number; offenders: EliminationEntry[] } {
  const offenders = eliminations.filter(
    (e) => Math.abs(e.sourceAmount - e.targetAmount) > tolerance,
  );
  const imbalance = eliminations.reduce(
    (s, e) => s + Math.abs(e.sourceAmount - e.targetAmount),
    0,
  );
  return { imbalance, offenders };
}
