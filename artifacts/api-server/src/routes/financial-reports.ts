import { Router } from "express";
import {
  db,
  accountsTable,
  journalEntriesTable,
  journalEntryLinesTable,
} from "@workspace/db";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { reportReadGuard } from "../middlewares/require-role";

const router = Router();

interface AccountBalance {
  id: number;
  code: string;
  name: string;
  nameAr: string;
  type: string;
  parentId: number | null;
  isGroup: boolean;
  debit: number;
  credit: number;
  balance: number; // signed: debit-credit (positive for normal-debit accounts)
}

async function getAccountBalances(
  from?: string,
  to?: string,
): Promise<AccountBalance[]> {
  // Load accounts, then sum lines from POSTED entries only so draft and
  // reversed headers never contribute to balances.
  const accounts = await db
    .select()
    .from(accountsTable)
    .orderBy(asc(accountsTable.code));

  const wheres = [eq(journalEntriesTable.status, "posted")];
  if (from) wheres.push(gte(journalEntriesTable.entryDate, from));
  if (to) wheres.push(lte(journalEntriesTable.entryDate, to));

  const sums = await db
    .select({
      accountId: journalEntryLinesTable.accountId,
      debit: sql<string>`coalesce(sum(${journalEntryLinesTable.baseDebit}::numeric),0)`,
      credit: sql<string>`coalesce(sum(${journalEntryLinesTable.baseCredit}::numeric),0)`,
    })
    .from(journalEntryLinesTable)
    .innerJoin(
      journalEntriesTable,
      eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
    )
    .where(and(...wheres))
    .groupBy(journalEntryLinesTable.accountId);

  const sumMap = new Map(
    sums.map((s) => [
      s.accountId,
      { debit: Number(s.debit), credit: Number(s.credit) },
    ]),
  );

  return accounts.map((a) => {
    const s = sumMap.get(a.id) ?? { debit: 0, credit: 0 };
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      nameAr: a.nameAr,
      type: a.type,
      parentId: a.parentId,
      isGroup: a.isGroup,
      debit: s.debit,
      credit: s.credit,
      balance: s.debit - s.credit,
    };
  });
}

// ============== Trial Balance ==============

router.get("/reports/trial-balance", reportReadGuard, async (req, res) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const balances = await getAccountBalances(from, to);
    const leaf = balances.filter((b) => !b.isGroup);

    const totalDebit = leaf.reduce(
      (s, b) => s + (b.balance > 0 ? b.balance : 0),
      0,
    );
    const totalCredit = leaf.reduce(
      (s, b) => s + (b.balance < 0 ? -b.balance : 0),
      0,
    );

    return res.json({
      from: from ?? null,
      to: to ?? null,
      accounts: leaf
        .filter((b) => Math.abs(b.balance) > 0.005 || b.debit + b.credit > 0)
        .map((b) => ({
          accountId: b.id,
          code: b.code,
          name: b.name,
          nameAr: b.nameAr,
          type: b.type,
          debit: b.balance > 0 ? b.balance : 0,
          credit: b.balance < 0 ? -b.balance : 0,
        })),
      totalDebit,
      totalCredit,
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
    });
  } catch (err) {
    req.log.error({ err }, "Trial balance failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Profit & Loss ==============

router.get("/reports/profit-loss", reportReadGuard, async (req, res) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const balances = await getAccountBalances(from, to);

    const revenues = balances.filter(
      (b) => b.type === "revenue" && !b.isGroup,
    );
    const expenses = balances.filter(
      (b) => b.type === "expense" && !b.isGroup,
    );

    // Revenue normal balance is credit -> show as positive when credit > debit
    const totalRevenue = revenues.reduce((s, b) => s + (-b.balance), 0);
    const totalExpense = expenses.reduce((s, b) => s + b.balance, 0);
    const netIncome = totalRevenue - totalExpense;

    return res.json({
      from: from ?? null,
      to: to ?? null,
      revenue: revenues
        .filter((b) => Math.abs(b.balance) > 0.005)
        .map((b) => ({
          accountId: b.id,
          code: b.code,
          name: b.name,
          nameAr: b.nameAr,
          amount: -b.balance,
        })),
      expenses: expenses
        .filter((b) => Math.abs(b.balance) > 0.005)
        .map((b) => ({
          accountId: b.id,
          code: b.code,
          name: b.name,
          nameAr: b.nameAr,
          amount: b.balance,
        })),
      totalRevenue,
      totalExpense,
      netIncome,
    });
  } catch (err) {
    req.log.error({ err }, "P&L failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Balance Sheet ==============

router.get("/reports/balance-sheet", reportReadGuard, async (req, res) => {
  try {
    const asOf = (req.query.asOf as string | undefined) ?? undefined;
    const balances = await getAccountBalances(undefined, asOf);

    const assets = balances.filter((b) => b.type === "asset" && !b.isGroup);
    const liabilities = balances.filter(
      (b) => b.type === "liability" && !b.isGroup,
    );
    const equity = balances.filter((b) => b.type === "equity" && !b.isGroup);

    // Compute current-year retained earnings from revenue - expense
    const revenues = balances.filter((b) => b.type === "revenue" && !b.isGroup);
    const expenses = balances.filter((b) => b.type === "expense" && !b.isGroup);
    const netIncome =
      revenues.reduce((s, b) => s + (-b.balance), 0) -
      expenses.reduce((s, b) => s + b.balance, 0);

    const totalAssets = assets.reduce((s, b) => s + b.balance, 0);
    const totalLiabilities = liabilities.reduce(
      (s, b) => s + (-b.balance),
      0,
    );
    const totalEquity =
      equity.reduce((s, b) => s + (-b.balance), 0) + netIncome;

    return res.json({
      asOf: asOf ?? null,
      assets: assets
        .filter((b) => Math.abs(b.balance) > 0.005)
        .map((b) => ({
          accountId: b.id,
          code: b.code,
          name: b.name,
          nameAr: b.nameAr,
          amount: b.balance,
        })),
      liabilities: liabilities
        .filter((b) => Math.abs(b.balance) > 0.005)
        .map((b) => ({
          accountId: b.id,
          code: b.code,
          name: b.name,
          nameAr: b.nameAr,
          amount: -b.balance,
        })),
      equity: [
        ...equity
          .filter((b) => Math.abs(b.balance) > 0.005)
          .map((b) => ({
            accountId: b.id,
            code: b.code,
            name: b.name,
            nameAr: b.nameAr,
            amount: -b.balance,
          })),
        {
          accountId: 0,
          code: "NI",
          name: "Net Income (Current)",
          nameAr: "صافي الدخل (الحالي)",
          amount: netIncome,
        },
      ],
      totalAssets,
      totalLiabilities,
      totalEquity,
      netIncome,
      isBalanced:
        Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    });
  } catch (err) {
    req.log.error({ err }, "Balance sheet failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Cash Flow (simplified direct method) ==============

router.get("/reports/cash-flow", reportReadGuard, async (req, res) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const wheres = [eq(journalEntriesTable.status, "posted")];
    if (from) wheres.push(gte(journalEntriesTable.entryDate, from));
    if (to) wheres.push(lte(journalEntriesTable.entryDate, to));

    // All JE lines that touch a cash/bank account
    const rows = await db
      .select({
        source: journalEntriesTable.source,
        debit: journalEntryLinesTable.baseDebit,
        credit: journalEntryLinesTable.baseCredit,
        systemKey: accountsTable.systemKey,
      })
      .from(journalEntryLinesTable)
      .innerJoin(
        accountsTable,
        eq(accountsTable.id, journalEntryLinesTable.accountId),
      )
      .innerJoin(
        journalEntriesTable,
        and(
          eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
          ...wheres,
        ),
      )
      .where(sql`${accountsTable.systemKey} IN ('cash','bank')`);

    let inflow = 0;
    let outflow = 0;
    const bySource: Record<string, { in: number; out: number }> = {};
    for (const r of rows) {
      const d = Number(r.debit);
      const c = Number(r.credit);
      inflow += d;
      outflow += c;
      const key = r.source ?? "unknown";
      bySource[key] ??= { in: 0, out: 0 };
      bySource[key].in += d;
      bySource[key].out += c;
    }

    return res.json({
      from: from ?? null,
      to: to ?? null,
      inflow,
      outflow,
      net: inflow - outflow,
      bySource: Object.entries(bySource).map(([source, v]) => ({
        source,
        inflow: v.in,
        outflow: v.out,
        net: v.in - v.out,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Cash flow failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== General Ledger (per-account) ==============

router.get("/reports/general-ledger/:accountId", reportReadGuard, async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const [account] = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1);
    if (!account) return res.status(404).json({ error: "الحساب غير موجود" });

    const wheres = [
      eq(journalEntryLinesTable.accountId, accountId),
      eq(journalEntriesTable.status, "posted"),
    ];
    if (from) wheres.push(gte(journalEntriesTable.entryDate, from));
    if (to) wheres.push(lte(journalEntriesTable.entryDate, to));

    const rows = await db
      .select({
        id: journalEntryLinesTable.id,
        entryId: journalEntryLinesTable.entryId,
        entryNumber: journalEntriesTable.entryNumber,
        entryDate: journalEntriesTable.entryDate,
        description: journalEntriesTable.description,
        lineDescription: journalEntryLinesTable.description,
        reference: journalEntriesTable.reference,
        debit: journalEntryLinesTable.baseDebit,
        credit: journalEntryLinesTable.baseCredit,
      })
      .from(journalEntryLinesTable)
      .innerJoin(
        journalEntriesTable,
        eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
      )
      .where(and(...wheres))
      .orderBy(asc(journalEntriesTable.entryDate), asc(journalEntriesTable.id));

    let running = 0;
    const lines = rows.map((r) => {
      const d = Number(r.debit);
      const c = Number(r.credit);
      running += d - c;
      return {
        id: r.id,
        entryId: r.entryId,
        entryNumber: r.entryNumber,
        entryDate: r.entryDate,
        description: r.lineDescription ?? r.description,
        reference: r.reference,
        debit: d,
        credit: c,
        balance: running,
      };
    });

    return res.json({
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        nameAr: account.nameAr,
        type: account.type,
      },
      from: from ?? null,
      to: to ?? null,
      lines,
      totalDebit: lines.reduce((s, l) => s + l.debit, 0),
      totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      closingBalance: running,
    });
  } catch (err) {
    req.log.error({ err }, "GL failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
