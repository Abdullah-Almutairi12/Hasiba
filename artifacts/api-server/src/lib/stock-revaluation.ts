import { and, eq, sql } from "drizzle-orm";
import { accountsTable, productsTable, stockRevaluationsTable } from "@workspace/db";
import { ClosedPeriodError, postJournalEntry, type DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";

export { ClosedPeriodError };
const fail = (message: string, status = 409): never => { throw new FinancialRequestError(message, status); };
export function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}
export type Balance = {
  id: number; productId: number; warehouseId: number; lotId: number | null; variantId: number | null;
  quantity: string; avgCost: string; standardCost: string; productName: string; warehouseName: string;
  oldValue: string; newValue: string; delta: string; version: string; lastMoveId: number;
};
// Ownership is proven through BOTH the product and warehouse, not just quant ID.
export async function valuationBalance(tx: DbOrTx, companyId: number, quantId: number): Promise<Balance> {
  const [b] = rowsOf<Balance>(await tx.execute(sql`
    SELECT q.id, q.product_id AS "productId", q.warehouse_id AS "warehouseId",
      q.variant_id AS "variantId", q.lot_id AS "lotId", q.quantity::text,
      q.avg_cost::text AS "avgCost", p.cost_price::text AS "standardCost",
      p.name_ar AS "productName", w.name_ar AS "warehouseName",
      (q.quantity*q.avg_cost)::text AS "oldValue",
      (q.quantity*p.cost_price)::text AS "newValue",
      (round(q.quantity*p.cost_price,2)-round(q.quantity*q.avg_cost,2))::text AS delta,
      q.updated_at::text AS version,
      COALESCE((SELECT max(m.id) FROM stock_moves m WHERE m.product_id=q.product_id
        AND (m.from_warehouse_id=q.warehouse_id OR m.to_warehouse_id=q.warehouse_id)
        AND COALESCE(m.variant_id,0)=COALESCE(q.variant_id,0)
        AND COALESCE(m.lot_id,0)=COALESCE(q.lot_id,0)),0)::int AS "lastMoveId"
    FROM stock_quants q JOIN products p ON p.id=q.product_id JOIN warehouses w ON w.id=q.warehouse_id
    WHERE q.id=${quantId} AND p.company_id=${companyId} AND w.company_id=${companyId}
      AND NOT w.is_scrap AND p.costing_method='standard' AND p.cost_price>=0 AND q.quantity>0 AND q.avg_cost>=0
  `));
  return b ?? fail("لا يوجد رصيد معياري صالح في هذه الشركة", 404);
}
export async function lockBalance(tx: DbOrTx, companyId: number, quantId: number) {
  const b = await valuationBalance(tx, companyId, quantId);
  // Exactly the same key and lock ordering as stock-engine: advisory then quant.
  const key = `${b.productId}-${b.warehouseId}-${b.variantId ?? 0}-${b.lotId ?? 0}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`);
  await tx.execute(sql`SELECT id FROM stock_quants WHERE id=${quantId} FOR UPDATE`);
  // Price edits must not commit between the snapshot comparison and posting.
  await tx.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.id, b.productId)).for("share");
  return valuationBalance(tx, companyId, quantId);
}
export async function validateVarianceAccount(tx: DbOrTx, id: number) {
  const [account] = await tx.select().from(accountsTable).where(and(
    eq(accountsTable.id, id), eq(accountsTable.isActive, true), eq(accountsTable.isGroup, false),
    eq(accountsTable.currencyCode, "SAR"),
    sql`${accountsTable.type} IN ('expense','revenue')`,
    // Require a dedicated variance account, never silently affect COGS/sales.
    sql`${accountsTable.systemKey} IS NULL`,
  )).for("share");
  if (!account) fail("اختر حساب فرق مستقلًا نشطًا للإيرادات أو المصروفات بالريال", 400);
}
export async function approveRevaluation(
  tx: DbOrTx, r: typeof stockRevaluationsTable.$inferSelect, actorId: number,
) {
  if (r.createdBy === actorId) fail("يلزم اعتماد مسؤول مالي آخر غير مُنشئ الطلب", 403);
  const b = await lockBalance(tx, r.companyId, r.quantId);
  if (b.quantity !== r.quantity || b.avgCost !== r.oldCost
    || Number(b.standardCost) !== Number(r.targetCost) || b.version !== r.quantVersion
    || b.lastMoveId !== r.lastMoveId) {
    fail("تغير الرصيد أو السعر بعد المعاينة؛ ألغ الطلب وأنشئ معاينة جديدة");
  }
  await validateVarianceAccount(tx, r.varianceAccountId);
  const [inventory] = await tx.select().from(accountsTable).where(and(
    eq(accountsTable.systemKey, "inventory"), eq(accountsTable.isActive, true),
    eq(accountsTable.isGroup, false), eq(accountsTable.currencyCode, "SAR"),
  )).for("share");
  if (!inventory) fail("حساب المخزون غير صالح للترحيل", 400);
  const delta = Number(r.delta);
  const entry = await postJournalEntry(tx, {
    companyId: r.companyId, entryDate: new Date(), description: `إعادة تقييم مخزون #${r.id}: ${r.reason}`,
    reference: `REVAL-${r.id}`, source: "system", sourceRef: `stock_revaluation:${r.id}`,
    createdBy: actorId, currencyCode: "SAR", exchangeRate: 1,
  }, [
    { accountId: inventory.id, debit: delta > 0 ? delta : 0, credit: delta < 0 ? -delta : 0 },
    { accountId: r.varianceAccountId, debit: delta < 0 ? -delta : 0, credit: delta > 0 ? delta : 0 },
  ]);
  await tx.execute(sql`UPDATE stock_quants SET avg_cost=${r.targetCost}, updated_at=clock_timestamp() WHERE id=${r.quantId}`);
  const [posted] = await tx.update(stockRevaluationsTable).set({
    status: "posted", approvedBy: actorId, approvedAt: new Date(), journalEntryId: entry.id,
  }).where(eq(stockRevaluationsTable.id, r.id)).returning();
  return posted;
}
