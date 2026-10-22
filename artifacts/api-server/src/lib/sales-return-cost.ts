import { sql } from "drizzle-orm";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";
import { recordStockMove } from "./stock-engine";
import { salesIssueAllocationsTable } from "@workspace/db";

type ReturnLine = { invoiceLineId: number | null; productId: number | null; quantity: string | number };
type ReturnInput = {
  companyId: number; invoiceId: number | null; noteId: number | null;
  warehouseId: number; reference: string; createdBy: number | null;
  lines: ReturnLine[]; validateOnly?: boolean;
};
const fail = () => new FinancialRequestError(
  "تعذر إثبات تكلفة الصرف الأصلية للمرتجع؛ يلزم بند فاتورة مرتبط بحركة صرف موثقة. لم يتم تغيير المخزون.", 409,
);

/**
 * Called inside SO invoicing, with the parent SO locked. Allocate delivered
 * units once, at invoice creation, not when a later return happens. Original
 * allocations remain audit evidence after reversal; only an explicit invoice
 * reversal releases their billing capacity (a return requires new delivery).
 */
export async function allocateDeliveryIssueCost(
  tx: DbOrTx,
  input: { companyId: number; invoiceLineId: number; soLineId: number; productId: number; quantity: number },
): Promise<void> {
  const result = await tx.execute(sql`
    SELECT m.id, m.quantity::float8 AS quantity, m.unit_cost::float8 AS cost
      FROM stock_moves m
      JOIN products p ON p.id = m.product_id
      JOIN sales_order_lines sl ON sl.id = m.source_id
      JOIN sales_orders so ON so.id = sl.so_id
     WHERE m.source_type = 'delivery_order' AND m.source_id = ${input.soLineId}
       AND m.kind = 'issue' AND m.state = 'done' AND m.product_id = ${input.productId}
       AND p.company_id = ${input.companyId} AND so.company_id = ${input.companyId}
       AND sl.product_id = m.product_id
     ORDER BY m.id FOR UPDATE OF m
  `);
  let remaining = input.quantity;
  for (const move of result.rows as Array<{ id: number; quantity: number; cost: number }>) {
    const used = await tx.execute(sql`
      SELECT coalesce(sum(a.quantity), 0)::float8 AS quantity
        FROM sales_issue_allocations a
        JOIN customer_invoice_lines il ON il.id = a.invoice_line_id
        JOIN customer_invoices i ON i.id = il.invoice_id
       WHERE a.issue_move_id = ${move.id} AND i.company_id = ${input.companyId}
         AND i.reversed_by_id IS NULL
    `);
    const take = Math.min(remaining, Math.max(0, move.quantity - Number(used.rows[0].quantity)));
    if (take <= 0) continue;
    if (!Number.isFinite(move.cost) || move.cost < 0) throw fail();
    await tx.insert(salesIssueAllocationsTable).values({
      invoiceLineId: input.invoiceLineId, issueMoveId: move.id,
      quantity: String(take), unitCost: String(move.cost),
    });
    remaining -= take;
    if (remaining <= 1e-6) return;
  }
  throw new FinancialRequestError("تعذر تخصيص تكلفة التسليم الأصلية لبند الفاتورة؛ لا توجد كمية صرف موثقة غير مفوترة كافية.", 409);
}

/**
 * Reverse the recorded base-currency issue cost, never today's product price
 * or exchange rate. A partial return takes units from issue moves oldest first.
 * Within one weighted FIFO issue, units share that issue's recorded unit cost.
 */
export async function restoreOriginalSaleCost(tx: DbOrTx, input: ReturnInput): Promise<number> {
  let value = 0;
  let restored = false;
  const allocated = new Map<string, number>();
  for (const line of input.lines) {
    if (!line.productId) continue;
    if (!input.invoiceId || !line.invoiceLineId) throw fail();
    const result = await tx.execute(sql`
      SELECT m.id, coalesce(a.quantity, m.quantity)::float8 AS quantity,
             coalesce(a.unit_cost, m.unit_cost)::float8 AS cost,
             m.variant_id, m.lot_id, m.serial_id
        FROM stock_moves m
        JOIN customer_invoice_lines il ON il.id = ${line.invoiceLineId}
        JOIN customer_invoices i ON i.id = il.invoice_id
        LEFT JOIN sales_issue_allocations a ON a.issue_move_id = m.id AND a.invoice_line_id = il.id
       WHERE il.id = ${line.invoiceLineId} AND i.id = ${input.invoiceId}
         AND i.company_id = ${input.companyId} AND il.product_id = ${line.productId}
         AND m.product_id = il.product_id AND m.kind = 'issue' AND m.state = 'done'
         AND (m.invoice_line_id = il.id OR a.id IS NOT NULL)
         AND i.reversed_by_id IS NULL AND i.reverses_id IS NULL
       ORDER BY m.id FOR UPDATE OF m
    `);
    const moves = result.rows as Array<{
      id: number; quantity: number; cost: number;
      variant_id: number | null; lot_id: number | null; serial_id: number | null;
    }>;
    let remaining = Number(line.quantity);
    for (const move of moves) {
      const used = await tx.execute(sql`
        SELECT coalesce(sum(r.quantity), 0)::float8 AS quantity
          FROM stock_moves r
          JOIN credit_notes cn ON cn.id = r.source_id
         WHERE r.original_move_id = ${move.id} AND r.kind = 'return_in'
           AND r.invoice_line_id = ${line.invoiceLineId}
           AND r.state = 'done' AND r.source_type = 'credit_note'
           AND cn.company_id = ${input.companyId} AND cn.status <> 'cancelled'
      `);
      const allocationKey = `${line.invoiceLineId}:${move.id}`;
      const available = move.quantity - Number(used.rows[0].quantity) - (allocated.get(allocationKey) ?? 0);
      const take = Math.min(remaining, Math.max(0, available));
      if (take <= 0) continue;
      if (!Number.isFinite(move.cost) || move.cost < 0) throw fail();
      if (!input.validateOnly) {
        await recordStockMove(tx, {
          companyId: input.companyId, productId: line.productId,
          quantity: take, unitCost: move.cost, kind: "return_in",
          toWarehouseId: input.warehouseId, variantId: move.variant_id,
          lotId: move.lot_id, serialId: move.serial_id,
          invoiceLineId: line.invoiceLineId, originalMoveId: move.id,
          sourceType: "credit_note", sourceId: input.noteId, sourceRef: input.reference,
          createdBy: input.createdBy, skipJournal: true,
        });
        restored = true;
      } else {
        allocated.set(allocationKey, (allocated.get(allocationKey) ?? 0) + take);
      }
      value += take * move.cost;
      remaining -= take;
      if (remaining <= 1e-6) break;
    }
    if (remaining > 1e-6) throw fail();
  }
  if (input.validateOnly || !restored) return value;
  // Quantities/layers retain the unrounded historical unit cost. GL amounts
  // are cents: round the cumulative physical return value, not each credit
  // independently, and subtract what active credits actually posted. Reading
  // actual journals also handles cancellation of an earlier rounded slice.
  // The caller holds the invoice lock until this credit's journal is posted.
  const cumulative = await tx.execute(sql`
    SELECT
      round(coalesce((
        SELECT sum(r.quantity * r.unit_cost)
          FROM stock_moves r JOIN credit_notes cn ON cn.id = r.source_id
         WHERE cn.invoice_id = ${input.invoiceId} AND cn.company_id = ${input.companyId}
           AND cn.status <> 'cancelled' AND r.kind = 'return_in' AND r.state = 'done'
           AND r.source_type = 'credit_note' AND r.original_move_id IS NOT NULL
      ), 0), 2) - coalesce((
        SELECT sum(l.base_debit - l.base_credit)
          FROM credit_notes cn
          JOIN journal_entries j ON j.id = cn.journal_entry_id AND j.company_id = cn.company_id
          JOIN journal_entry_lines l ON l.entry_id = j.id
          JOIN accounts a ON a.id = l.account_id AND a.system_key = 'inventory'
         WHERE cn.invoice_id = ${input.invoiceId} AND cn.company_id = ${input.companyId}
           AND cn.status <> 'cancelled' AND j.status = 'posted'
      ), 0) - coalesce((
        SELECT sum(cn.cancellation_rounding) FROM credit_notes cn
         WHERE cn.invoice_id = ${input.invoiceId} AND cn.company_id = ${input.companyId}
           AND cn.status = 'cancelled'
      ), 0) AS value
  `);
  return Number(cumulative.rows[0].value);
}

/** Commercial reversal uses the original invoice's posted rate (not today's).
 * Inventory cost is already in SAR and must not be converted a second time.
 */
export async function originalInvoiceRate(
  tx: DbOrTx, companyId: number, invoiceId: number | null, currencyCode: string,
): Promise<number> {
  if (!invoiceId) {
    if (currencyCode === "SAR") return 1;
    throw fail();
  }
  const invoice = await tx.execute(sql`
    SELECT currency_code, reversed_by_id, reverses_id FROM customer_invoices
     WHERE id = ${invoiceId} AND company_id = ${companyId}
  `);
  if (invoice.rows[0]?.currency_code !== currencyCode) throw fail();
  if (invoice.rows[0].reversed_by_id || invoice.rows[0].reverses_id)
    throw new FinancialRequestError("لا يمكن إرجاع فاتورة معكوسة أو فاتورة عكسية", 409);
  if (currencyCode === "SAR") return 1;
  const result = await tx.execute(sql`
    SELECT j.exchange_rate::float8 AS rate
      FROM customer_invoices i JOIN journal_entries j
        ON j.company_id = i.company_id AND j.reference = i.reference
       AND j.currency_code = i.currency_code AND j.status = 'posted'
     WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}
       AND i.currency_code = ${currencyCode}
  `);
  if (result.rows.length !== 1) throw fail();
  const rate = Number(result.rows[0].rate);
  if (!Number.isFinite(rate) || rate <= 0) throw fail();
  return rate;
}
