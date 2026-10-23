import {
  db,
  posOrdersTable,
  customerInvoicesTable,
  customerInvoiceLinesTable,
  customersTable,
  journalEntriesTable,
  journalEntryLinesTable,
  accountsTable,
  companiesTable,
  pool,
} from "@workspace/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";

/**
 * ZATCA quarterly VAT-return period boundaries (UTC).
 *
 *   Q1 = Jan–Mar  → [year-01-01, year-04-01)
 *   Q2 = Apr–Jun  → [year-04-01, year-07-01)
 *   Q3 = Jul–Sep  → [year-07-01, year-10-01)
 *   Q4 = Oct–Dec  → [year-10-01, year+1-01-01)
 *
 * Returns half-open `[start, end)` so callers can do `>= start && < end`
 * without any DST / boundary-overlap surprises.
 */
export function quarterRangeUTC(
  year: number,
  quarter: 1 | 2 | 3 | 4,
): { start: Date; end: Date } {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, startMonth + 3, 1, 0, 0, 0, 0));
  return { start, end };
}

export interface VatReturnSupplySplit {
  /** Net sales at the standard 15% rate. */
  standardRated: number;
  /** Net sales explicitly invoiced at 0% (zero-rated). */
  zeroRated: number;
  /** Sales tagged as exempt (no taxRate metadata available → always 0 today). */
  exempt: number;
}

export interface VatReturn {
  timezone?: "UTC" | "Asia/Riyadh";
  branchLabel?: string;
  companyId: number;
  companyName: string;
  vatNumber: string | null;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  periodStart: string; // ISO date (yyyy-mm-dd)
  periodEnd: string; // ISO date (yyyy-mm-dd) inclusive last day of quarter
  /** Net taxable supplies split by tax rate (sales side). */
  supplies: VatReturnSupplySplit;
  /** Sum of output VAT actually charged on sales in the period. */
  outputVat: {
    pos: number;
    customerInvoices: number;
    total: number;
  };
  /** Sum of input VAT recoverable in the period (supplier invoices + manual adjustments via vat_input GL). */
  inputVat: {
    /** Debits to the `vat_input` GL account in the period. */
    fromJournals: number;
    total: number;
  };
  /** Net payable to ZATCA (output − input). Negative = refundable. */
  netPayable: number;
  generatedAt: string;
}

const num = (v: string | null | undefined): number => Number(v ?? "0");

/**
 * Compute a single quarter's VAT return for one tenant. All sums are
 * SAR and rounded to 2 dp. Pure read-only — safe to call repeatedly.
 *
 * Source mix:
 *   - Output VAT: `pos_orders.tax` + `customer_invoices.vat`
 *     (manual/SO invoices only; POS-origin invoices skipped to avoid
 *      double-counting the POS half).
 *   - Input VAT: debits on the `vat_input` GL account from POSTED
 *     journal entries dated in the period. This naturally captures
 *     supplier-invoice VAT AND any manual VAT-input adjustments.
 *   - Standard/zero/exempt split from `customer_invoice_lines.tax_rate`
 *     (>0 → standard, =0 → zero) plus POS subtotals (always standard).
 */
export async function computeVatReturn(
  companyId: number,
  year: number,
  quarter: 1 | 2 | 3 | 4,
  options: { timezone?: "UTC" | "Asia/Riyadh" } = {},
): Promise<VatReturn> {
  return db.transaction(async(db)=>{
  const raw = quarterRangeUTC(year, quarter);
  const offset = options.timezone === "Asia/Riyadh" ? 3 * 60 * 60 * 1000 : 0;
  const start = new Date(raw.start.getTime()-offset), end = new Date(raw.end.getTime()-offset);

  const [co] = await db
    .select({
      name: companiesTable.name,
      vatNumber: companiesTable.vatNumber,
      currency: companiesTable.baseCurrency,
    })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!co) {
    throw new Error(`vat-return: company #${companyId} not found`);
  }
  if(co.currency!=="SAR") throw new Error("VAT_REPORT_INCOMPLETE");

  // ---- POS half (output VAT + standard-rated supplies) ----
  const [posRow] = await db
    .select({
      tax: sql<string>`COALESCE(SUM(${posOrdersTable.tax}), 0)::text`,
      net: sql<string>`COALESCE(SUM(${posOrdersTable.subtotal} - ${posOrdersTable.discount}), 0)::text`,
    })
    .from(posOrdersTable)
    .where(
      and(
        eq(posOrdersTable.companyId, companyId),
        gte(posOrdersTable.createdAt, start),
        lt(posOrdersTable.createdAt, end),
      ),
    );

  // ---- Customer-invoice half (output VAT, excluding POS mirrors) ----
  const periodStartStr = raw.start.toISOString().slice(0, 10);
  const periodEndExclusiveStr = raw.end.toISOString().slice(0, 10);
  const standaloneInvoice=sql`${customerInvoicesTable.source} <> 'pos' AND NOT EXISTS (
    SELECT 1 FROM sales_orders so WHERE so.id=${customerInvoicesTable.soId}
    AND so.company_id=${customerInvoicesTable.companyId} AND so.source='pos')`;

  const [invRow] = await db
    .select({
      vat: sql<string>`COALESCE(SUM(${customerInvoicesTable.vat}), 0)::text`,
    })
    .from(customerInvoicesTable)
    .innerJoin(
      customersTable,
      eq(customersTable.id, customerInvoicesTable.customerId),
    )
    .where(
      and(
        eq(customersTable.companyId, companyId),
        gte(customerInvoicesTable.invoiceDate, periodStartStr),
        lt(customerInvoicesTable.invoiceDate, periodEndExclusiveStr),
        sql`${customerInvoicesTable.status} IN ('open','partially_paid','paid')`,
        standaloneInvoice,
      ),
    );

  // ---- Customer-invoice line split (standard vs zero-rated) ----
  const lineRows = await db
    .select({
      taxRate: customerInvoiceLinesTable.taxRate,
      lineTotal: sql<string>`COALESCE(SUM(${customerInvoiceLinesTable.lineTotal}), 0)::text`,
    })
    .from(customerInvoiceLinesTable)
    .innerJoin(
      customerInvoicesTable,
      eq(customerInvoicesTable.id, customerInvoiceLinesTable.invoiceId),
    )
    .innerJoin(
      customersTable,
      eq(customersTable.id, customerInvoicesTable.customerId),
    )
    .where(
      and(
        eq(customersTable.companyId, companyId),
        gte(customerInvoicesTable.invoiceDate, periodStartStr),
        lt(customerInvoicesTable.invoiceDate, periodEndExclusiveStr),
        sql`${customerInvoicesTable.status} IN ('open','partially_paid','paid')`,
        standaloneInvoice,
      ),
    )
    .groupBy(customerInvoiceLinesTable.taxRate);

  let standardInvoiceNet = 0;
  let zeroRatedInvoiceNet = 0;
  for (const r of lineRows) {
    const total = num(r.lineTotal);
    if (Number(r.taxRate) > 0) standardInvoiceNet += total;
    else zeroRatedInvoiceNet += total;
  }

  // ---- Input VAT from GL (supplier invoices + adjustments) ----
  const [vatInputRow] = await db
    .select({
      debit: sql<string>`COALESCE(SUM(${journalEntryLinesTable.baseDebit} - ${journalEntryLinesTable.baseCredit}), 0)::text`,
    })
    .from(journalEntryLinesTable)
    .innerJoin(
      journalEntriesTable,
      eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
    )
    .innerJoin(
      accountsTable,
      eq(accountsTable.id, journalEntryLinesTable.accountId),
    )
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(accountsTable.systemKey, "vat_input"),
        eq(journalEntriesTable.status, "posted"),
        gte(journalEntriesTable.entryDate, periodStartStr),
        lt(journalEntriesTable.entryDate, periodEndExclusiveStr),
      ),
    );

  const incomplete=await db.execute(sql`SELECT 1 FROM customer_invoices WHERE company_id=${companyId} AND invoice_date >= ${periodStartStr} AND invoice_date < ${periodEndExclusiveStr}
    AND status IN ('open','paid','partially_paid') AND currency_code <> 'SAR'
    UNION ALL SELECT 1 FROM credit_notes WHERE company_id=${companyId} AND note_date >= ${periodStartStr} AND note_date < ${periodEndExclusiveStr}
    AND status IN ('issued','applied') AND currency_code <> 'SAR' LIMIT 1`);
  if(incomplete.rows.length) throw new Error("VAT_REPORT_INCOMPLETE");
  const {rows:returned}=await db.execute(sql`SELECT
    COALESCE(SUM(CASE WHEN i.source='pos' OR so.source='pos' THEN n.vat ELSE 0 END),0)::text AS pos,
    COALESCE(SUM(CASE WHEN i.source='pos' OR so.source='pos' THEN 0 ELSE n.vat END),0)::text AS other
    FROM credit_notes n LEFT JOIN customer_invoices i ON i.id=n.invoice_id AND i.company_id=n.company_id
    LEFT JOIN sales_orders so ON so.id=i.so_id AND so.company_id=i.company_id
    WHERE n.company_id=${companyId} AND n.note_date >= ${periodStartStr} AND n.note_date < ${periodEndExclusiveStr} AND n.status IN ('issued','applied')`);
  const {rows:returnedNet}=await db.execute(sql`SELECT
    COALESCE(SUM(CASE WHEN l.tax_rate>0 THEN l.line_total ELSE 0 END),0)::text AS standard,
    COALESCE(SUM(CASE WHEN l.tax_rate=0 THEN l.line_total ELSE 0 END),0)::text AS zero
    FROM credit_notes n JOIN credit_note_lines l ON l.note_id=n.id
    WHERE n.company_id=${companyId} AND n.note_date >= ${periodStartStr} AND n.note_date < ${periodEndExclusiveStr} AND n.status IN ('issued','applied')`);
  const posTax = round2(num(posRow?.tax)-Number(returned[0]?.pos??0));
  const posNet = round2(num(posRow?.net));
  const invoiceVat = round2(num(invRow?.vat)-Number(returned[0]?.other??0));
  const inputVatJournals = round2(num(vatInputRow?.debit));

  const outputTotal = round2(posTax + invoiceVat);
  const inputTotal = round2(inputVatJournals);
  const netPayable = round2(outputTotal - inputTotal);

  // Periods displayed inclusive of last day (e.g. Q1 = Mar 31, not Apr 1).
  const lastDay = new Date(raw.end.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return {
    companyId,
    timezone: options.timezone ?? "UTC",
    branchLabel: "جميع فروع الشركة",
    companyName: co.name,
    vatNumber: co.vatNumber ?? null,
    year,
    quarter,
    periodStart: periodStartStr,
    periodEnd: lastDay,
    supplies: {
      standardRated: round2(posNet + standardInvoiceNet-Number(returnedNet[0]?.standard??0)),
      zeroRated: round2(zeroRatedInvoiceNet-Number(returnedNet[0]?.zero??0)),
      exempt: 0,
    },
    outputVat: {
      pos: posTax,
      customerInvoices: invoiceVat,
      total: outputTotal,
    },
    inputVat: {
      fromJournals: inputVatJournals,
      total: inputTotal,
    },
    netPayable,
    generatedAt: new Date().toISOString(),
  };
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
