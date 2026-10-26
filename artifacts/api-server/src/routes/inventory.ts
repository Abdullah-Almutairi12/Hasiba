import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  db,
  productsTable,
  warehousesTable,
  stockMovesTable,
  stockQuantsTable,
  stockLotsTable,
  stockSerialsTable,
  productVariantsTable,
  productVariantAttributesTable,
  reorderRulesTable,
  stockTakesTable,
  stockTakeLinesTable,
  branchesTable,
} from "@workspace/db";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import {
  inventoryGuard,
  inventoryReadGuard,
  inventoryLookupGuard,
} from "../middlewares/require-role";
import {
  recordStockMove,
  getOrCreateLot,
  completeTransfer,
} from "../lib/stock-engine";
import { evaluateAnomalies } from "../lib/anomaly-engine";
import { getCompanyId } from "../lib/scoped-db";
import { financialTransaction, FinancialRequestError } from "../lib/financial-transaction";
import { supplyScope, supplyParam, supplyReferencesGuard } from "../lib/supply-chain-scope";
import { lockApprovalAuthority } from "../lib/approval-authority";
import { inventoryTransferReadGuard, transferAuthority, transferReceiptReference, auditTransferReceipt } from "../lib/scoped-inventory-receipts";
import { lockStocktakeForCount, auditCountObservation, stocktakeReadAuthority } from "../lib/stocktake-count";
import { inventoryActor,auditInventoryMutation } from "../lib/scoped-inventory-actor";
import { managedProfile } from "../lib/responsibility-context";
import { executeScopedInventoryMovement, inventoryMovementOptions } from "../lib/scoped-inventory-movements";
import { countPoint, preparePoint, verifyPoint, advanceCountGeneration, type CountPoint } from "../lib/stocktake-cutoff";
import { stocktakeSeparation, assertIndependentStocktakeReviewer } from "../lib/stocktake-separation";

const router = Router();
router.use("/inventory", supplyReferencesGuard);
router.param("id", supplyParam((path) =>
  path.includes("/stock-takes/") ? "take" :
  path.includes("/transfers/") ? "move" :
  path.includes("/products/") ? "product" : undefined));
router.param("lineId", supplyParam(() => "takeLine"));

// ============================================================
// Stock by warehouse — read endpoints
// ============================================================

router.get("/inventory/quants", inventoryReadGuard, async (req, res) => {
  try {
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
    const conds: SQL[] = [supplyScope("quant", stockQuantsTable.id, getCompanyId(req))];
    if (productId) conds.push(eq(stockQuantsTable.productId, productId));
    if (warehouseId) conds.push(eq(stockQuantsTable.warehouseId, warehouseId));
    const rows = await db
      .select({
        productId: stockQuantsTable.productId,
        productName: productsTable.nameAr,
        sku: productsTable.sku,
        warehouseId: stockQuantsTable.warehouseId,
        warehouseName: warehousesTable.nameAr,
        lotId: stockQuantsTable.lotId,
        variantId: stockQuantsTable.variantId,
        quantity: stockQuantsTable.quantity,
        avgCost: stockQuantsTable.avgCost,
      })
      .from(stockQuantsTable)
      .leftJoin(productsTable, eq(stockQuantsTable.productId, productsTable.id))
      .leftJoin(warehousesTable, eq(stockQuantsTable.warehouseId, warehousesTable.id))
      .where(conds.length ? and(...conds) : undefined);
    res.json(
      rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        avgCost: Number(r.avgCost),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "list quants failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Aggregate on-hand value per warehouse, used by the warehouses view to show
// "what's actually sitting in each location" instead of just listing rows.
router.get("/inventory/warehouse-summary", inventoryReadGuard, async (req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT w.id                                         AS warehouse_id,
             w.name_ar                                    AS warehouse_name,
             w.branch_id                                  AS branch_id,
             COUNT(DISTINCT q.product_id) FILTER (WHERE q.quantity > 0)::int AS sku_count,
             COALESCE(SUM(q.quantity)::float8, 0)         AS total_qty,
             COALESCE(SUM(q.quantity * q.avg_cost)::float8, 0) AS total_value
        FROM warehouses w
        LEFT JOIN stock_quants q ON q.warehouse_id = w.id
          AND ${supplyScope("quant", sql`q.id`, getCompanyId(req))}
       WHERE w.company_id = ${getCompanyId(req)}
       GROUP BY w.id, w.name_ar, w.branch_id
       ORDER BY w.id
    `);
    const list = (rows as unknown as { rows?: unknown[] }).rows ?? [];
    res.json(list);
  } catch (err) {
    req.log.error({ err }, "warehouse summary failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/inventory/products/:id/balances", inventoryReadGuard, async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const rows = await db
      .select({
        warehouseId: warehousesTable.id,
        warehouseName: warehousesTable.nameAr,
        branchId: warehousesTable.branchId,
        quantity: sql<number>`COALESCE(SUM(${stockQuantsTable.quantity})::float8, 0)`,
        avgCost: sql<number>`COALESCE(MAX(${stockQuantsTable.avgCost})::float8, 0)`,
      })
      .from(warehousesTable)
      .leftJoin(
        stockQuantsTable,
        and(
          eq(stockQuantsTable.warehouseId, warehousesTable.id),
          eq(stockQuantsTable.productId, productId),
          supplyScope("quant", stockQuantsTable.id, getCompanyId(req)),
        ),
      )
      .where(eq(warehousesTable.companyId, getCompanyId(req)))
      .groupBy(warehousesTable.id, warehousesTable.nameAr, warehousesTable.branchId)
      .orderBy(warehousesTable.id);
    res.json(rows.map((r) => ({ ...r, quantity: Number(r.quantity), avgCost: Number(r.avgCost) })));
  } catch (err) {
    req.log.error({ err }, "product balances failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/inventory/moves", inventoryReadGuard, async (req, res) => {
  try {
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
    const conds: SQL[] = [supplyScope("move", stockMovesTable.id, getCompanyId(req))];
    if (productId) conds.push(eq(stockMovesTable.productId, productId));
    if (warehouseId)
      conds.push(
        sql`(${stockMovesTable.fromWarehouseId} = ${warehouseId} OR ${stockMovesTable.toWarehouseId} = ${warehouseId})`,
      );
    const rows = await db
      .select({
        id: stockMovesTable.id,
        productId: stockMovesTable.productId,
        productName: productsTable.nameAr,
        sku: productsTable.sku,
        fromWarehouseId: stockMovesTable.fromWarehouseId,
        toWarehouseId: stockMovesTable.toWarehouseId,
        quantity: stockMovesTable.quantity,
        unitCost: stockMovesTable.unitCost,
        kind: stockMovesTable.kind,
        state: stockMovesTable.state,
        sourceType: stockMovesTable.sourceType,
        sourceRef: stockMovesTable.sourceRef,
        occurredAt: stockMovesTable.occurredAt,
        notes: stockMovesTable.notes,
      })
      .from(stockMovesTable)
      .leftJoin(productsTable, eq(stockMovesTable.productId, productsTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(stockMovesTable.occurredAt))
      .limit(200);
    res.json(
      rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        unitCost: Number(r.unitCost),
        occurredAt: r.occurredAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "list moves failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// Manual moves: receipt / issue / adjustment
// ============================================================

const ManualMoveBody = z.object({
  productId: z.coerce.number().int(),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative().optional(),
  warehouseId: z.coerce.number().int(),
  kind: z.enum(["receipt", "issue", "adjustment_in", "adjustment_out"]),
  lotNumber: z.string().optional(),
  expiryDate: z.string().optional(),
  notes: z.string().optional(),
});

router.get("/workspace/inventory/movement-options",inventoryTransferReadGuard,async(req,res)=>{
 try{res.json(await inventoryMovementOptions(req));}
 catch(error){res.status(error instanceof FinancialRequestError?error.status:400).json({error:error instanceof Error?error.message:"تعذر تحميل نطاق الحركة"});}
});
router.post("/inventory/moves", inventoryTransferReadGuard, async (req, res) => {
  try {
    if(await managedProfile(req.session.userId!,getCompanyId(req))){
      res.status(201).json(await executeScopedInventoryMovement(req,false));return;
    }
    const body = ManualMoveBody.parse(req.body);
    const result = await financialTransaction(req, async (tx) => {
      // Legacy compatibility only: managed-access still refuses unsupported
      // inventory.write routes. Enabling a catalog action requires source,
      // warehouse, amount and period enforcement, not just this role recheck.
      await lockApprovalAuthority(tx);
      await inventoryActor(tx,req,"inventory.write");
      let lotId: number | undefined;
      if (body.lotNumber) {
        lotId = await getOrCreateLot(tx, body.productId, body.lotNumber, body.expiryDate ?? null);
      }
      // Map UI kinds to ledger kinds. A manual "issue" is a real issue
      // (posts COGS / inventory credit), not a generic adjustment.
      const isIn = body.kind === "receipt" || body.kind === "adjustment_in";
      const kind: "receipt" | "issue" | "adjustment" =
        body.kind === "receipt"
          ? "receipt"
          : body.kind === "issue"
            ? "issue"
            : "adjustment";
      return recordStockMove(tx, {
        companyId: getCompanyId(req),
        productId: body.productId,
        kind,
        quantity: body.quantity,
        unitCost: body.unitCost,
        fromWarehouseId: isIn ? null : body.warehouseId,
        toWarehouseId: isIn ? body.warehouseId : null,
        lotId,
        sourceType: "manual",
        sourceRef: `MANUAL-${Date.now()}`,
        notes: body.notes,
        createdBy: req.session?.userId ?? null,
      });
    },async tx=>{await lockApprovalAuthority(tx);await inventoryActor(tx,req,"inventory.write");});

    // Anomaly hook: only manual *adjustments* (not receipts/issues from
    // POs / sales) feed the unusual_stock_adjust rule. This is the
    // single place where direct stock surgery happens in the system.
    if (!res.getHeader("Idempotency-Replayed") && (body.kind === "adjustment_in" || body.kind === "adjustment_out")) {
      void evaluateAnomalies({
        type: "stock.adjust",
        actorId: req.session?.userId ?? null,
        actorName:
          (req.session as { userName?: string } | undefined)?.userName ?? null,
        refTable: "stock_moves",
        refId: null,
        payload: {
          productId: body.productId,
          warehouseId: body.warehouseId,
          quantity: body.quantity,
          direction: body.kind,
          notes: body.notes ?? null,
        },
      });
    }

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof FinancialRequestError) { res.status(err.status).json({ error: err.message }); return; }
    const msg = err instanceof Error ? err.message : "تعذر تسجيل الحركة";
    req.log.error({ err }, "manual move failed");
    res.status(400).json({ error: msg });
  }
});

// ============================================================
// Transfers (planned -> done)
// ============================================================

const TransferBody = z.object({
  productId: z.coerce.number().int(),
  quantity: z.coerce.number().positive(),
  fromWarehouseId: z.coerce.number().int(),
  toWarehouseId: z.coerce.number().int(),
  lotId: z.coerce.number().int().optional(),
  notes: z.string().optional(),
});

router.post("/inventory/transfers", inventoryTransferReadGuard, async (req, res) => {
  try {
    if(await managedProfile(req.session.userId!,getCompanyId(req))){
      res.status(201).json(await executeScopedInventoryMovement(req,true));return;
    }
    const body = TransferBody.parse(req.body);
    if (body.fromWarehouseId === body.toWarehouseId) {
      return res.status(400).json({ error: "المصدر والوجهة لا يمكن أن يكونا نفس المستودع" });
    }
    const result = await financialTransaction(req,async (tx) => {
      await lockApprovalAuthority(tx);
      await inventoryActor(tx,req,"inventory.write");
      // Phase 1: outbound (in_transit)
      const out = await recordStockMove(tx, {
        companyId: getCompanyId(req),
        productId: body.productId,
        quantity: body.quantity,
        kind: "transfer",
        state: "in_transit",
        fromWarehouseId: body.fromWarehouseId,
        toWarehouseId: body.toWarehouseId,
        lotId: body.lotId ?? null,
        sourceType: "transfer",
        sourceRef: `TRF-${Date.now()}`,
        notes: body.notes,
        createdBy: req.session?.userId ?? null,
      });
      return out;
    },async tx=>{await lockApprovalAuthority(tx);await inventoryActor(tx,req,"inventory.write");});
    return res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر إنشاء التحويل";
    req.log.error({ err }, "transfer create failed");
    return res.status(err instanceof FinancialRequestError?err.status:400).json({ error: msg });
  }
});

router.post("/inventory/transfers/:id/receive", inventoryTransferReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await transferAuthority(db,req,id);
    const result=await financialTransaction(req,async tx=>{
      await lockApprovalAuthority(tx);
      const authority=await transferAuthority(tx,req,id,true);
      const reference=transferReceiptReference(req,authority);
      await completeTransfer(tx,id,req.session.userId!,getCompanyId(req));
      await auditTransferReceipt(tx,authority,reference);
      return {ok:true,id};
    });
    return res.json(result);
  } catch (err) {
    if(err instanceof FinancialRequestError) return res.status(err.status).json({error:err.message});
    const msg = err instanceof Error ? err.message : "تعذر استلام التحويل";
    req.log.error({ err }, "transfer receive failed");
    return res.status(400).json({ error: msg });
  }
});

router.get("/inventory/transfers", inventoryReadGuard, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: stockMovesTable.id,
        productId: stockMovesTable.productId,
        productName: productsTable.nameAr,
        fromWarehouseId: stockMovesTable.fromWarehouseId,
        toWarehouseId: stockMovesTable.toWarehouseId,
        quantity: stockMovesTable.quantity,
        state: stockMovesTable.state,
        sourceRef: stockMovesTable.sourceRef,
        occurredAt: stockMovesTable.occurredAt,
      })
      .from(stockMovesTable)
      .leftJoin(productsTable, eq(stockMovesTable.productId, productsTable.id))
      .where(
        and(
          supplyScope("move", stockMovesTable.id, getCompanyId(req)),
          eq(stockMovesTable.kind, "transfer"),
          sql`${stockMovesTable.fromWarehouseId} IS NOT NULL`,
        ),
      )
      .orderBy(desc(stockMovesTable.occurredAt))
      .limit(100);
    res.json(
      rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        occurredAt: r.occurredAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "list transfers failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// Lots & Serials
// ============================================================

router.get("/inventory/lots", inventoryReadGuard, async (req, res) => {
  try {
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const rows = await db
      .select()
      .from(stockLotsTable)
      .where(and(supplyScope("lot", stockLotsTable.id, getCompanyId(req)), productId ? eq(stockLotsTable.productId, productId) : undefined))
      .orderBy(desc(stockLotsTable.id))
      .limit(500);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "list lots failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/inventory/lots", inventoryGuard, async (req, res) => {
  try {
    const body = z.object({
      productId: z.coerce.number().int(),
      lotNumber: z.string().min(1),
      expiryDate: z.string().optional(),
      supplierRef: z.string().optional(),
    }).parse(req.body);
    const id = await db.transaction(async tx=>{
      await lockApprovalAuthority(tx);
      const actor=await inventoryActor(tx,req,"inventory.write");
      const id=await getOrCreateLot(tx,body.productId,body.lotNumber,body.expiryDate??null,body.supplierRef??null);
      await auditInventoryMutation(tx,actor,"inventory.lot.saved","stock_lot",id);
      return id;
    });
    res.status(201).json({ id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر إنشاء التشغيلة";
    res.status(err instanceof FinancialRequestError?err.status:400).json({ error: msg });
  }
});

router.get("/inventory/serials", inventoryReadGuard, async (req, res) => {
  try {
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const rows = await db
      .select()
      .from(stockSerialsTable)
      .where(and(supplyScope("serial", stockSerialsTable.id, getCompanyId(req)), productId ? eq(stockSerialsTable.productId, productId) : undefined))
      .orderBy(desc(stockSerialsTable.id))
      .limit(500);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "list serials failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/inventory/serials", inventoryGuard, async (req, res) => {
  try {
    const body = z.object({
      productId: z.coerce.number().int(),
      serialNumber: z.string().min(1),
      currentWarehouseId: z.coerce.number().int().optional(),
    }).parse(req.body);
    const [created] = await db.transaction(async tx=>{
      await lockApprovalAuthority(tx);
      const actor=await inventoryActor(tx,req,"inventory.write");
      const rows=await tx.insert(stockSerialsTable)
      .values({
        productId: body.productId,
        serialNumber: body.serialNumber,
        currentWarehouseId: body.currentWarehouseId ?? null,
      })
      .returning();
      await auditInventoryMutation(tx,actor,"inventory.serial.created","stock_serial",rows[0]!.id);
      return rows;
    });
    res.status(201).json(created);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر إنشاء الرقم التسلسلي";
    res.status(err instanceof FinancialRequestError?err.status:400).json({ error: msg });
  }
});

// ============================================================
// Reorder rules + suggestions
// ============================================================

router.get("/inventory/reorder-rules", inventoryReadGuard, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: reorderRulesTable.id,
        productId: reorderRulesTable.productId,
        productName: productsTable.nameAr,
        sku: productsTable.sku,
        warehouseId: reorderRulesTable.warehouseId,
        warehouseName: warehousesTable.nameAr,
        minQty: reorderRulesTable.minQty,
        maxQty: reorderRulesTable.maxQty,
        eoq: reorderRulesTable.eoq,
        isActive: reorderRulesTable.isActive,
      })
      .from(reorderRulesTable)
      .leftJoin(productsTable, eq(reorderRulesTable.productId, productsTable.id))
      .leftJoin(warehousesTable, eq(reorderRulesTable.warehouseId, warehousesTable.id))
      .where(supplyScope("reorder", reorderRulesTable.id, getCompanyId(req)))
      .orderBy(desc(reorderRulesTable.id));
    res.json(rows.map((r) => ({
      ...r,
      minQty: Number(r.minQty),
      maxQty: Number(r.maxQty),
      eoq: Number(r.eoq),
    })));
  } catch (err) {
    req.log.error({ err }, "list reorder rules failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/inventory/reorder-rules", inventoryGuard, async (req, res) => {
  try {
    const body = z.object({
      productId: z.coerce.number().int(),
      warehouseId: z.coerce.number().int(),
      minQty: z.coerce.number().nonnegative(),
      maxQty: z.coerce.number().nonnegative(),
      eoq: z.coerce.number().nonnegative().default(0),
      isActive: z.coerce.boolean().default(true),
    }).parse(req.body);
    if (body.maxQty > 0 && body.maxQty < body.minQty) {
      return res.status(400).json({ error: "الحد الأقصى يجب أن يكون أكبر من الحد الأدنى" });
    }
    const r = await db.transaction(async tx=>{
     await lockApprovalAuthority(tx);
     const actor=await inventoryActor(tx,req,"inventory.write");
     const result=await tx.execute(sql`
      INSERT INTO reorder_rules (product_id, warehouse_id, min_qty, max_qty, eoq, is_active)
      VALUES (${body.productId}, ${body.warehouseId}, ${body.minQty}, ${body.maxQty}, ${body.eoq}, ${body.isActive})
      ON CONFLICT (product_id, warehouse_id)
      DO UPDATE SET min_qty = EXCLUDED.min_qty,
                    max_qty = EXCLUDED.max_qty,
                    eoq     = EXCLUDED.eoq,
                    is_active = EXCLUDED.is_active
      RETURNING id
    `);
     const id=Number(result.rows[0]?.id);
     await auditInventoryMutation(tx,actor,"inventory.reorder.saved","reorder_rule",id);
     return result;
    });
    const rows = (r as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
    return res.status(201).json({ id: rows[0]?.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر حفظ القاعدة";
    return res.status(err instanceof FinancialRequestError?err.status:400).json({ error: msg });
  }
});

router.get("/inventory/reorder-suggestions", inventoryReadGuard, async (req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT r.id AS rule_id,
             r.product_id,
             p.name_ar AS product_name,
             p.sku,
             r.warehouse_id,
             w.name_ar AS warehouse_name,
             r.min_qty::float8 AS min_qty,
             r.max_qty::float8 AS max_qty,
             r.eoq::float8 AS eoq,
             COALESCE(SUM(q.quantity)::float8, 0) AS on_hand,
             GREATEST(r.max_qty - COALESCE(SUM(q.quantity), 0), r.eoq, 0)::float8 AS suggested_qty
        FROM reorder_rules r
        JOIN products p ON p.id = r.product_id
        JOIN warehouses w ON w.id = r.warehouse_id
        LEFT JOIN stock_quants q ON q.product_id = r.product_id AND q.warehouse_id = r.warehouse_id
          AND ${supplyScope("quant", sql`q.id`, getCompanyId(req))}
       WHERE r.is_active = true AND ${supplyScope("reorder", sql`r.id`, getCompanyId(req))}
       GROUP BY r.id, p.name_ar, p.sku, w.name_ar
      HAVING COALESCE(SUM(q.quantity), 0) <= r.min_qty
       ORDER BY p.name_ar
    `);
    const list = (rows as unknown as { rows?: unknown[] }).rows ?? [];
    res.json(list);
  } catch (err) {
    req.log.error({ err }, "reorder suggestions failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// Stock takes
// ============================================================

router.post("/inventory/stock-takes", inventoryGuard, async (req, res) => {
  try {
    const body = z.object({
      warehouseId: z.coerce.number().int(),
      notes: z.string().optional(),
    }).parse(req.body);
    const result = await financialTransaction(req,async (tx) => {
      await lockApprovalAuthority(tx);
      await inventoryActor(tx,req,"inventory.write");
      const ref = `ST-${Date.now()}-${randomUUID().slice(0,8)}`;
      // Opening snapshot is historical context, NOT the eventual adjustment base.
      await tx.execute(sql`SELECT id FROM warehouses WHERE id=${body.warehouseId} AND company_id=${getCompanyId(req)} FOR UPDATE`);
      const [take] = await tx
        .insert(stockTakesTable)
        .values({
          reference: ref,
          warehouseId: body.warehouseId,
          status: "in_progress",
          notes: body.notes ?? null,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      // Snapshot expected quantities for every product with quants in that warehouse.
      const snap = await tx
        .select({
          productId: stockQuantsTable.productId,
          variantId: stockQuantsTable.variantId,
          lotId: stockQuantsTable.lotId,
          quantity: stockQuantsTable.quantity,
          avgCost: stockQuantsTable.avgCost,
        })
        .from(stockQuantsTable)
        .where(and(eq(stockQuantsTable.warehouseId, body.warehouseId), supplyScope("quant", stockQuantsTable.id, getCompanyId(req))));
      for (const s of snap) {
        await tx.insert(stockTakeLinesTable).values({
          stockTakeId: take.id,
          productId: s.productId,
          variantId: s.variantId,
          lotId: s.lotId,
          expectedQty: String(s.quantity),
          unitCost: String(s.avgCost),
        });
      }
      return take;
    },async(tx,result)=>{
      await lockApprovalAuthority(tx);
      await inventoryActor(tx,req,"inventory.write");
      await stocktakeReadAuthority(tx,req,result.id);
    });
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر بدء الجرد";
    res.status(err instanceof FinancialRequestError?err.status:400).json({ error: msg });
  }
});

router.get("/inventory/stock-takes", inventoryTransferReadGuard, async (req, res) => {
  const actor=await inventoryActor(db,req,null);
  const scope=actor.grant ? sql`${stockTakesTable.warehouseId} IN
    (SELECT w.id FROM warehouses w WHERE w.company_id=${actor.companyId} AND w.branch_id=${actor.grant.branchId}
      AND w.id=ANY(ARRAY[${sql.join(actor.grant.warehouseIds.map(id=>sql`${id}`),sql`, `)}]::int[]))` : sql`true`;
  const rows = await db
    .select()
    .from(stockTakesTable)
    .where(and(supplyScope("take", stockTakesTable.id, getCompanyId(req)),scope))
    .orderBy(desc(stockTakesTable.id))
    .limit(50);
  res.json(rows.map((r) => ({
    ...r,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  })));
});

router.get("/inventory/stock-takes/:id", inventoryTransferReadGuard, async (req, res) => {
  try {
  const id = Number(req.params.id);
  const {actor}=await stocktakeReadAuthority(db,req,id);
  const separation=await stocktakeSeparation(db,id,actor.userId);
  const [take] = await db.select().from(stockTakesTable).where(eq(stockTakesTable.id, id)).limit(1);
  if (!take) return res.status(404).json({ error: "Not found" });
  const lines = await db
    .select({
      id: stockTakeLinesTable.id,
      productId: stockTakeLinesTable.productId,
      productName: productsTable.nameAr,
      sku: productsTable.sku,
      lotId: stockTakeLinesTable.lotId,
      expectedQty: stockTakeLinesTable.expectedQty,
      countedQty: stockTakeLinesTable.countedQty,
      countRevision: stockTakeLinesTable.countRevision,
      countCheckpoint: stockTakeLinesTable.countCheckpoint,
    })
    .from(stockTakeLinesTable)
    .leftJoin(productsTable, eq(stockTakeLinesTable.productId, productsTable.id))
    .where(eq(stockTakeLinesTable.stockTakeId, id));
  return res.json({
    ...take,
    canCount:actor.grant?actor.grant.actions.includes("inventory.stocktake.count"):["owner","manager","inventory"].includes(actor.role),
    canComplete:!separation.blockReason&&!actor.grant&&["owner","manager","inventory"].includes(actor.role),
    hasCountParticipation:separation.participated,
    approvalBlockReason:separation.blockReason,
    startedAt: take.startedAt.toISOString(),
    completedAt: take.completedAt?.toISOString() ?? null,
    lines: lines.map((l) => ({
      ...l,
      countCheckpoint: undefined,
      observationConfirmed: l.countCheckpoint!=null,
      observedAt: (l.countCheckpoint as CountPoint|null)?.observedAt??null,
      openingQty: Number(l.expectedQty),
      expectedQty: Number((l.countCheckpoint as CountPoint|null)?.quantity??l.expectedQty),
      countedQty: l.countedQty == null ? null : Number(l.countedQty),
    })),
  });
  } catch(error) {
    if(error instanceof FinancialRequestError)return res.status(error.status).json({error:error.message});
    throw error;
  }
});

router.get("/inventory/stock-takes/:id/lookup",inventoryTransferReadGuard,async(req,res)=>{
  try {
    await stocktakeReadAuthority(db,req,Number(req.params.id));
    const code=z.string().trim().min(1).max(200).parse(req.query.code);
    const [product]=await db.select({productId:productsTable.id}).from(productsTable)
      .where(and(eq(productsTable.companyId,getCompanyId(req)),sql`(${productsTable.barcode}=${code} OR ${productsTable.sku}=${code})`)).limit(1);
    if(!product){res.status(404).json({error:"لم يُعثر على باركود منتج أساسي؛ المتغيرات تحتاج مسار عدّ مخصص"});return;}
    res.json(product);
  } catch(error) {
    if(error instanceof FinancialRequestError){res.status(error.status).json({error:error.message});return;}
    res.status(400).json({error:"تعذر البحث عن الباركود"});
  }
});

// A short stock lock establishes a physical-count interval, not a stock freeze.
router.post("/inventory/stock-takes/:id/checkpoint", inventoryTransferReadGuard, async(req,res)=>{
  try {
    const body=z.object({productId:z.coerce.number().int().positive()}).strict().parse(req.body);
    const takeId=Number(req.params.id);
    const result=await db.transaction(async tx=>{
      await lockApprovalAuthority(tx);
      const {actor,take}=await lockStocktakeForCount(tx,req,takeId);
      const point=await countPoint(tx,actor.companyId,take.warehouseId,body.productId);
      // Authority may have expired while waiting for the stock lock.
      await inventoryActor(tx,req,"inventory.stocktake.count");
      let [line]=await tx.select().from(stockTakeLinesTable).where(and(
        eq(stockTakeLinesTable.stockTakeId,takeId),eq(stockTakeLinesTable.productId,body.productId),
        isNull(stockTakeLinesTable.variantId),isNull(stockTakeLinesTable.lotId)));
      if(!line) [line]=await tx.insert(stockTakeLinesTable).values({stockTakeId:takeId,productId:body.productId,
        expectedQty:point.quantity}).returning();
      return {lineId:line.id,expectedRevision:line.countRevision,
        ...await preparePoint(tx,takeId,line.id,actor.userId,point)};
    });
    res.json(result);
  } catch(error) {
    res.status(error instanceof FinancialRequestError?error.status:400).json({error:error instanceof Error?error.message:"تعذر بدء عد الصنف"});
  }
});

router.patch("/inventory/stock-takes/:id/lines/:lineId", inventoryTransferReadGuard, async (req, res) => {
  try {
    const takeId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const {actor:readActor}=await stocktakeReadAuthority(db,req,takeId);
    if(readActor.grant&&!req.get("Idempotency-Key"))throw new FinancialRequestError("يلزم معرف ثابت لمحاولة العد",400);
    const body = z.object({
      countedQty: z.coerce.number().finite().nonnegative(),
      expectedRevision: z.string().regex(/^\d{1,30}$/).optional(),
      checkpointId: z.string().uuid().optional(),
    }).strict().parse(req.body);
    const result=await financialTransaction(req,async tx=>{
      await lockApprovalAuthority(tx);
      const {actor,take}=await lockStocktakeForCount(tx,req,takeId);
      const [line]=await tx.select({id:stockTakeLinesTable.id,productId:stockTakeLinesTable.productId,
        countedQty:stockTakeLinesTable.countedQty,countRevision:stockTakeLinesTable.countRevision})
        .from(stockTakeLinesTable).innerJoin(productsTable,eq(productsTable.id,stockTakeLinesTable.productId))
        .where(and(eq(stockTakeLinesTable.id,lineId),eq(stockTakeLinesTable.stockTakeId,takeId),eq(productsTable.companyId,actor.companyId)));
      if(!line)throw new FinancialRequestError("السطر غير موجود في هذه الجلسة",404);
      if(body.expectedRevision===undefined)throw new FinancialRequestError("حدّث الجلسة قبل تعديل العدد؛ نسخة السطر مطلوبة",428);
      if(body.expectedRevision!==line.countRevision)throw new FinancialRequestError("تعارض: تغير العدد منذ فتحه. حدّث السطر وراجع العدد قبل الحفظ",409);
      const point=await countPoint(tx,actor.companyId,take.warehouseId,line.productId);
      const checkpoint=await verifyPoint(tx,takeId,lineId,actor.userId,body.checkpointId,point);
      await inventoryActor(tx,req,"inventory.stocktake.count");
      const [updated]=await tx.update(stockTakeLinesTable).set({countedQty:String(body.countedQty),
        countCheckpoint:checkpoint,
        countRevision:sql`${stockTakeLinesTable.countRevision}+1`}).where(eq(stockTakeLinesTable.id,lineId))
        .returning({countedQty:stockTakeLinesTable.countedQty});
      await auditCountObservation(tx,actor,takeId,lineId,line.countedQty,updated.countedQty!,"set");
      return {ok:true};
    });
    return res.json(result);
  } catch (err) {
    if(err instanceof FinancialRequestError)return res.status(err.status).json({error:err.message});
    return res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// Add a new line for an unexpected item (e.g. scanned during count but the
// initial snapshot did not include it because on-hand was zero).
// A fixed Idempotency-Key replays one scan; an unkeyed legacy POST is a new scan,
// not an idempotent retry. Parent locking serializes scans with /complete.
router.post("/inventory/stock-takes/:id/lines", inventoryTransferReadGuard, async (req, res) => {
  try {
    const takeId = Number(req.params.id);
    const {actor:readActor}=await stocktakeReadAuthority(db,req,takeId);
    if(readActor.grant&&!req.get("Idempotency-Key"))throw new FinancialRequestError("يلزم معرف ثابت لمحاولة العد",400);
    const body = z.object({
      productId: z.coerce.number().int(),
      lotId: z.coerce.number().int().optional(),
      countedQty: z.coerce.number().finite().nonnegative().default(1),
      checkpointId: z.string().uuid().optional(),
    }).strict().parse(req.body);
    if (body.lotId != null) {
      const [lot] = await db.select().from(stockLotsTable).where(and(eq(stockLotsTable.id, body.lotId), eq(stockLotsTable.productId, body.productId)));
      if (!lot) { res.status(400).json({ error: "Invalid lot for product" }); return; }
    }
    const result = await financialTransaction(req,async (tx) => {
      await lockApprovalAuthority(tx);
      const {actor,take}=await lockStocktakeForCount(tx,req,takeId,400);
      const point=await countPoint(tx,actor.companyId,take.warehouseId,body.productId);
      await inventoryActor(tx,req,"inventory.stocktake.count");
      // This barcode path must never collapse variant/lot-specific observations.
      const [complex]=await tx.execute(sql`SELECT 1 FROM stock_take_lines
        WHERE stock_take_id=${takeId} AND product_id=${body.productId}
          AND (variant_id IS NOT NULL OR (lot_id IS NOT NULL AND ${body.lotId??null}::int IS NULL))
        UNION ALL SELECT 1 FROM product_variants WHERE product_id=${body.productId} LIMIT 1`).then(r=>(r as unknown as {rows:unknown[]}).rows);
      if(complex)throw new FinancialRequestError("هذا الصنف يحتاج عدًا محددًا للمتغير أو الدفعة؛ لم تُسجّل زيادة",400);

      // Find any existing line for this (take, product, lot) — including the
      // snapshot rows — and bump it. Otherwise, create a new line with the
      // current expected balance from stock_quants.
      const existing = await tx
        .select()
        .from(stockTakeLinesTable)
        .where(and(
          eq(stockTakeLinesTable.stockTakeId, takeId),
          eq(stockTakeLinesTable.productId, body.productId),
          body.lotId ? eq(stockTakeLinesTable.lotId, body.lotId) : sql`${stockTakeLinesTable.lotId} IS NULL`,
        ))
        .limit(1);

      if (existing[0]) {
        const checkpoint=await verifyPoint(tx,takeId,existing[0].id,actor.userId,body.checkpointId,point);
        const previous=existing[0].countCheckpoint as CountPoint|null;
        if(existing[0].countedQty!==null&&(!previous||previous.fingerprint!==point.fingerprint))
          throw new FinancialRequestError("تحرك الصنف خلال سلسلة المسحات؛ أعد عد الصنف كاملًا من نقطة جديدة",409);
        const [updated]=await tx
          .update(stockTakeLinesTable)
          .set({ countedQty: sql`COALESCE(${stockTakeLinesTable.countedQty},0)+${body.countedQty}::numeric`,
            countCheckpoint:previous??checkpoint,
            countRevision:sql`${stockTakeLinesTable.countRevision}+1` })
          .where(eq(stockTakeLinesTable.id, existing[0].id)).returning({countedQty:stockTakeLinesTable.countedQty});
        await auditCountObservation(tx,actor,takeId,existing[0].id,existing[0].countedQty,updated.countedQty!,"scan");
        return { lineId: existing[0].id, countedQty: Number(updated.countedQty) };
      }

      // Unknown items must first obtain a server checkpoint through the same
      // native page. Never infer an opening balance at the moment of saving.
      throw new FinancialRequestError("ابدأ عد الصنف أولًا للحصول على نقطة عد موثقة",428);

    });
    res.status(201).json(result);
  } catch (err) {
    if(err instanceof FinancialRequestError){res.status(err.status).json({error:err.message});return;}
    const msg = err instanceof Error ? err.message : "تعذر إضافة سطر للجرد";
    res.status(400).json({ error: msg });
  }
});

router.post("/inventory/stock-takes/:id/complete", inventoryGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await db.transaction(async (tx) => {
      await lockApprovalAuthority(tx);
      await inventoryActor(tx,req,"inventory.write");
      const [take] = await tx
        .select().from(stockTakesTable)
        .where(and(eq(stockTakesTable.id, id), supplyScope("take", stockTakesTable.id, getCompanyId(req)))).for("update");
      if (!take) throw new Error("الجرد غير موجود");
      if(take.status==="done"&&take.closureResult)return take.closureResult;
      if(take.status!=="in_progress")throw new FinancialRequestError("الجرد مغلق ولا توجد نتيجة إقفال محفوظة للاستعادة",409);
      const lines = await tx.select().from(stockTakeLinesTable).where(eq(stockTakeLinesTable.stockTakeId, id))
        .orderBy(stockTakeLinesTable.productId,stockTakeLinesTable.id);
      const points=new Map<number,CountPoint>();
      // Lock all observed ordinary product keys in deterministic order BEFORE
      // validating any cutoff. Other stocktakes use exactly the same order.
      for(const l of lines) {
        if(l.countedQty===null)continue;
        if(l.variantId!==null||l.lotId!==null)throw new FinancialRequestError("المتتبعات والمتغيرات خارج شريحة الجرد المتحرك",400);
        const point=await countPoint(tx,getCompanyId(req),take.warehouseId,l.productId);
        const saved=l.countCheckpoint as CountPoint|null;
        if(!saved)throw new FinancialRequestError("يوجد عدد قديم دون نقطة عد موثقة؛ أعد عد الصنف قبل الإقفال",409);
        if(saved.generation!==point.generation)throw new FinancialRequestError("أقفل جرد آخر لهذا الصنف بعد عده؛ أعد العد قبل إقفال هذه الجلسة",409);
        points.set(l.id,point);
      }
      await inventoryActor(tx,req,"inventory.write");
      // The parent lock excludes all count writers. Recheck after the stock
      // locks too: participation committed while waiting cannot be bypassed.
      const separation=await assertIndependentStocktakeReviewer(tx,id,req.session.userId!);
      let adjustments = 0;
      for (const l of lines) {
        if (l.countedQty == null) continue;
        const saved=l.countCheckpoint as CountPoint;
        const [{delta}]=await tx.execute(sql`SELECT (${l.countedQty}::numeric-${saved.quantity}::numeric)::text AS delta`)
          .then(r=>(r as unknown as {rows:{delta:string}[]}).rows);
        const variance=Number(delta);
        await advanceCountGeneration(tx,take.warehouseId,l.productId);
        // Persist reconciliation evidence even when no financial adjustment is needed.
        await tx.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
          SELECT ${req.session.userId!},name,${getCompanyId(req)},'inventory.stocktake.reconciled','stock_take',
            ${JSON.stringify({takeId:id,lineId:l.id,productId:l.productId,openingQty:l.expectedQty,
              observedExpectedQty:saved.quantity,countedQty:l.countedQty,atCloseQty:points.get(l.id)!.quantity,
              delta,generation:saved.generation,observedAt:saved.observedAt})}
          FROM users WHERE id=${req.session.userId!}`);
        if (Math.abs(variance) < 0.0001) continue;
        const qty = Math.abs(variance);
        const [{cost}]=await tx.execute(sql`SELECT COALESCE(
          (SELECT avg_cost FROM stock_quants WHERE product_id=${l.productId} AND warehouse_id=${take.warehouseId}
           AND variant_id IS NULL AND lot_id IS NULL LIMIT 1),
          (SELECT cost_price FROM products WHERE id=${l.productId}))::float8 AS cost`)
          .then(r=>(r as unknown as {rows:{cost:number}[]}).rows);
        await recordStockMove(tx, {
          companyId: getCompanyId(req),
          productId: l.productId,
          quantity: qty,
          kind: "adjustment",
          fromWarehouseId: variance < 0 ? take.warehouseId : null,
          toWarehouseId: variance > 0 ? take.warehouseId : null,
          lotId: l.lotId ?? null,
          unitCost: cost,
          sourceType: "stocktake",
          sourceId: id,
          sourceRef: take.reference,
          notes: `تعديل من جرد ${take.reference}`,
          createdBy: req.session?.userId ?? null,
        });
        adjustments++;
      }
      const result={adjustments};
      await tx.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
        SELECT id,name,${getCompanyId(req)},'inventory.stocktake.closed','stock_take',
          jsonb_build_object('takeId',${id}::integer,'completedBy',id,
            'countParticipantIds',${JSON.stringify(separation.participantIds)}::jsonb,
            'independentOfCount',true,'path','legacy_complete','adjustments',${adjustments}::integer)::text
        FROM users WHERE id=${req.session.userId!}`);
      await tx.update(stockTakesTable).set({status:"done",completedAt:new Date(),
        completedBy:req.session.userId!,closureResult:result}).where(eq(stockTakesTable.id,id));
      return result;
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر إقفال الجرد";
    req.log.error({ err }, "stocktake complete failed");
    res.status(err instanceof FinancialRequestError?err.status:400).json({ error: msg });
  }
});

// ============================================================
// Variants
// ============================================================

router.get("/inventory/variants", inventoryReadGuard, async (req, res) => {
  const productId = req.query.productId ? Number(req.query.productId) : undefined;
  const rows = await db
    .select()
    .from(productVariantsTable)
    .where(and(supplyScope("variant", productVariantsTable.id, getCompanyId(req)), productId ? eq(productVariantsTable.productId, productId) : undefined));
  res.json(rows);
});

router.post("/inventory/variants", inventoryGuard, async (req, res) => {
  try {
    const body = z.object({
      productId: z.coerce.number().int(),
      sku: z.string().min(1),
      barcode: z.string().optional(),
      attributes: z.record(z.string(), z.string()).default({}),
      price: z.coerce.number().nonnegative().optional(),
      costPrice: z.coerce.number().nonnegative().optional(),
    }).parse(req.body);
    const created = await db.transaction(async tx=>{
      await lockApprovalAuthority(tx);
      const actor=await inventoryActor(tx,req,"inventory.write");
      const [created]=await tx.insert(productVariantsTable)
      .values({
        productId: body.productId,
        sku: body.sku,
        barcode: body.barcode ?? null,
        attributes: body.attributes,
        price: body.price != null ? String(body.price) : null,
        costPrice: body.costPrice != null ? String(body.costPrice) : null,
      })
      .returning();
      // Variant and parent flag are one operation; audit failure rolls both back.
      await tx.update(productsTable).set({isVariantParent:true}).where(eq(productsTable.id,body.productId));
      await auditInventoryMutation(tx,actor,"inventory.variant.created","product_variant",created!.id);
      return created;
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(err instanceof FinancialRequestError?err.status:400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// ============================================================
// Barcode lookup (used by POS and stock-take screens)
// ============================================================

router.get("/inventory/lookup", inventoryLookupGuard, async (req, res) => {
  try {
    const code = String(req.query.code ?? "").trim();
    if (!code) return res.status(400).json({ error: "code is required" });
    // Try product barcode first, then SKU, then variant barcode/SKU.
    const [byProductBarcode] = await db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.companyId, getCompanyId(req)), sql`(${productsTable.barcode} = ${code} OR ${productsTable.sku} = ${code})`))
      .limit(1);
    if (byProductBarcode) {
      return res.json({
        match: "product",
        productId: byProductBarcode.id,
        nameAr: byProductBarcode.nameAr,
        sku: byProductBarcode.sku,
        price: Number(byProductBarcode.price),
      });
    }
    const [byVariant] = await db
      .select()
      .from(productVariantsTable)
      .where(and(supplyScope("variant", productVariantsTable.id, getCompanyId(req)), sql`(${productVariantsTable.barcode} = ${code} OR ${productVariantsTable.sku} = ${code})`))
      .limit(1);
    if (byVariant) {
      return res.json({
        match: "variant",
        productId: byVariant.productId,
        variantId: byVariant.id,
        sku: byVariant.sku,
        price: byVariant.price ? Number(byVariant.price) : null,
      });
    }
    return res.status(404).json({ error: "غير موجود" });
  } catch (err) {
    req.log.error({ err }, "barcode lookup failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
