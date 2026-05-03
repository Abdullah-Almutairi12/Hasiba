import { db, accountsTable, fiscalPeriodsTable, journalEntriesTable, journalEntryLinesTable, exchangeRatesTable, currenciesTable } from "@workspace/db";
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

async function resolvePeriodId(
  tx: DbOrTx,
  d: Date,
): Promise<number> {
  const dateStr = d.toISOString().slice(0, 10);
  const [p] = await tx
    .select({ id: fiscalPeriodsTable.id, status: fiscalPeriodsTable.status })
    .from(fiscalPeriodsTable)
    .where(
      and(
        lte(fiscalPeriodsTable.startDate, dateStr),
        gte(fiscalPeriodsTable.endDate, dateStr),
      ),
    )
    .limit(1);
  if (!p) {
    // Fail closed: never allow a posted/draft entry that has no governing
    // fiscal period — it would be a permanent gap in closing controls.
    throw new Error(
      `لا توجد فترة مالية مفتوحة تغطي تاريخ ${dateStr}. يجب إنشاء السنة/الفترة المالية أولاً.`,
    );
  }
  if (p.status === "closed" || p.status === "locked") {
    throw new Error(`الفترة المالية مغلقة لتاريخ ${dateStr}`);
  }
  return p.id;
}

async function nextEntryNumber(tx: DbOrTx, year: number): Promise<string> {
  const prefix = `JE-${year}-`;
  const [last] = await tx
    .select({ entryNumber: journalEntriesTable.entryNumber })
    .from(journalEntriesTable)
    .where(sql`${journalEntriesTable.entryNumber} LIKE ${prefix + "%"}`)
    .orderBy(desc(journalEntriesTable.id))
    .limit(1);
  let seq = 1;
  if (last) {
    const tail = last.entryNumber.slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

/**
 * Create a balanced journal entry. Throws if debits != credits.
 * Resolves accounts via systemKey / code if accountId is missing.
 * Resolves the fiscal period from entry date and refuses closed periods.
 *
 * Default status is "posted" — pass status: "draft" to leave it unposted.
 */
export async function postJournalEntry(
  tx: DbOrTx,
  header: PostingHeaderInput,
  lines: PostingLineInput[],
): Promise<{ id: number; entryNumber: string }> {
  if (lines.length < 2) throw new Error("القيد يجب أن يحتوي على سطرين على الأقل");

  const currencyCode = header.currencyCode ?? "SAR";
  const exchangeRate = header.exchangeRate ?? 1;

  let totalDebit = 0;
  let totalCredit = 0;
  for (const ln of lines) {
    const d = Number(ln.debit ?? 0);
    const c = Number(ln.credit ?? 0);
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
  const periodId = await resolvePeriodId(tx, entryDate);
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
 * Original entry is marked as "reversed" and linked.
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
  const periodId = await resolvePeriodId(tx, reverseDate);
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
    .set({ status: "reversed", reversedBy: userId, reversedAt: new Date() })
    .where(eq(journalEntriesTable.id, orig.id));

  return { id: rev.id, entryNumber: rev.entryNumber };
}

// Re-export for convenience
export { currenciesTable };
