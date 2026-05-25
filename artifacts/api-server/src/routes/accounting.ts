import { Router } from "express";
import {
  db,
  accountsTable,
  currenciesTable,
  exchangeRatesTable,
  fiscalYearsTable,
  fiscalPeriodsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  bankAccountsTable,
  bankStatementsTable,
  bankStatementLinesTable,
  usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  financeGuard,
  reportReadGuard,
  ownerOnly,
  requireRole,
} from "../middlewares/require-role";
import {
  postJournalEntry,
  reverseJournalEntry,
  getRateForDate,
} from "../lib/journal-posting";
import { recordAudit } from "../lib/audit";
import { ClosedPeriodError } from "../lib/journal-posting";
import { getCompanyId } from "../lib/scoped-db";
import { handleClosedPeriod } from "../lib/handle-error";
import {
  submitForApproval,
  registerOnApprove,
  registerOnReject,
} from "../lib/workflow-engine";
import { logger } from "../lib/logger";

const router = Router();

// ---------------------------------------------------------------------------
// Workflow-engine integration: Journal Entry posting.
//   * /accounting/journal-entries/:id/post submits to the engine when an
//     admin has configured a `journal_entry` rule. The amount used for
//     threshold matching is the entry's total debit (== total credit, since
//     we re-validate balance below). When a rule matches, the row is locked
//     to 'pending_approval' and 202 + approvalRequestId is returned.
//   * The registered onApprove handler is the ONLY caller allowed to
//     finalize a pending_approval JE — it runs the same balance + period
//     re-checks before flipping status to posted.
//   * onReject reverts the row back to 'draft' so the user can edit and
//     resubmit, without losing the underlying lines.
// ---------------------------------------------------------------------------
async function finalizeJournalEntryPost(
  id: number,
  userId: number | null,
): Promise<{ id: number; status: string }> {
  const [entry] = await db
    .select()
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.id, id))
    .limit(1);
  if (!entry) throw new Error("القيد غير موجود");
  if (entry.status !== "draft" && entry.status !== "pending_approval") {
    throw new Error(`لا يمكن ترحيل قيد في حالة ${entry.status}`);
  }
  if (entry.periodId) {
    const [period] = await db
      .select({ status: fiscalPeriodsTable.status })
      .from(fiscalPeriodsTable)
      .where(eq(fiscalPeriodsTable.id, entry.periodId))
      .limit(1);
    if (period && (period.status === "closed" || period.status === "locked")) {
      // Use the shared ClosedPeriodError so /post + the approval-engine
      // path both surface a 403 with the exact required Arabic message.
      throw new ClosedPeriodError(String(entry.entryDate ?? ""));
    }
  }
  const [bal] = await db
    .select({
      d: sql<string>`coalesce(sum(${journalEntryLinesTable.debit}::numeric),0)`,
      c: sql<string>`coalesce(sum(${journalEntryLinesTable.credit}::numeric),0)`,
    })
    .from(journalEntryLinesTable)
    .where(eq(journalEntryLinesTable.entryId, id));
  if (Math.abs(Number(bal.d) - Number(bal.c)) > 0.005) {
    throw new Error("القيد غير متوازن");
  }
  const [updated] = await db
    .update(journalEntriesTable)
    .set({ status: "posted", postedAt: new Date(), postedBy: userId })
    .where(eq(journalEntriesTable.id, id))
    .returning();
  return { id: updated.id, status: updated.status };
}

registerOnApprove("journal_entry", async (recordId) => {
  try {
    await finalizeJournalEntryPost(recordId, null);
  } catch (err) {
    logger.error({ err, recordId }, "journal_entry onApprove finalize failed");
    throw err;
  }
});

registerOnReject("journal_entry", async (recordId) => {
  try {
    // Constrain the revert to rows actually waiting on approval — guards
    // against state drift if the row was somehow advanced between the
    // engine call and this handler.
    await db
      .update(journalEntriesTable)
      .set({ status: "draft" })
      .where(
        and(
          eq(journalEntriesTable.id, recordId),
          eq(journalEntriesTable.status, "pending_approval"),
        ),
      );
  } catch (err) {
    logger.error({ err, recordId }, "journal_entry onReject revert failed");
  }
});

// ============== Currencies ==============

router.get("/accounting/currencies", reportReadGuard, async (req, res) => {
  try {
    const list = await db
      .select()
      .from(currenciesTable)
      .orderBy(desc(currenciesTable.isBase), asc(currenciesTable.code));
    return res.json(list.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "List currencies failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

const exchangeRateBody = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3).default("SAR"),
  rate: z.number().positive(),
  rateDate: z.string(),
});

router.get("/accounting/exchange-rates", reportReadGuard, async (req, res) => {
  try {
    const list = await db
      .select()
      .from(exchangeRatesTable)
      .orderBy(desc(exchangeRatesTable.rateDate))
      .limit(200);
    return res.json(
      list.map((r) => ({
        ...r,
        rate: Number(r.rate),
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "List exchange rates failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/accounting/exchange-rates", financeGuard, async (req, res) => {
  try {
    const body = exchangeRateBody.parse(req.body);
    const [row] = await db
      .insert(exchangeRatesTable)
      .values({
        fromCurrency: body.fromCurrency,
        toCurrency: body.toCurrency,
        rate: String(body.rate),
        rateDate: body.rateDate,
      })
      .onConflictDoUpdate({
        target: [
          exchangeRatesTable.fromCurrency,
          exchangeRatesTable.toCurrency,
          exchangeRatesTable.rateDate,
        ],
        set: { rate: String(body.rate) },
      })
      .returning();
    return res.status(201).json({
      ...row,
      rate: Number(row.rate),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Create exchange rate failed");
    return res.status(400).json({ error: (err as Error).message });
  }
});

// ============== Accounts (Chart of Accounts) ==============

router.get("/accounting/accounts", reportReadGuard, async (req, res) => {
  try {
    const list = await db
      .select()
      .from(accountsTable)
      .orderBy(asc(accountsTable.code));
    return res.json(list.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "List accounts failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

const createAccountBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().min(1),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  parentId: z.number().int().nullable().optional(),
  isGroup: z.boolean().optional(),
  currencyCode: z.string().length(3).optional(),
  description: z.string().nullable().optional(),
  systemKey: z.string().nullable().optional(),
});

router.post("/accounting/accounts", financeGuard, async (req, res) => {
  try {
    const body = createAccountBody.parse(req.body);
    const [row] = await db
      .insert(accountsTable)
      .values({
        code: body.code,
        name: body.name,
        nameAr: body.nameAr,
        type: body.type,
        parentId: body.parentId ?? null,
        isGroup: body.isGroup ?? false,
        currencyCode: body.currencyCode ?? "SAR",
        description: body.description ?? null,
        systemKey: body.systemKey ?? null,
      })
      .returning();
    return res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Create account failed");
    return res.status(400).json({ error: (err as Error).message });
  }
});

router.patch("/accounting/accounts/:id", financeGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = createAccountBody.partial().parse(req.body);
    const updates: Partial<typeof accountsTable.$inferInsert> = {};
    if (body.code !== undefined) updates.code = body.code;
    if (body.name !== undefined) updates.name = body.name;
    if (body.nameAr !== undefined) updates.nameAr = body.nameAr;
    if (body.type !== undefined) updates.type = body.type;
    if (body.parentId !== undefined) updates.parentId = body.parentId;
    if (body.isGroup !== undefined) updates.isGroup = body.isGroup;
    if (body.currencyCode !== undefined) updates.currencyCode = body.currencyCode;
    if (body.description !== undefined) updates.description = body.description;
    if (body.systemKey !== undefined) updates.systemKey = body.systemKey;
    const [row] = await db
      .update(accountsTable)
      .set(updates)
      .where(eq(accountsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "الحساب غير موجود" });
    return res.json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Update account failed");
    return res.status(400).json({ error: (err as Error).message });
  }
});

// ============== Fiscal Periods ==============

router.get("/accounting/fiscal-years", reportReadGuard, async (_req, res) => {
  const years = await db
    .select()
    .from(fiscalYearsTable)
    .orderBy(desc(fiscalYearsTable.startDate));
  const periods = await db
    .select()
    .from(fiscalPeriodsTable)
    .orderBy(asc(fiscalPeriodsTable.startDate));
  return res.json(
    years.map((y) => ({
      ...y,
      closedAt: y.closedAt?.toISOString() ?? null,
      createdAt: y.createdAt.toISOString(),
      periods: periods
        .filter((p) => p.fiscalYearId === y.id)
        .map((p) => ({
          ...p,
          closedAt: p.closedAt?.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
        })),
    })),
  );
});

router.post(
  "/accounting/fiscal-periods/:id/close",
  requireRole("owner", "manager"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = req.session?.userId ?? null;
      const [row] = await db
        .update(fiscalPeriodsTable)
        .set({ status: "closed", closedAt: new Date(), closedBy: userId })
        .where(eq(fiscalPeriodsTable.id, id))
        .returning();
      if (!row) return res.status(404).json({ error: "الفترة غير موجودة" });
      return res.json({
        ...row,
        closedAt: row.closedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, "Close period failed");
      return res.status(400).json({ error: (err as Error).message });
    }
  },
);

router.post(
  "/accounting/fiscal-periods/:id/reopen",
  ownerOnly,
  async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await db
      .update(fiscalPeriodsTable)
      .set({ status: "open", closedAt: null, closedBy: null })
      .where(eq(fiscalPeriodsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "الفترة غير موجودة" });
    // Reopening a closed period bypasses normal posting controls — always
    // leave an audit trail with the period name + range so auditors can
    // reconcile later why a sealed period was unlocked.
    await recordAudit(req, {
      action: "fiscal_period.reopen",
      entity: `fiscal_period:${row.id}`,
      details: `إعادة فتح الفترة "${row.name}" (${row.startDate} → ${row.endDate})`,
      severity: "warning",
    });
    return res.json({
      ...row,
      closedAt: null,
      createdAt: row.createdAt.toISOString(),
    });
  },
);

// Path aliases matching the closing-controls task spec:
//   POST /accounting/periods/:id/close
//   POST /accounting/periods/:id/reopen
// These delegate to the existing /accounting/fiscal-periods/:id/{close,reopen}
// handlers so behavior, guards, and audit logs stay identical.
router.post(
  "/accounting/periods/:id/close",
  requireRole("owner", "manager"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = req.session?.userId ?? null;
      const [row] = await db
        .update(fiscalPeriodsTable)
        .set({ status: "closed", closedAt: new Date(), closedBy: userId })
        .where(eq(fiscalPeriodsTable.id, id))
        .returning();
      if (!row) return res.status(404).json({ error: "الفترة غير موجودة" });
      return res.json({
        ...row,
        closedAt: row.closedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, "Close period (alias) failed");
      return res.status(400).json({ error: (err as Error).message });
    }
  },
);
router.post(
  "/accounting/periods/:id/reopen",
  ownerOnly,
  async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await db
      .update(fiscalPeriodsTable)
      .set({ status: "open", closedAt: null, closedBy: null })
      .where(eq(fiscalPeriodsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "الفترة غير موجودة" });
    await recordAudit(req, {
      action: "fiscal_period.reopen",
      entity: `fiscal_period:${row.id}`,
      details: `إعادة فتح الفترة "${row.name}" (${row.startDate} → ${row.endDate})`,
      severity: "warning",
    });
    return res.json({
      ...row,
      closedAt: null,
      createdAt: row.createdAt.toISOString(),
    });
  },
);

// Alias matching the task spec: GET /accounting/periods returns a flat list
// of all fiscal periods (across years) so the periods page can render them
// without first joining the year hierarchy.
router.get("/accounting/periods", reportReadGuard, async (_req, res) => {
  const rows = await db
    .select({
      id: fiscalPeriodsTable.id,
      fiscalYearId: fiscalPeriodsTable.fiscalYearId,
      yearName: fiscalYearsTable.name,
      name: fiscalPeriodsTable.name,
      startDate: fiscalPeriodsTable.startDate,
      endDate: fiscalPeriodsTable.endDate,
      status: fiscalPeriodsTable.status,
      closedAt: fiscalPeriodsTable.closedAt,
      closedBy: fiscalPeriodsTable.closedBy,
      createdAt: fiscalPeriodsTable.createdAt,
    })
    .from(fiscalPeriodsTable)
    .leftJoin(
      fiscalYearsTable,
      eq(fiscalYearsTable.id, fiscalPeriodsTable.fiscalYearId),
    )
    .orderBy(asc(fiscalPeriodsTable.startDate));
  return res.json(
    rows.map((p) => ({
      ...p,
      closedAt: p.closedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
  );
});

// ============== Fiscal Year Closing ==============
//
// Closing a fiscal year:
//   1. Compute net balance of every revenue and expense account from
//      posted JE lines whose entry_date falls within the year.
//   2. Create a single closing JE on the year's last day that zeroes
//      out each revenue/expense account, with the balancing leg posted
//      to retained_earnings. The JE source is "period_close" so it is
//      easy to find again in the closing-statement report.
//   3. Mark the fiscal_year row as 'closed' and every fiscal_period
//      under it as 'closed' so subsequent edits are blocked by
//      resolvePeriodId() in journal-posting.ts.
//
// Reopening a year is intentionally NOT exposed: an owner who needs to
// reverse the close must (a) reverse the period_close JE manually, then
// (b) reopen each affected period one at a time — which leaves a
// per-period audit trail.

const closeYearBody = z.object({
  fiscalYearId: z.number().int().positive(),
});

router.post("/accounting/close-year", ownerOnly, async (req, res) => {
  try {
    const { fiscalYearId } = closeYearBody.parse(req.body);
    const userId = req.session?.userId ?? null;

    const result = await db.transaction(async (tx) => {
      const [year] = await tx
        .select()
        .from(fiscalYearsTable)
        .where(eq(fiscalYearsTable.id, fiscalYearId))
        .limit(1);
      if (!year) throw new Error("السنة المالية غير موجودة");
      if (year.status === "closed")
        throw new Error("السنة المالية مغلقة مسبقاً");

      const [retained] = await tx
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(eq(accountsTable.systemKey, "retained_earnings"))
        .limit(1);
      if (!retained)
        throw new Error(
          "حساب الأرباح المرحّلة (retained_earnings) غير موجود في دليل الحسابات",
        );

      // Aggregate per-account net (debit - credit) on revenue/expense
      // accounts from POSTED entries whose date is within the year.
      // We use base_debit/base_credit so multi-currency entries are
      // already normalized to SAR.
      const balances = await tx
        .select({
          accountId: accountsTable.id,
          accountType: accountsTable.type,
          accountName: accountsTable.nameAr,
          net: sql<string>`coalesce(sum(${journalEntryLinesTable.baseDebit}::numeric - ${journalEntryLinesTable.baseCredit}::numeric),0)`,
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
        .where(
          and(
            eq(journalEntriesTable.status, "posted"),
            gte(journalEntriesTable.entryDate, year.startDate),
            lte(journalEntriesTable.entryDate, year.endDate),
            sql`${accountsTable.type} IN ('revenue','expense')`,
          ),
        )
        .groupBy(accountsTable.id, accountsTable.type, accountsTable.nameAr);

      // Build closing lines: a credit-balance revenue account is debited
      // to close it; a debit-balance expense account is credited. The
      // running net flows to retained earnings as the balancing leg.
      const lines: Array<{
        accountId: number;
        description: string;
        debit: number;
        credit: number;
      }> = [];
      let retainedDelta = 0; // net debit to retained earnings
      for (const b of balances) {
        const net = Number(b.net);
        if (Math.abs(net) < 0.005) continue;
        if (net > 0) {
          // expense / debit-balance: credit it to zero
          lines.push({
            accountId: b.accountId,
            description: `إقفال ${b.accountName}`,
            debit: 0,
            credit: net,
          });
          retainedDelta -= net;
        } else {
          // revenue / credit-balance: debit it to zero
          lines.push({
            accountId: b.accountId,
            description: `إقفال ${b.accountName}`,
            debit: -net,
            credit: 0,
          });
          retainedDelta += -net;
        }
      }

      if (lines.length === 0) {
        throw new Error(
          "لا توجد أرصدة إيرادات أو مصروفات لإقفالها في هذه السنة المالية",
        );
      }

      // Balancing leg to retained earnings. retainedDelta = net profit.
      // A positive net profit → CREDIT retained earnings; a loss → DEBIT.
      if (retainedDelta > 0) {
        lines.push({
          accountId: retained.id,
          description: "ترحيل صافي الربح إلى الأرباح المحتجزة",
          debit: 0,
          credit: retainedDelta,
        });
      } else {
        lines.push({
          accountId: retained.id,
          description: "ترحيل صافي الخسارة من الأرباح المحتجزة",
          debit: -retainedDelta,
          credit: 0,
        });
      }

      const { id: jeId, entryNumber } = await postJournalEntry(
        tx,
        {
          entryDate: year.endDate,
          description: `قيد إقفال السنة المالية ${year.name}`,
          reference: `YEAR-CLOSE-${year.name}`,
          source: "period_close",
          sourceRef: `fiscal_year:${year.id}`,
          createdBy: userId,
          status: "posted",
          companyId: getCompanyId(req),
        },
        lines,
      );

      // Lock the year and every period under it. We close periods AFTER
      // posting the closing entry so resolvePeriodId() does not block
      // the closing JE itself.
      await tx
        .update(fiscalPeriodsTable)
        .set({ status: "closed", closedAt: new Date(), closedBy: userId })
        .where(
          and(
            eq(fiscalPeriodsTable.fiscalYearId, year.id),
            eq(fiscalPeriodsTable.status, "open"),
          ),
        );
      await tx
        .update(fiscalYearsTable)
        .set({ status: "closed", closedAt: new Date(), closedBy: userId })
        .where(eq(fiscalYearsTable.id, year.id));

      return {
        fiscalYearId: year.id,
        fiscalYearName: year.name,
        closingEntryId: jeId,
        closingEntryNumber: entryNumber,
        netResult: retainedDelta,
      };
    });

    await recordAudit(req, {
      action: "fiscal_year.close",
      entity: `fiscal_year:${result.fiscalYearId}`,
      details: `إقفال السنة المالية ${result.fiscalYearName} — قيد الإقفال ${result.closingEntryNumber}`,
      severity: "critical",
    });

    return res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Close fiscal year failed");
    return res.status(400).json({ error: (err as Error).message });
  }
});

// Closing-statement report: lists every closing JE (source='period_close')
// optionally filtered to a single fiscal year via sourceRef.
router.get("/accounting/closing-entries", reportReadGuard, async (req, res) => {
  try {
    const fiscalYearId = req.query.fiscalYearId
      ? Number(req.query.fiscalYearId)
      : undefined;
    const wheres: SQL[] = [
      eq(journalEntriesTable.source, "period_close"),
    ];
    if (fiscalYearId) {
      wheres.push(
        eq(journalEntriesTable.sourceRef, `fiscal_year:${fiscalYearId}`),
      );
    }
    const entries = await db
      .select({
        id: journalEntriesTable.id,
        entryNumber: journalEntriesTable.entryNumber,
        entryDate: journalEntriesTable.entryDate,
        description: journalEntriesTable.description,
        sourceRef: journalEntriesTable.sourceRef,
        postedAt: journalEntriesTable.postedAt,
        totalDebit: sql<string>`coalesce(sum(${journalEntryLinesTable.debit}::numeric),0)`,
      })
      .from(journalEntriesTable)
      .leftJoin(
        journalEntryLinesTable,
        eq(journalEntryLinesTable.entryId, journalEntriesTable.id),
      )
      .where(and(...wheres))
      .groupBy(journalEntriesTable.id)
      .orderBy(desc(journalEntriesTable.entryDate));
    return res.json(
      entries.map((e) => ({
        ...e,
        totalAmount: Number(e.totalDebit),
        postedAt: e.postedAt?.toISOString() ?? null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "List closing entries failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Journal Entries ==============

router.get("/accounting/journal-entries", reportReadGuard, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const source = req.query.source as string | undefined;
    const accountId = req.query.accountId
      ? Number(req.query.accountId)
      : undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    // Tenant scope: journal entries are the canonical financial record;
    // every list/detail/post path MUST filter by companyId so callers
    // cannot read or act on another tenant's books.
    const companyId = getCompanyId(req);

    const wheres: SQL[] = [eq(journalEntriesTable.companyId, companyId)];
    if (status) wheres.push(eq(journalEntriesTable.status, status));
    if (source) wheres.push(eq(journalEntriesTable.source, source));
    if (from) wheres.push(gte(journalEntriesTable.entryDate, from));
    if (to) wheres.push(lte(journalEntriesTable.entryDate, to));

    const baseQuery = db
      .select({
        id: journalEntriesTable.id,
        entryNumber: journalEntriesTable.entryNumber,
        entryDate: journalEntriesTable.entryDate,
        periodId: journalEntriesTable.periodId,
        description: journalEntriesTable.description,
        reference: journalEntriesTable.reference,
        currencyCode: journalEntriesTable.currencyCode,
        exchangeRate: journalEntriesTable.exchangeRate,
        status: journalEntriesTable.status,
        source: journalEntriesTable.source,
        sourceRef: journalEntriesTable.sourceRef,
        createdBy: journalEntriesTable.createdBy,
        createdByName: usersTable.name,
        postedAt: journalEntriesTable.postedAt,
        reversedAt: journalEntriesTable.reversedAt,
        reversalOf: journalEntriesTable.reversalOf,
        createdAt: journalEntriesTable.createdAt,
        totalDebit: sql<string>`coalesce(sum(${journalEntryLinesTable.debit}::numeric),0)`,
      })
      .from(journalEntriesTable)
      .leftJoin(
        journalEntryLinesTable,
        eq(journalEntryLinesTable.entryId, journalEntriesTable.id),
      )
      .leftJoin(usersTable, eq(usersTable.id, journalEntriesTable.createdBy))
      .groupBy(journalEntriesTable.id, usersTable.name)
      .orderBy(desc(journalEntriesTable.entryDate), desc(journalEntriesTable.id))
      .limit(limit);

    const entries = await baseQuery.where(and(...wheres));

    let filtered = entries;
    if (accountId) {
      const ids = await db
        .selectDistinct({ entryId: journalEntryLinesTable.entryId })
        .from(journalEntryLinesTable)
        .where(eq(journalEntryLinesTable.accountId, accountId));
      const idSet = new Set(ids.map((i) => i.entryId));
      filtered = entries.filter((e) => idSet.has(e.id));
    }

    return res.json(
      filtered.map((e) => ({
        ...e,
        exchangeRate: Number(e.exchangeRate),
        totalAmount: Number(e.totalDebit),
        postedAt: e.postedAt?.toISOString() ?? null,
        reversedAt: e.reversedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "List journal entries failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/accounting/journal-entries/:id", reportReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    // Cross-tenant IDOR defense: scope (id, companyId).
    const companyId = getCompanyId(req);
    const [entry] = await db
      .select()
      .from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.companyId, companyId)))
      .limit(1);
    if (!entry) return res.status(404).json({ error: "القيد غير موجود" });
    const lines = await db
      .select({
        id: journalEntryLinesTable.id,
        lineNumber: journalEntryLinesTable.lineNumber,
        accountId: journalEntryLinesTable.accountId,
        accountCode: accountsTable.code,
        accountName: accountsTable.nameAr,
        description: journalEntryLinesTable.description,
        debit: journalEntryLinesTable.debit,
        credit: journalEntryLinesTable.credit,
        baseDebit: journalEntryLinesTable.baseDebit,
        baseCredit: journalEntryLinesTable.baseCredit,
      })
      .from(journalEntryLinesTable)
      .leftJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
      .where(eq(journalEntryLinesTable.entryId, id))
      .orderBy(asc(journalEntryLinesTable.lineNumber));
    return res.json({
      ...entry,
      exchangeRate: Number(entry.exchangeRate),
      postedAt: entry.postedAt?.toISOString() ?? null,
      reversedAt: entry.reversedAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
      lines: lines.map((l) => ({
        ...l,
        debit: Number(l.debit),
        credit: Number(l.credit),
        baseDebit: Number(l.baseDebit),
        baseCredit: Number(l.baseCredit),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Get journal entry failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

const createJEBody = z.object({
  entryDate: z.string(),
  description: z.string().min(1),
  reference: z.string().nullable().optional(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  status: z.enum(["draft", "posted"]).optional(),
  lines: z
    .array(
      z.object({
        accountId: z.number().int(),
        description: z.string().nullable().optional(),
        debit: z.number().min(0).optional(),
        credit: z.number().min(0).optional(),
      }),
    )
    .min(2),
});

router.post("/accounting/journal-entries", financeGuard, async (req, res) => {
  try {
    const body = createJEBody.parse(req.body);
    const userId = req.session?.userId ?? null;

    let exchangeRate = body.exchangeRate;
    if (!exchangeRate && body.currencyCode && body.currencyCode !== "SAR") {
      exchangeRate = await getRateForDate(
        db,
        body.currencyCode,
        new Date(body.entryDate),
      );
    }

    const result = await db.transaction(async (tx) => {
      return postJournalEntry(
        tx,
        {
          entryDate: body.entryDate,
          description: body.description,
          reference: body.reference ?? null,
          currencyCode: body.currencyCode ?? "SAR",
          exchangeRate: exchangeRate ?? 1,
          source: "manual",
          createdBy: userId,
          status: body.status ?? "draft",
          companyId: getCompanyId(req),
        },
        body.lines,
      );
    });
    return res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Create JE failed");
    if (handleClosedPeriod(err, res)) return;
    return res.status(400).json({ error: (err as Error).message });
  }
});

router.post(
  "/accounting/journal-entries/:id/post",
  financeGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = req.session?.userId ?? null;
      // Cross-tenant mutation defense: load by (id, companyId) so a
      // forged id from another tenant cannot trigger /post on books
      // the caller doesn't own.
      const postCompanyId = getCompanyId(req);
      const [entry] = await db
        .select()
        .from(journalEntriesTable)
        .where(
          and(
            eq(journalEntriesTable.id, id),
            eq(journalEntriesTable.companyId, postCompanyId),
          ),
        )
        .limit(1);
      if (!entry) return res.status(404).json({ error: "القيد غير موجود" });
      // Strict gate, mirrors payment_run/credit_note:
      //   * draft → submit to engine; if a rule matches, lock to
      //     'pending_approval' and return 202 — the registered
      //     onApprove("journal_entry") handler is the only caller that
      //     finalizes the post.
      //   * pending_approval → reject the manual call (would otherwise let
      //     a finance user bypass the chain).
      //   * anything else → 400.
      if (entry.status === "pending_approval") {
        // Surface the existing approval request id so the client can
        // deep-link to the inbox on a repeat /post call (idempotent UX).
        const existing = await db.execute(sql`
          SELECT id FROM approval_requests
           WHERE doc_type = 'journal_entry' AND record_id = ${id}
           ORDER BY id DESC LIMIT 1
        `);
        const approvalRequestId =
          (existing.rows[0] as { id?: number } | undefined)?.id;
        return res.status(202).json({
          ok: false,
          pendingApproval: true,
          approvalRequestId,
          message:
            "ترحيل القيد بانتظار الاعتماد — لا يمكن الترحيل يدوياً قبل اكتمال سلسلة الاعتماد.",
        });
      }
      if (entry.status !== "draft")
        return res.status(400).json({ error: "القيد ليس في حالة مسودة" });

      // Re-check fiscal period status at post time — a draft created earlier
      // must not bypass a period that has since been closed/locked.
      if (entry.periodId) {
        const [period] = await db
          .select({ status: fiscalPeriodsTable.status })
          .from(fiscalPeriodsTable)
          .where(eq(fiscalPeriodsTable.id, entry.periodId))
          .limit(1);
        if (period && (period.status === "closed" || period.status === "locked")) {
          return res
            .status(403)
            .json({ error: "الفترة مُغلقة لا يمكن التعديل" });
        }
      }

      // Verify balance
      const [bal] = await db
        .select({
          d: sql<string>`coalesce(sum(${journalEntryLinesTable.debit}::numeric),0)`,
          c: sql<string>`coalesce(sum(${journalEntryLinesTable.credit}::numeric),0)`,
        })
        .from(journalEntryLinesTable)
        .where(eq(journalEntryLinesTable.entryId, id));
      if (Math.abs(Number(bal.d) - Number(bal.c)) > 0.005) {
        return res.status(400).json({ error: "القيد غير متوازن" });
      }

      // Workflow-engine submission. The amount used for threshold
      // matching is the entry's total debit (== total credit, balance
      // already verified above). When a rule matches we lock the row to
      // 'pending_approval' and return 202.
      const submission = await submitForApproval({
        docType: "journal_entry",
        recordId: id,
        recordRef: entry.entryNumber,
        amount: Number(bal.d),
        submittedByUserId: userId,
        submittedByName:
          (req.session as { userName?: string } | undefined)?.userName ?? null,
      });
      if (submission.required) {
        await db
          .update(journalEntriesTable)
          .set({ status: "pending_approval" })
          .where(eq(journalEntriesTable.id, id));
        return res.status(202).json({
          ok: false,
          pendingApproval: true,
          approvalRequestId: submission.requestId,
          message: "ترحيل القيد بانتظار الاعتماد",
        });
      }

      // No rule matched → finalize inline. Delegated to the shared
      // helper so /post and the workflow-engine onApprove path always
      // run identical logic.
      const result = await finalizeJournalEntryPost(id, userId);
      return res.json(result);
    } catch (err) {
      req.log.error({ err }, "Post JE failed");
      if (handleClosedPeriod(err, res)) return;
      return res.status(400).json({ error: (err as Error).message });
    }
  },
);

router.post(
  "/accounting/journal-entries/:id/reverse",
  financeGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const userId = req.session?.userId ?? null;
      const reason =
        typeof req.body?.reason === "string" ? req.body.reason : undefined;
      const result = await db.transaction((tx) =>
        reverseJournalEntry(tx, id, userId, reason),
      );
      return res.json(result);
    } catch (err) {
      req.log.error({ err }, "Reverse JE failed");
      if (handleClosedPeriod(err, res)) return;
      return res.status(400).json({ error: (err as Error).message });
    }
  },
);

// ============== Bank Accounts & Reconciliation ==============

router.get("/accounting/bank-accounts", reportReadGuard, async (_req, res) => {
  const list = await db
    .select({
      id: bankAccountsTable.id,
      name: bankAccountsTable.name,
      bankName: bankAccountsTable.bankName,
      accountNumber: bankAccountsTable.accountNumber,
      iban: bankAccountsTable.iban,
      currencyCode: bankAccountsTable.currencyCode,
      glAccountId: bankAccountsTable.glAccountId,
      glAccountCode: accountsTable.code,
      glAccountName: accountsTable.nameAr,
      openingBalance: bankAccountsTable.openingBalance,
      isActive: bankAccountsTable.isActive,
      createdAt: bankAccountsTable.createdAt,
    })
    .from(bankAccountsTable)
    .leftJoin(accountsTable, eq(accountsTable.id, bankAccountsTable.glAccountId))
    .orderBy(desc(bankAccountsTable.createdAt));
  return res.json(
    list.map((b) => ({
      ...b,
      openingBalance: Number(b.openingBalance),
      createdAt: b.createdAt.toISOString(),
    })),
  );
});

const createBankAccountBody = z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  accountNumber: z.string().min(1),
  iban: z.string().nullable().optional(),
  currencyCode: z.string().length(3).default("SAR"),
  glAccountId: z.number().int(),
  openingBalance: z.number().default(0),
});

router.post("/accounting/bank-accounts", financeGuard, async (req, res) => {
  try {
    const body = createBankAccountBody.parse(req.body);
    const [row] = await db
      .insert(bankAccountsTable)
      .values({
        name: body.name,
        bankName: body.bankName,
        accountNumber: body.accountNumber,
        iban: body.iban ?? null,
        currencyCode: body.currencyCode,
        glAccountId: body.glAccountId,
        openingBalance: String(body.openingBalance),
      })
      .returning();
    return res.status(201).json({
      ...row,
      openingBalance: Number(row.openingBalance),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Create bank account failed");
    return res.status(400).json({ error: (err as Error).message });
  }
});

const importStatementBody = z.object({
  bankAccountId: z.number().int(),
  statementDate: z.string(),
  startingBalance: z.number(),
  endingBalance: z.number(),
  fileName: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        txDate: z.string(),
        description: z.string(),
        reference: z.string().nullable().optional(),
        amount: z.number(),
      }),
    )
    .min(1),
});

router.post(
  "/accounting/bank-statements",
  financeGuard,
  async (req, res) => {
    try {
      const body = importStatementBody.parse(req.body);
      const userId = req.session?.userId ?? null;

      const result = await db.transaction(async (tx) => {
        const [stmt] = await tx
          .insert(bankStatementsTable)
          .values({
            bankAccountId: body.bankAccountId,
            statementDate: body.statementDate,
            startingBalance: String(body.startingBalance),
            endingBalance: String(body.endingBalance),
            fileName: body.fileName ?? null,
            importedBy: userId,
          })
          .returning();
        for (const ln of body.lines) {
          await tx.insert(bankStatementLinesTable).values({
            statementId: stmt.id,
            txDate: ln.txDate,
            description: ln.description,
            reference: ln.reference ?? null,
            amount: String(ln.amount),
          });
        }
        return stmt;
      });
      return res.status(201).json({
        id: result.id,
        bankAccountId: result.bankAccountId,
        importedAt: result.importedAt.toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, "Import bank statement failed");
      return res.status(400).json({ error: (err as Error).message });
    }
  },
);

router.get(
  "/accounting/bank-statements/:id/reconciliation",
  reportReadGuard,
  async (req, res) => {
    try {
      const stmtId = Number(req.params.id);
      const [stmt] = await db
        .select()
        .from(bankStatementsTable)
        .where(eq(bankStatementsTable.id, stmtId))
        .limit(1);
      if (!stmt) return res.status(404).json({ error: "كشف الحساب غير موجود" });

      const lines = await db
        .select()
        .from(bankStatementLinesTable)
        .where(eq(bankStatementLinesTable.statementId, stmtId))
        .orderBy(asc(bankStatementLinesTable.txDate));

      // Find unreconciled JE lines on the bank's GL account in the statement window
      const [bank] = await db
        .select()
        .from(bankAccountsTable)
        .where(eq(bankAccountsTable.id, stmt.bankAccountId))
        .limit(1);

      const candidates = bank
        ? await db
            .select({
              id: journalEntryLinesTable.id,
              entryId: journalEntryLinesTable.entryId,
              entryNumber: journalEntriesTable.entryNumber,
              entryDate: journalEntriesTable.entryDate,
              description: journalEntriesTable.description,
              debit: journalEntryLinesTable.debit,
              credit: journalEntryLinesTable.credit,
            })
            .from(journalEntryLinesTable)
            .innerJoin(
              journalEntriesTable,
              eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
            )
            .where(
              and(
                eq(journalEntryLinesTable.accountId, bank.glAccountId),
                eq(journalEntriesTable.status, "posted"),
                // Exclude lines already matched on any statement line.
                sql`NOT EXISTS (
                  SELECT 1 FROM bank_statement_lines bsl
                   WHERE bsl.matched_line_id = ${journalEntryLinesTable.id}
                )`,
              ),
            )
            .orderBy(desc(journalEntriesTable.entryDate))
            .limit(200)
        : [];

      return res.json({
        statement: {
          ...stmt,
          startingBalance: Number(stmt.startingBalance),
          endingBalance: Number(stmt.endingBalance),
          importedAt: stmt.importedAt.toISOString(),
        },
        lines: lines.map((l) => ({
          ...l,
          amount: Number(l.amount),
          reconciledAt: l.reconciledAt?.toISOString() ?? null,
        })),
        candidates: candidates.map((c) => ({
          ...c,
          debit: Number(c.debit),
          credit: Number(c.credit),
          netAmount: Number(c.debit) - Number(c.credit),
        })),
      });
    } catch (err) {
      req.log.error({ err }, "Get reconciliation failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.post(
  "/accounting/bank-statement-lines/:id/match",
  financeGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const matchedLineId = Number(req.body?.matchedLineId);
      if (!matchedLineId)
        return res.status(400).json({ error: "matchedLineId مطلوب" });
      const userId = req.session?.userId ?? null;

      // Load the bank statement line + parent statement + bank account so we
      // can validate that the candidate JE line belongs to the right GL
      // account and matches the amount within a small tolerance.
      const [stmtLine] = await db
        .select()
        .from(bankStatementLinesTable)
        .where(eq(bankStatementLinesTable.id, id))
        .limit(1);
      if (!stmtLine) return res.status(404).json({ error: "السطر غير موجود" });

      const [stmt] = await db
        .select()
        .from(bankStatementsTable)
        .where(eq(bankStatementsTable.id, stmtLine.statementId))
        .limit(1);
      if (!stmt) return res.status(400).json({ error: "كشف الحساب غير صالح" });
      const [bank] = await db
        .select()
        .from(bankAccountsTable)
        .where(eq(bankAccountsTable.id, stmt.bankAccountId))
        .limit(1);
      if (!bank) return res.status(400).json({ error: "الحساب البنكي غير صالح" });

      const [candidate] = await db
        .select({
          id: journalEntryLinesTable.id,
          accountId: journalEntryLinesTable.accountId,
          debit: journalEntryLinesTable.debit,
          credit: journalEntryLinesTable.credit,
          status: journalEntriesTable.status,
        })
        .from(journalEntryLinesTable)
        .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
        .where(eq(journalEntryLinesTable.id, matchedLineId))
        .limit(1);
      if (!candidate)
        return res.status(404).json({ error: "قيد المطابقة غير موجود" });
      if (candidate.status !== "posted")
        return res.status(400).json({ error: "لا يمكن المطابقة بقيد غير مرحَّل" });
      if (candidate.accountId !== bank.glAccountId)
        return res
          .status(400)
          .json({ error: "حساب القيد لا يطابق الحساب البنكي" });

      const candidateNet = Number(candidate.debit) - Number(candidate.credit);
      const stmtAmount = Number(stmtLine.amount);
      if (Math.abs(candidateNet - stmtAmount) > 0.01)
        return res.status(400).json({
          error: `المبلغ غير متطابق: قيد ${candidateNet} ≠ كشف ${stmtAmount}`,
        });

      const [row] = await db
        .update(bankStatementLinesTable)
        .set({
          matchedLineId,
          reconciledAt: new Date(),
          reconciledBy: userId,
        })
        .where(eq(bankStatementLinesTable.id, id))
        .returning();
      if (!row) return res.status(404).json({ error: "السطر غير موجود" });
      return res.json({
        ...row,
        amount: Number(row.amount),
        reconciledAt: row.reconciledAt?.toISOString() ?? null,
      });
    } catch (err) {
      req.log.error({ err }, "Match bank line failed");
      return res.status(400).json({ error: (err as Error).message });
    }
  },
);

// ============== Summary & ZATCA ==============

router.get("/accounting/summary", reportReadGuard, async (req, res) => {
  try {
    // Cash & Bank balance from posted JE lines on system_key in (cash,bank)
    const balances = await db
      .select({
        systemKey: accountsTable.systemKey,
        netDebit: sql<string>`coalesce(sum(${journalEntryLinesTable.baseDebit}::numeric - ${journalEntryLinesTable.baseCredit}::numeric),0)`,
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
      .where(eq(journalEntriesTable.status, "posted"))
      .groupBy(accountsTable.systemKey);

    const byKey = (k: string) =>
      Number(balances.find((b) => b.systemKey === k)?.netDebit ?? 0);

    const cash = byKey("cash") + byKey("bank");
    const receivables = byKey("ar");
    const payables = -byKey("ap"); // AP is liability (credit balance), flip sign

    return res.json({
      netCashFlow: cash,
      cashFlowChange: 0,
      receivables,
      receivablesCount: 0,
      payables,
      avgPaymentDays: 0,
    });
  } catch (err) {
    req.log.error({ err }, "Accounting summary failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/accounting/zatca-status", reportReadGuard, async (_req, res) => {
  return res.json({
    connected: true,
    certExpiry: 290,
    lastSync: new Date().toISOString(),
  });
});

export default router;
