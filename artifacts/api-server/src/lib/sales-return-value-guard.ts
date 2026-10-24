import { and, eq, inArray, sql } from "drizzle-orm";
import { creditNoteLinesTable, creditNotesTable, customerInvoiceLinesTable, customerInvoicesTable } from "@workspace/db";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";
import { invoiceReturnBudgets, returnCents, returnQuantityUnits } from "./sales-return-value";

/** A final financial guard for new and old unissued notes. Never rewrites an issued invoice/note. */
export async function assertSavedReturnValue(
  tx: DbOrTx,
  note: typeof creditNotesTable.$inferSelect,
  lines: Array<typeof creditNoteLinesTable.$inferSelect>,
) {
  if (!note.invoiceId) return;
  const [invoice] = await tx.select().from(customerInvoicesTable).where(and(
    eq(customerInvoicesTable.id, note.invoiceId), eq(customerInvoicesTable.companyId, note.companyId),
  )).for("update");
  if (!invoice) throw new FinancialRequestError("الفاتورة المصدر غير موجودة", 409);
  const source = await tx.select().from(customerInvoiceLinesTable).where(eq(customerInvoiceLinesTable.invoiceId, invoice.id));
  const budgets = invoiceReturnBudgets(invoice, source);
  const scope = and(eq(creditNotesTable.companyId, note.companyId), eq(creditNotesTable.invoiceId, invoice.id),
    inArray(creditNotesTable.status, ["draft", "pending_approval", "issued", "applied"]));
  const [totals] = await tx.select({
    net: sql<string>`coalesce(sum(${creditNotesTable.subtotal}::numeric),0)`,
    vat: sql<string>`coalesce(sum(${creditNotesTable.vat}::numeric),0)`,
    total: sql<string>`coalesce(sum(${creditNotesTable.total}::numeric),0)`,
  }).from(creditNotesTable).where(scope);
  if (returnCents(totals.total) > returnCents(invoice.total)
    || returnCents(totals.vat) > returnCents(invoice.vat)
    || returnCents(totals.net) > returnCents(invoice.total) - returnCents(invoice.vat)
    || returnCents(note.subtotal) + returnCents(note.vat) !== returnCents(note.total)
    || lines.reduce((sum, l) => sum + returnCents(l.lineTotal), 0n) !== returnCents(note.total)) {
    throw new FinancialRequestError("قيمة المرتجع أو ضريبته تتجاوز صافي المصدر أو لا تتطابق مع بنوده؛ يلزم تصحيح المسودة قبل الإصدار", 409);
  }
  const reservations = await tx.select({
    id: creditNoteLinesTable.invoiceLineId,
    quantity: sql<string>`sum(${creditNoteLinesTable.quantity}::numeric)`,
    total: sql<string>`sum(${creditNoteLinesTable.lineTotal}::numeric)`,
  }).from(creditNoteLinesTable).innerJoin(creditNotesTable, eq(creditNotesTable.id, creditNoteLinesTable.noteId))
    .where(scope).groupBy(creditNoteLinesTable.invoiceLineId);
  for (const row of reservations) {
    if (row.id == null) continue; // Legacy non-stock financial adjustments remain bounded by invoice totals above.
    const budget = budgets.get(row.id);
    if (!budget || returnQuantityUnits(row.quantity) > budget.quantity || returnCents(row.total) > budget.total) {
      throw new FinancialRequestError("المرتجعات المحجوزة أو المرحلة تتجاوز صافي بند المصدر أو كميته", 409);
    }
  }
}
