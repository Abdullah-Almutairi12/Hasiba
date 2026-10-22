import { db, accountsTable, fiscalPeriodsTable, journalEntriesTable, journalEntryLinesTable, exchangeRatesTable, currenciesTable } from "@workspace/db";
import { fiscalPeriodScope } from "./finance-scope";
import { and, eq, lte, gte, sql, desc } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

export type DbOrTx = typeof db | PgTransaction<any, any, any>;

export interface PostingLineInput {
  accountId?: number;
  accountCode?: string;   // alternative lookup
  systemKey?: string;     // alternative lookup (e.g. "cash", "ap")
  description?: string | null;
  debit?: number;
  credit?: number;
}

export interface PostingHeaderInput {
  entryDate: Date | string;
  description: string;
  reference?: string | null;
  currencyCode?: string;
  exchangeRate?: number;
  source?: "manual" | "pos" | "supplier_invoice" | "payment" | "bank" | "system" | "fx_revaluation" | "period_close";
  sourceRef?: string | null;
  createdBy?: number | null;
  status?: "draft" | "posted";
  /**
   * Tenant the entry belongs to. Required for Multi-Company Phase 2 —
   * journal_entries.company_id is NOT NULL. Callers must source this from
   * `getCompanyId(req)` (or pass it through their existing companyId arg).
   */
  companyId: number;
}

const EPSILON = 0.005;

async function resolveAccount(
  tx: DbOrTx,
  line: PostingLineInput,
): Promise<number> {
  if (line.accountId) return line.accountId;
  if (line.systemKey) {
    const [a] = await tx
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(eq(accountsTable.systemKey, line.systemKey))
      .limit(1);
    if (a) return a.id;
    throw new Error(`No account with systemKey="${line.systemKey}"`);
  }
  if (line.accountCode) {
    const [a] = await tx
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(eq(accountsTable.code, line.accountCode))
      .limit(1);
    if (a) return a.id;
    throw new Error(`No account with code="${line.accountCode}"`);
  }
  throw new Error("Posting line missing accountId/accountCode/systemKey");
}

/**
 * Thrown when an entry hits a closed/locked fiscal period. Carries the
 * exact Arabic message required by the closing-controls task so routes
 * can surface a consistent **403** to clients (e.g. journal-entry create,
 * post, and the invoice-from-scan flow).
 */
export class ClosedPeriodError extends Error {
  constructor(public readonly dateStr: string) {
    super("الفترة مُغلقة لا يمكن التعديل");
    this.name = "ClosedPeriodError";
  }
}

async function resolvePeriodId(
  tx: DbOrTx,
  d: Date,
  companyId: number,
): Promise<number> {
  const dateStr = d.toISOString().slice(0, 10);
  // When monthly AND annual periods both cover a date, pick the most
  // specific one (shortest span). This lets us safely seed an annual
  // fiscal_periods row alongside the 12 monthly ones without breaking
  // date resolution.
  const [p] = await tx
    .select({ id: fiscalPeriodsTable.id, status: fiscalPeriodsTable.status })
    .from(fiscalPeriodsTable)
    .where(
      and(
        fiscalPeriodScope(companyId),
        lte(fiscalPeriodsTable.startDate, dateStr),
        gte(fiscalPeriodsTable.endDate, dateStr),
      ),
    )
    .orderBy(
      sql`${fiscalPeriodsTable.endDate}::date - ${fiscalPeriodsTable.startDate}::date ASC`,
    )
    .limit(1);
  if (!p) {
    throw new Error(
      `لا توجد فترة مالية مفتوحة تغطي تاريخ ${dateStr}. يجب إنشاء السنة/الفترة المالية أولاً.`,
    );
  }
  if (p.status === "closed" || p.status === "locked") {
    throw new ClosedPeriodError(dateStr);
  }
  return p.id;
}

async function nextEntryNumber(tx: DbOrTx, year: number): Promise<string> {
  // Use a per-year PostgreSQL sequence so concurrent posts cannot collide.
  // The sequence is created lazily on first use; nextval is atomic and
  // never returns the same value to two sessions.
  const seqName = `journal_entries_seq_${year}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sequence:${seqName}`}, 0)) WHERE to_regclass(${seqName}) IS NULL`);
  const prefix = `JE-${year}-`;
  await tx.execute(
    sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${seqName} MINVALUE 1 START 1`),
  );

  // Self-heal: after seed/restore/migration, the sequence can fall behind
  // existing JE-YYYY-NNNNN rows. Bump it to max(existing) so the next
  // nextval returns a fresh, non-colliding number.
  const healSql = `
    DO $$
    DECLARE
      max_n bigint;
      cur_n bigint;
      was_called boolean;
    BEGIN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(entry_number, '^${prefix}', ''), '')::bigint), 0)
        INTO max_n
        FROM journal_entries
        WHERE entry_number LIKE '${prefix}%';
      SELECT last_value, is_called INTO cur_n, was_called FROM ${seqName};
      IF max_n > cur_n OR (max_n = cur_n AND NOT was_called) THEN
        PERFORM setval('${seqName}', max_n, true);
      END IF;
    END $$;
  `;
  await tx.execute(sql.raw(healSql));

  const r = await tx.execute(sql.raw(`SELECT nextval('${seqName}')::bigint AS n`));
  // node-postgres returns rows on .rows; drizzle wraps but exposes them too.
  const rows = (r as unknown as { rows?: Array<{ n: string | number }> }).rows
    ?? (r as unknown as Array<{ n: string | number }>);
  const seq = Number(rows?.[0]?.n ?? 1);
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

/**
 * Create a balanced journal entry. Throws if debits != credits.
 * Resolves accounts via systemKey / code if accountId is missing.
 * Resolves the fiscal period from entry date and refuses closed periods.
 *
 * Default status is "posted" — pass status: "draft" to leave it unposted.
 * All input line amounts are in header.currencyCode; base amounts are derived
 * exactly once here. Callers combining foreign commercial amounts with SAR
 * inventory costs must express those costs in the header currency first.
 */
export async function postJournalEntry(
  tx: DbOrTx,
  header: PostingHeaderInput,
  lines: PostingLineInput[],
): Promise<{ id: number; entryNumber: string }> {
  if (lines.length < 2) throw new Error("القيد يجب أن يحتوي على سطرين على الأقل");

  const currencyCode = header.currencyCode ?? "SAR";
  const exchangeRate = header.exchangeRate ?? 1;
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new Error("سعر الصرف يجب أن يكون رقماً موجباً صالحاً");
  }

  let totalDebit = 0;
  let totalCredit = 0;
  for (const ln of lines) {
    const d = Number(ln.debit ?? 0);
    const c = Number(ln.credit ?? 0);
    if (!Number.isFinite(d) || !Number.isFinite(c)) throw new Error("قيم القيد يجب أن تكون أرقاماً صالحة");
    if (d > 0 && c > 0) throw new Error("سطر القيد لا يجوز أن يحتوي على مدين ودائن معاً");
    if (d < 0 || c < 0) throw new Error("القيم السالبة غير مسموحة");
    totalDebit += d;
    totalCredit += c;
  }
  if (Math.abs(totalDebit - totalCredit) > EPSILON) {
    throw new Error(`القيد غير متوازن: المدين=${totalDebit.toFixed(2)} الدائن=${totalCredit.toFixed(2)}`);
  }
  if (totalDebit < EPSILON) throw new Error("لا يمكن ترحيل قيد بمبلغ صفر");

  const entryDate = new Date(header.entryDate);
  const dateStr = entryDate.toISOString().slice(0, 10);
  const periodId = await resolvePeriodId(tx, entryDate, header.companyId);
  const status = header.status ?? "posted";
  const entryNumber = await nextEntryNumber(tx, entryDate.getUTCFullYear());

  const [entry] = await tx
    .insert(journalEntriesTable)
    .values({
      entryNumber,
      entryDate: dateStr,
      periodId,
      description: header.description,
      reference: header.reference ?? null,
      currencyCode,
      exchangeRate: String(exchangeRate),
      status,
      source: header.source ?? "manual",
      sourceRef: header.sourceRef ?? null,
      createdBy: header.createdBy ?? null,
      postedBy: status === "posted" ? header.createdBy ?? null : null,
      postedAt: status === "posted" ? new Date() : null,
      companyId: header.companyId,
    })
    .returning();

  // Resolve accounts and insert lines
  let lineNumber = 1;
  for (const ln of lines) {
    const accountId = await resolveAccount(tx, ln);
    const debit = Number(ln.debit ?? 0);
    const credit = Number(ln.credit ?? 0);
    await tx.insert(journalEntryLinesTable).values({
      entryId: entry.id,
      lineNumber: lineNumber++,
      accountId,
      description: ln.description ?? null,
      debit: String(debit),
      credit: String(credit),
      baseDebit: String(debit * exchangeRate),
      baseCredit: String(credit * exchangeRate),
    });
  }

  return { id: entry.id, entryNumber: entry.entryNumber };
}

/**
 * Look up the active exchange rate for a given currency on a given date.
 * Falls back to the most recent rate if no exact-date match.
 * Returns 1 for the base currency (SAR).
 */
export async function getRateForDate(
  tx: DbOrTx,
  currencyCode: string,
  d: Date,
): Promise<number> {
  if (currencyCode === "SAR") return 1;
  const dateStr = d.toISOString().slice(0, 10);
  const [exact] = await tx
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
  const [latest] = await tx
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
  if (latest) return Number(latest.rate);
  // Hard error: refuse to post non-base currency entries without an FX rate
  // to avoid silently corrupting the base-currency books with rate=1.
  throw new Error(
    `لا يوجد سعر صرف للعملة ${currencyCode} بتاريخ ${dateStr}. يرجى إدخال سعر الصرف أولاً.`,
  );
}

/**
 * Reverse a posted entry by creating a balancing reverse entry.
 * The original stays `posted` (with `reversedAt`/`reversedBy` metadata)
 * so reports include both the original and its reversal — net effect is
 * zero. Changing the original to status='reversed' would cause reports
 * (which filter on status='posted') to drop the original while keeping
 * the reversal, producing the negative of the original transaction.
 */
export async function reverseJournalEntry(
  tx: DbOrTx,
  entryId: number,
  userId: number | null,
  reason?: string,
): Promise<{ id: number; entryNumber: string }> {
  const [orig] = await tx
    .select()
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.id, entryId))
    .limit(1);
  if (!orig) throw new Error("القيد غير موجود");
  if (orig.status !== "posted") throw new Error("لا يمكن عكس قيد غير مرحَّل");

  const lines = await tx
    .select()
    .from(journalEntryLinesTable)
    .where(eq(journalEntryLinesTable.entryId, entryId));

  const reverseDate = new Date();
  const dateStr = reverseDate.toISOString().slice(0, 10);
  const periodId = await resolvePeriodId(tx, reverseDate, orig.companyId);
  const entryNumber = await nextEntryNumber(tx, reverseDate.getUTCFullYear());

  const [rev] = await tx
    .insert(journalEntriesTable)
    .values({
      entryNumber,
      entryDate: dateStr,
      periodId,
      description: `عكس القيد ${orig.entryNumber}${reason ? ` — ${reason}` : ""}`,
      reference: orig.reference,
      currencyCode: orig.currencyCode,
      exchangeRate: orig.exchangeRate,
      status: "posted",
      source: "system",
      sourceRef: `REVERSE-${orig.id}`,
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      reversalOf: orig.id,
      // Reversals always stay inside the same tenant as the original.
      companyId: orig.companyId,
    })
    .returning();

  let lineNumber = 1;
  for (const ln of lines) {
    await tx.insert(journalEntryLinesTable).values({
      entryId: rev.id,
      lineNumber: lineNumber++,
      accountId: ln.accountId,
      description: ln.description,
      debit: ln.credit,   // swap
      credit: ln.debit,
      baseDebit: ln.baseCredit,
      baseCredit: ln.baseDebit,
    });
  }

  await tx
    .update(journalEntriesTable)
    .set({ reversedBy: userId, reversedAt: new Date() })
    .where(eq(journalEntriesTable.id, orig.id));

  return { id: rev.id, entryNumber: rev.entryNumber };
}

// Re-export for convenience
export { currenciesTable };
