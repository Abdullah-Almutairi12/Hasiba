import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, accountsTable, auditLogsTable, stockRevaluationsTable } from "@workspace/db";
import { requireRole, financeGuard } from "../middlewares/require-role";
import { getCompanyId } from "../lib/scoped-db";
import { financialTransaction, FinancialRequestError } from "../lib/financial-transaction";
import { approveRevaluation, ClosedPeriodError, lockBalance, rowsOf, validateVarianceAccount } from "../lib/stock-revaluation";

const router = Router();
const writeGuard = requireRole("owner", "manager", "inventory", "accountant");
const readGuard = requireRole("owner", "manager", "inventory", "accountant", "auditor");
const input = z.object({
  quantId: z.number().int().positive(),
  varianceAccountId: z.number().int().positive(),
  reason: z.string().trim().min(5).max(1000),
});
function error(res: import("express").Response, err: unknown) {
  const status = err instanceof FinancialRequestError ? err.status : err instanceof ClosedPeriodError ? 403 : 400;
  res.status(status).json({ error: err instanceof Error ? err.message : "تعذر إتمام إعادة التقييم" });
}
router.get("/inventory/revaluation-balances", readGuard, async (req, res) => {
  const companyId = getCompanyId(req);
  const rows = await db.execute(sql`
    SELECT q.id, q.product_id AS "productId", p.name_ar AS "productName", w.name_ar AS "warehouseName",
      q.variant_id AS "variantId", q.lot_id AS "lotId", q.quantity::text, q.avg_cost::text AS "avgCost",
      p.cost_price::text AS "standardCost"
    FROM stock_quants q JOIN products p ON p.id=q.product_id JOIN warehouses w ON w.id=q.warehouse_id
    WHERE p.company_id=${companyId} AND w.company_id=${companyId}
      AND p.costing_method='standard' AND NOT w.is_scrap AND q.quantity>0 AND q.avg_cost>=0
    ORDER BY p.id, w.id, q.id`);
  res.json(rowsOf(rows));
});
router.get("/inventory/revaluation-accounts", readGuard, async (_req, res) => {
  // Chart of accounts is shared by design; no company column exists on accounts.
  res.json(await db.select({ id: accountsTable.id, code: accountsTable.code, nameAr: accountsTable.nameAr })
    .from(accountsTable).where(and(
      eq(accountsTable.isActive, true), eq(accountsTable.isGroup, false), eq(accountsTable.currencyCode, "SAR"),
      sql`${accountsTable.type} IN ('expense','revenue') AND ${accountsTable.systemKey} IS NULL`,
    )));
});
router.get("/inventory/revaluations", readGuard, async (req, res) => {
  res.json(await db.select().from(stockRevaluationsTable)
    .where(eq(stockRevaluationsTable.companyId, getCompanyId(req))).orderBy(desc(stockRevaluationsTable.id)));
});
router.post("/inventory/revaluations", writeGuard, async (req, res) => {
  try {
    const body = input.parse(req.body);
    if (!req.get("Idempotency-Key")) throw new FinancialRequestError("يلزم مفتاح إعادة الطلب لحفظ المعاينة", 400);
    const result = await financialTransaction(req, async (tx) => {
      const b = await lockBalance(tx, getCompanyId(req), body.quantId);
      if (!Number.isFinite(Number(b.delta)) || Number(b.delta) === 0) {
        throw new FinancialRequestError("لا يوجد فرق قابل للترحيل بالهللة؛ لم يتغير الرصيد", 400);
      }
      if (Math.abs(Number(b.delta)) > Number.MAX_SAFE_INTEGER / 100) {
        throw new FinancialRequestError("فرق التقييم يتجاوز حد الدقة المحاسبية الآمن", 400);
      }
      await validateVarianceAccount(tx, body.varianceAccountId);
      const [created] = await tx.insert(stockRevaluationsTable).values({
        companyId: getCompanyId(req), quantId: b.id, productName: b.productName, warehouseName: b.warehouseName,
        quantity: b.quantity, oldCost: b.avgCost, targetCost: b.standardCost,
        oldValue: b.oldValue, newValue: b.newValue, delta: b.delta,
        quantVersion: b.version, lastMoveId: b.lastMoveId,
        reason: body.reason, varianceAccountId: body.varianceAccountId, createdBy: req.session.userId!,
      }).returning();
      await tx.insert(auditLogsTable).values({
        companyId: getCompanyId(req), userId: req.session.userId!, userName: `مستخدم #${req.session.userId}`,
        action: "stock_revaluation.preview", entity: `stock_revaluations:${created.id}`,
        details: body.reason, severity: "info",
      });
      return created;
    });
    res.status(201).json(result);
  } catch (err) { error(res, err); }
});
router.post("/inventory/revaluations/:id/:action",
  (req, res, next) => req.params.action === "approve" ? financeGuard(req, res, next) : writeGuard(req, res, next),
  async (req, res) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const action = z.enum(["confirm", "approve", "cancel"]).parse(req.params.action);
      const companyId = getCompanyId(req);
      const result = await db.transaction(async (tx) => {
        const [r] = await tx.select().from(stockRevaluationsTable).where(and(
          eq(stockRevaluationsTable.id, id), eq(stockRevaluationsTable.companyId, companyId),
        )).for("update");
        if (!r) throw new FinancialRequestError("طلب إعادة التقييم غير موجود", 404);
        const target = action === "confirm" ? "confirmed" : action === "approve" ? "posted" : "cancelled";
        // Durable per-document idempotency even without a browser key.
        if (r.status === target || (action === "confirm" && r.status === "posted")) return r;
        if (r.status === "posted" || r.status === "cancelled") throw new FinancialRequestError("الطلب مغلق ولا يمكن تغييره", 409);
        if (action === "approve" && r.status !== "confirmed") throw new FinancialRequestError("يجب تأكيد المعاينة أولاً", 409);
        const actor = req.session.userId!;
        const updated = action === "approve" ? await approveRevaluation(tx, r, actor) :
          (await tx.update(stockRevaluationsTable).set(action === "confirm" ? {
            status: "confirmed", confirmedBy: actor, confirmedAt: new Date(),
          } : { status: "cancelled", cancelledBy: actor, cancelledAt: new Date() })
            .where(eq(stockRevaluationsTable.id, id)).returning())[0];
        // Audit is part of the commit, not a best-effort notification.
        await tx.insert(auditLogsTable).values({
          companyId, userId: actor, userName: `مستخدم #${actor}`,
          action: `stock_revaluation.${action}`, entity: `stock_revaluations:${id}`,
          details: JSON.stringify({ delta: r.delta, varianceAccountId: r.varianceAccountId, journalEntryId: updated.journalEntryId }),
          severity: action === "approve" ? "critical" : "info",
        });
        return updated;
      });
      res.json(result);
    } catch (err) { error(res, err); }
  });
export default router;
