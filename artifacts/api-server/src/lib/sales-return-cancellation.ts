import { eq, sql } from "drizzle-orm";
import { FinancialRequestError } from "./financial-transaction";
import { postJournalEntry, reverseJournalEntry, type DbOrTx } from "./journal-posting";
import { recordStockMove } from "./stock-engine";
import { creditNotesTable } from "@workspace/db";

const fail = () => new FinancialRequestError(
  "تعذر إثبات تكلفة المرتجع وقيده الأصلي لإلغائه بأمان؛ يلزم فحص مالي مستقل دون إصلاح تلقائي.", 409,
);

/** The caller holds the credit note and parent invoice locks. All effects
 * (exact historical reversal + current carrying-cost difference) are atomic.
 */
export async function cancelPostedSalesReturn(
  tx: DbOrTx,
  note: {
    id: number; companyId: number; journalEntryId: number | null;
    restock: boolean; warehouseId: number | null; reference: string;
    currencyCode: string;
    inventoryCost: string | null;
  },
  lines: Array<{ productId: number | null; invoiceLineId: number | null; quantity: string }>,
  userId: number | null,
): Promise<void> {
  if (!note.journalEntryId) throw fail();
  const journal = await tx.execute(sql`
    SELECT id, currency_code, exchange_rate::float8 AS rate, status, reversed_at
      FROM journal_entries WHERE id=${note.journalEntryId} AND company_id=${note.companyId}
      FOR UPDATE
  `);
  const original = journal.rows[0];
  if (!original || original.status !== "posted" || original.reversed_at ||
      original.currency_code !== note.currencyCode || !(original.rate > 0)) throw fail();
  const reversals = await tx.execute(sql`
    SELECT id FROM journal_entries WHERE reversal_of=${note.journalEntryId}
  `);
  if (reversals.rows.length) throw fail();
  const balances = await tx.execute(sql`
    SELECT a.system_key, sum(l.base_debit-l.base_credit)::float8 AS value
      FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
     WHERE l.entry_id=${note.journalEntryId}
     GROUP BY a.system_key
  `);
  const balance = (key: string) => Number(balances.rows.find(
    (r: { system_key: string; value: number }) => r.system_key === key,
  )?.value ?? 0);
  const returned = await tx.execute(sql`
    SELECT m.*, m.quantity::float8 AS qty, m.unit_cost::float8 AS cost,
           (i.company_id=${note.companyId} AND il.product_id=m.product_id
            AND o.product_id=m.product_id AND o.kind='issue' AND o.state='done'
            AND o.unit_cost=m.unit_cost
            AND o.variant_id IS NOT DISTINCT FROM m.variant_id
            AND o.lot_id IS NOT DISTINCT FROM m.lot_id
            AND o.serial_id IS NOT DISTINCT FROM m.serial_id
            AND (o.invoice_line_id=il.id OR EXISTS (
              SELECT 1 FROM sales_issue_allocations a
               WHERE a.issue_move_id=o.id AND a.invoice_line_id=il.id
            ))) AS evidenced
      FROM stock_moves m JOIN products p ON p.id=m.product_id
      LEFT JOIN stock_moves o ON o.id=m.original_move_id
      LEFT JOIN customer_invoice_lines il ON il.id=m.invoice_line_id
      LEFT JOIN customer_invoices i ON i.id=il.invoice_id
     WHERE m.source_type='credit_note' AND m.source_id=${note.id}
       AND p.company_id=${note.companyId}
     ORDER BY m.product_id, m.id FOR UPDATE OF m
  `);
  let restoredValue = 0;
  if (note.restock) {
    if (!note.warehouseId && lines.some((l) => l.productId)) throw fail();
    const quantities = new Map<string, number>();
    for (const line of lines) {
      if (!line.productId) continue;
      const key = `${line.productId}:${line.invoiceLineId}`;
      quantities.set(key, (quantities.get(key) ?? 0) + Number(line.quantity));
    }
    for (const move of returned.rows) {
      if (move.kind !== "return_in" || move.state !== "done" ||
          move.to_warehouse_id !== note.warehouseId || !move.evidenced ||
          !(move.qty > 0) || !Number.isFinite(move.cost) || move.cost < 0) throw fail();
      const key = `${move.product_id}:${move.invoice_line_id}`;
      if (!quantities.has(key)) throw fail();
      quantities.set(key, quantities.get(key)! - move.qty);
      restoredValue += move.qty * move.cost;
    }
    if ([...quantities.values()].some((q) => Math.abs(q) > 1e-6)) throw fail();
  } else if (returned.rows.length) throw fail();
  // New notes explicitly retain their allocated journal cents. A cumulative
  // slice can differ from its own physical value by up to (but not including)
  // a cent. Legacy notes still require the original, stricter evidence.
  const postedValue = note.inventoryCost == null ? restoredValue : Number(note.inventoryCost);
  if (!Number.isFinite(postedValue) ||
      (note.inventoryCost != null && Math.abs(postedValue - restoredValue) >= 0.010001) ||
      Math.abs(balance("inventory") - postedValue) > 0.005 ||
      Math.abs(balance("cogs") + postedValue) > 0.005) throw fail();

  const carryingBefore = new Map<number, string>();
  for (const move of returned.rows) {
    // Same key/order as the stock engine: protect cost reads as well as writes.
    const key = `${move.product_id}-${note.warehouseId}-${move.variant_id ?? 0}-${move.lot_id ?? 0}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const quant = await tx.execute(sql`
      SELECT q.id, (q.quantity*q.avg_cost)::text AS value,
             q.quantity::float8 AS qty, q.avg_cost::float8 AS cost, p.costing_method
        FROM stock_quants q JOIN products p ON p.id=q.product_id
       WHERE q.product_id=${move.product_id} AND q.warehouse_id=${note.warehouseId}
         AND coalesce(q.variant_id,0)=${move.variant_id ?? 0}
         AND coalesce(q.lot_id,0)=${move.lot_id ?? 0} FOR UPDATE OF q
    `);
    const current = quant.rows[0];
    if (!current || current.qty + 1e-6 < move.qty) {
      throw new FinancialRequestError("رصيد المخزون غير كافٍ لإلغاء المرتجع؛ لم يتم تغيير الإشعار أو الحسابات.", 409);
    }
    if (!Number.isFinite(current.cost) || current.cost < 0) throw fail();
    if (!carryingBefore.has(current.id)) carryingBefore.set(current.id, current.value);
    if (move.serial_id) {
      const serial = await tx.execute(sql`
        SELECT id FROM stock_serials WHERE id=${move.serial_id}
          AND product_id=${move.product_id} AND current_warehouse_id=${note.warehouseId}
          AND state='in_stock' FOR UPDATE
      `);
      if (!serial.rows.length) throw new FinancialRequestError("الرقم التسلسلي المرتجع لم يعد متاحاً للإلغاء", 409);
    }
    if (current.costing_method === "fifo") {
      const layers = await tx.execute(sql`
        SELECT coalesce(sum(remaining_qty),0)::float8 AS qty FROM stock_layers
         WHERE product_id=${move.product_id} AND warehouse_id=${note.warehouseId}
           AND coalesce(variant_id,0)=${move.variant_id ?? 0}
           AND coalesce(lot_id,0)=${move.lot_id ?? 0}
      `);
      if (Number(layers.rows[0].qty) + 1e-6 < move.qty) throw fail();
    }
    // For non-FIFO cancellations use the actual carrying value, including
    // standard-cost products changed since return; do not revalue leftovers.
    await recordStockMove(tx, {
      companyId: note.companyId, productId: move.product_id, quantity: move.qty,
      kind: "issue", fromWarehouseId: note.warehouseId,
      variantId: move.variant_id, lotId: move.lot_id, serialId: move.serial_id,
      unitCost: current.costing_method === "fifo" ? undefined : current.cost,
      originalMoveId: move.id, invoiceLineId: move.invoice_line_id,
      sourceType: "credit_note_cancel", sourceId: note.id,
      sourceRef: `${note.reference}-CXL`, createdBy: userId, skipJournal: true,
    });
  }
  await reverseJournalEntry(tx, note.journalEntryId, userId, note.companyId, `إلغاء إشعار دائن ${note.reference}`);
  // Round carrying values before/after depletion, not the removed slice in
  // isolation. This preserves the rounding cent belonging to remaining stock.
  let difference = 0;
  let rounding = 0;
  if (carryingBefore.size) {
    const before = sql.join([...carryingBefore.values()].map((v) => sql`${v}::numeric`), sql` + `);
    const ids = sql.join([...carryingBefore.keys()].map((id) => sql`${id}`), sql`, `);
    const depleted = await tx.execute(sql`
      SELECT round((${before}),2) - round(coalesce(sum(quantity*avg_cost),0),2) AS cents,
             (${before}) - coalesce(sum(quantity*avg_cost),0) AS raw
        FROM stock_quants WHERE id IN (${ids})
    `);
    const removedCents = Number(depleted.rows[0].cents);
    difference = removedCents - balance("inventory");
    const remainder = await tx.execute(sql`
      SELECT round(${depleted.rows[0].raw}::numeric - ${restoredValue}::numeric, 2)
             - ${difference}::numeric AS value
    `);
    rounding = Number(remainder.rows[0].value);
  }
  if (Math.abs(difference) >= 0.005) {
    const value = Math.abs(difference);
    await postJournalEntry(tx, {
      companyId: note.companyId, entryDate: new Date(), currencyCode: "SAR", exchangeRate: 1,
      description: `فرق تكلفة إلغاء المرتجع ${note.reference}`,
      reference: `${note.reference}-CXL-COST`, source: "system",
      sourceRef: `${note.reference}-CXL-COST`, createdBy: userId,
    }, difference > 0 ? [
      { systemKey: "cogs", debit: value }, { systemKey: "inventory", credit: value },
    ] : [
      { systemKey: "inventory", debit: value }, { systemKey: "cogs", credit: value },
    ]);
  }
  // Carry only the rounding effect forward. Economic differences from
  // depletion at another purchase cost stay in COGS, not in future returns.
  await tx.update(creditNotesTable).set({ cancellationRounding: String(rounding) })
    .where(eq(creditNotesTable.id, note.id));
}
