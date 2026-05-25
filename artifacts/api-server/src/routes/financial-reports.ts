import { Router, type Request, type Response } from "express";
import {
  db,
  accountsTable,
  companiesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  userCompaniesTable,
} from "@workspace/db";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { financeGuard, reportReadGuard } from "../middlewares/require-role";
import {
  generateConsolidatedBS,
  generateConsolidatedCF,
  generateConsolidatedPL,
  type ConsolidatedBS,
  type ConsolidatedCF,
  type ConsolidatedPL,
} from "../lib/consolidated-reports";
import { renderPdf, renderXlsx, type Cell } from "../lib/report-render";
import { recordAudit } from "../lib/audit";

const router = Router();

/**
 * Parse `?companies=1,2,3` (or repeated `?companies=1&companies=2`) into
 * a clean unique integer list. Returns null on invalid input so the
 * handler can return 400.
 */
function parseCompanyIds(raw: unknown): number[] | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const parts = Array.isArray(raw)
    ? raw.flatMap((p) => String(p).split(","))
    : String(raw).split(",");
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const p of parts) {
    const n = Number(p.trim());
    if (!Number.isInteger(n) || n <= 0) return null;
    if (!seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }
  return ids.length > 0 ? ids : null;
}

/**
 * Verify the caller has at least read access (any role) on every
 * company in `companyIds` via `user_companies`. Returns true on
 * success and writes a 403 to `res` and returns false otherwise.
 */
async function assertConsolidatedAccess(
  req: Request,
  res: Response,
  companyIds: number[],
): Promise<boolean> {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "غير مسجل دخول" });
    return false;
  }
  const rows = await db
    .select({ companyId: userCompaniesTable.companyId })
    .from(userCompaniesTable)
    .where(
      and(
        eq(userCompaniesTable.userId, userId),
        inArray(userCompaniesTable.companyId, companyIds),
      ),
    );
  const allowed = new Set(rows.map((r) => r.companyId));
  const missing = companyIds.filter((c) => !allowed.has(c));
  if (missing.length > 0) {
    res.status(403).json({
      error: "لا تملك صلاحية على إحدى الشركات المختارة",
      code: "FORBIDDEN",
      missing,
    });
    return false;
  }
  return true;
}

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

// ============== Consolidated (Multi-Company Phase 6) ==============

/**
 * GET /reports/consolidated/pl?companies=1,2&from=...&to=...
 * Consolidated profit & loss across `companies` with intercompany
 * sales-invoice revenue/expense elimination.
 */
router.get("/reports/consolidated/pl", financeGuard, async (req, res) => {
  try {
    const ids = parseCompanyIds(req.query.companies);
    if (!ids) {
      return res
        .status(400)
        .json({ error: "اختر شركة واحدة على الأقل في companies" });
    }
    if (!(await assertConsolidatedAccess(req, res, ids))) return;
    const from = (req.query.from as string | undefined) ?? null;
    const to = (req.query.to as string | undefined) ?? null;
    const report = await generateConsolidatedPL(ids, from, to);
    return res.json(report);
  } catch (err) {
    req.log.error({ err }, "Consolidated P&L failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /reports/consolidated/bs?companies=1,2&asOf=...
 * Consolidated balance sheet with intercompany AR/AP elimination.
 */
router.get("/reports/consolidated/bs", financeGuard, async (req, res) => {
  try {
    const ids = parseCompanyIds(req.query.companies);
    if (!ids) {
      return res
        .status(400)
        .json({ error: "اختر شركة واحدة على الأقل في companies" });
    }
    if (!(await assertConsolidatedAccess(req, res, ids))) return;
    const asOf = (req.query.asOf as string | undefined) ?? null;
    const report = await generateConsolidatedBS(ids, asOf);
    return res.json(report);
  } catch (err) {
    req.log.error({ err }, "Consolidated BS failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /reports/consolidated/cf?companies=1,2&from=...&to=...
 * Consolidated cash flow. No eliminations — intercompany cash movement
 * is real and stays visible.
 */
router.get("/reports/consolidated/cf", financeGuard, async (req, res) => {
  try {
    const ids = parseCompanyIds(req.query.companies);
    if (!ids) {
      return res
        .status(400)
        .json({ error: "اختر شركة واحدة على الأقل في companies" });
    }
    if (!(await assertConsolidatedAccess(req, res, ids))) return;
    const from = (req.query.from as string | undefined) ?? null;
    const to = (req.query.to as string | undefined) ?? null;
    const report = await generateConsolidatedCF(ids, from, to);
    return res.json(report);
  } catch (err) {
    req.log.error({ err }, "Consolidated CF failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Consolidated exports (XLSX / PDF) ==============

const fmt = (n: number): string =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

async function loadCompanyNames(companyIds: number[]): Promise<string> {
  if (companyIds.length === 0) return "";
  const rows = await db
    .select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable)
    .where(inArray(companiesTable.id, companyIds))
    .orderBy(asc(companiesTable.name));
  return rows.map((r) => r.name).join(" · ");
}

function appendInvalidRefs(
  rows: Cell[][],
  invalid: { linkId: number; reason: string; sourceRef: string; targetRef: string }[],
  width: number,
) {
  if (invalid.length === 0) return;
  const pad = (cells: Cell[]) => {
    while (cells.length < width) cells.push("");
    return cells.slice(0, width);
  };
  rows.push(pad([""]));
  rows.push(pad(["—", "— INVALID_REFERENCE: روابط مكسورة —"]));
  for (const r of invalid) {
    rows.push(pad([String(r.linkId), r.reason, `${r.sourceRef} / ${r.targetRef}`]));
  }
}

function plToTable(r: ConsolidatedPL): { headers: string[]; rows: Cell[][] } {
  const headers = ["الكود", "الحساب", "النوع", "إجمالي", "إلغاء", "صافي"];
  const rows: Cell[][] = [];
  rows.push(["—", "— الإيرادات —", "", "", "", ""]);
  for (const a of r.revenue) {
    rows.push([a.code, a.nameAr, a.type, fmt(a.gross), fmt(a.eliminated), fmt(a.amount)]);
  }
  rows.push(["", "إجمالي الإيرادات", "", "", fmt(r.totalRevenueEliminated), fmt(r.totalRevenue)]);
  rows.push(["—", "— المصروفات —", "", "", "", ""]);
  for (const a of r.expenses) {
    rows.push([a.code, a.nameAr, a.type, fmt(a.gross), fmt(a.eliminated), fmt(a.amount)]);
  }
  rows.push(["", "إجمالي المصروفات", "", "", fmt(r.totalExpenseEliminated), fmt(r.totalExpense)]);
  rows.push(["", "صافي الدخل", "", "", "", fmt(r.netIncome)]);
  if (r.eliminations.length > 0) {
    rows.push(["", "", "", "", "", ""]);
    rows.push(["—", "— استبعادات داخل المجموعة —", "", "إيراد", "مصروف", "فرق"]);
    for (const e of r.eliminations) {
      rows.push([
        String(e.linkId),
        `${e.sourceCompanyName} → ${e.targetCompanyName}`,
        `${e.sourceRef} / ${e.targetRef}`,
        fmt(e.sourceAmount),
        fmt(e.targetAmount),
        fmt(e.sourceAmount - e.targetAmount),
      ]);
    }
  }
  appendInvalidRefs(rows, r.invalidReferences, headers.length);
  return { headers, rows };
}

function bsToTable(r: ConsolidatedBS): { headers: string[]; rows: Cell[][] } {
  const headers = ["الكود", "الحساب", "النوع", "إجمالي", "إلغاء", "صافي"];
  const rows: Cell[][] = [];
  rows.push(["—", "— الأصول —", "", "", "", ""]);
  for (const a of r.assets) {
    rows.push([a.code, a.nameAr, a.type, fmt(a.gross), fmt(a.eliminated), fmt(a.amount)]);
  }
  rows.push(["", "إجمالي الأصول", "", "", fmt(r.totalArEliminated), fmt(r.totalAssets)]);
  rows.push(["—", "— الالتزامات —", "", "", "", ""]);
  for (const a of r.liabilities) {
    rows.push([a.code, a.nameAr, a.type, fmt(a.gross), fmt(a.eliminated), fmt(a.amount)]);
  }
  rows.push(["", "إجمالي الالتزامات", "", "", fmt(r.totalApEliminated), fmt(r.totalLiabilities)]);
  rows.push(["—", "— حقوق الملكية —", "", "", "", ""]);
  for (const a of r.equity) {
    rows.push([a.code, a.nameAr, a.type, fmt(a.gross), fmt(a.eliminated), fmt(a.amount)]);
  }
  rows.push(["", "إجمالي حقوق الملكية", "", "", "", fmt(r.totalEquity)]);
  rows.push([
    "",
    r.isBalanced ? "الميزانية متوازنة ✓" : "الميزانية غير متوازنة!",
    "",
    "",
    "",
    fmt(r.totalLiabilities + r.totalEquity),
  ]);
  if (r.eliminations.length > 0) {
    rows.push(["", "", "", "", "", ""]);
    rows.push(["—", "— استبعادات AR/AP —", "", "ذمم مدينة", "ذمم دائنة", "فرق"]);
    for (const e of r.eliminations) {
      rows.push([
        String(e.linkId),
        `${e.sourceCompanyName} → ${e.targetCompanyName}`,
        `${e.sourceRef} / ${e.targetRef}`,
        fmt(e.sourceAmount),
        fmt(e.targetAmount),
        fmt(e.sourceAmount - e.targetAmount),
      ]);
    }
  }
  appendInvalidRefs(rows, r.invalidReferences, headers.length);
  return { headers, rows };
}

function cfToTable(r: ConsolidatedCF): { headers: string[]; rows: Cell[][] } {
  const headers = ["البند", "تفصيل", "تدفق داخل", "تدفق خارج", "صافي"];
  const rows: Cell[][] = [];
  rows.push(["—", "— حسب المصدر —", "", "", ""]);
  for (const s of r.bySource) {
    rows.push([s.source, "", fmt(s.inflow), fmt(s.outflow), fmt(s.net)]);
  }
  rows.push(["", "الإجمالي", fmt(r.inflow), fmt(r.outflow), fmt(r.net)]);
  rows.push(["—", "— حسب الشركة —", "", "", ""]);
  for (const c of r.byCompany) {
    rows.push([c.companyName, `#${c.companyId}`, "", "", fmt(c.amount)]);
  }
  return { headers, rows };
}

type ConsolidatedFormat = "xlsx" | "pdf";
type ConsolidatedKind = "pl" | "bs" | "cf";

async function handleConsolidatedExport(
  req: Request,
  res: Response,
  kind: ConsolidatedKind,
  format: ConsolidatedFormat,
): Promise<Response | void> {
  const ids = parseCompanyIds(req.query.companies);
  if (!ids) {
    return res
      .status(400)
      .json({ error: "اختر شركة واحدة على الأقل في companies" });
  }
  if (!(await assertConsolidatedAccess(req, res, ids))) return;

  const from = (req.query.from as string | undefined) ?? null;
  const to = (req.query.to as string | undefined) ?? null;
  const asOf = (req.query.asOf as string | undefined) ?? null;
  const names = await loadCompanyNames(ids);

  let title = "";
  let table: { headers: string[]; rows: Cell[][] };
  if (kind === "pl") {
    title = "قائمة الدخل الموحّدة";
    table = plToTable(await generateConsolidatedPL(ids, from, to));
  } else if (kind === "bs") {
    title = "الميزانية العمومية الموحّدة";
    table = bsToTable(await generateConsolidatedBS(ids, asOf));
  } else {
    title = "التدفقات النقدية الموحّدة";
    table = cfToTable(await generateConsolidatedCF(ids, from, to));
  }

  const subtitle = names ? `تقرير موحّد · الشركات: ${names}` : null;
  const slug = `consolidated-${kind}`;
  try {
    if (format === "xlsx") {
      await renderXlsx(res, { slug, title, subtitle, headers: table.headers, rows: table.rows });
    } else {
      await renderPdf(res, { slug, title, subtitle, headers: table.headers, rows: table.rows });
    }
    void recordAudit(req, {
      action: "export",
      entity: "report",
      details: `${format.toUpperCase()}: ${slug} (${ids.join(",")})`,
    });
  } catch (err) {
    req.log.error({ err }, `consolidated ${kind} ${format} export failed`);
    if (!res.headersSent) res.status(500).json({ error: "فشل توليد الملف" });
  }
}

router.get("/exports/consolidated-pl.xlsx", financeGuard, (req, res) =>
  handleConsolidatedExport(req, res, "pl", "xlsx"),
);
router.get("/exports/consolidated-pl.pdf", financeGuard, (req, res) =>
  handleConsolidatedExport(req, res, "pl", "pdf"),
);
router.get("/exports/consolidated-bs.xlsx", financeGuard, (req, res) =>
  handleConsolidatedExport(req, res, "bs", "xlsx"),
);
router.get("/exports/consolidated-bs.pdf", financeGuard, (req, res) =>
  handleConsolidatedExport(req, res, "bs", "pdf"),
);
router.get("/exports/consolidated-cf.xlsx", financeGuard, (req, res) =>
  handleConsolidatedExport(req, res, "cf", "xlsx"),
);
router.get("/exports/consolidated-cf.pdf", financeGuard, (req, res) =>
  handleConsolidatedExport(req, res, "cf", "pdf"),
);

export default router;
