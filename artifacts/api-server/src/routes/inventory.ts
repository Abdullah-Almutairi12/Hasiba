import { Router } from "express";
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

const router = Router();

// ============================================================
// Stock by warehouse — read endpoints
// ============================================================

router.get("/inventory/quants", inventoryReadGuard, async (req, res) => {
  try {
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
    const conds: SQL[] = [];
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
        ),
      )
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
    const conds: SQL[] = [];
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

router.post("/inventory/moves", inventoryGuard, async (req, res) => {
  try {
    const body = ManualMoveBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
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
    });

    // Anomaly hook: only manual *adjustments* (not receipts/issues from
    // POs / sales) feed the unusual_stock_adjust rule. This is the
    // single place where direct stock surgery happens in the system.
    if (body.kind === "adjustment_in" || body.kind === "adjustment_out") {
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

router.post("/inventory/transfers", inventoryGuard, async (req, res) => {
  try {
    const body = TransferBody.parse(req.body);
    if (body.fromWarehouseId === body.toWarehouseId) {
      return res.status(400).json({ error: "المصدر والوجهة لا يمكن أن يكونا نفس المستودع" });
    }
    const result = await db.transaction(async (tx) => {
      // Phase 1: outbound (in_transit)
      const out = await recordStockMove(tx, {
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
    });
    return res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر إنشاء التحويل";
    req.log.error({ err }, "transfer create failed");
    return res.status(400).json({ error: msg });
  }
});

router.post("/inventory/transfers/:id/receive", inventoryGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.transaction((tx) => completeTransfer(tx, id, req.session?.userId ?? null));
    return res.json({ ok: true, id });
  } catch (err) {
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
      .where(productId ? eq(stockLotsTable.productId, productId) : undefined)
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
    const id = await db.transaction((tx) =>
      getOrCreateLot(tx, body.productId, body.lotNumber, body.expiryDate ?? null, body.supplierRef ?? null),
    );
    res.status(201).json({ id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر إنشاء التشغيلة";
    res.status(400).json({ error: msg });
  }
});

router.get("/inventory/serials", inventoryReadGuard, async (req, res) => {
  try {
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const rows = await db
      .select()
      .from(stockSerialsTable)
      .where(productId ? eq(stockSerialsTable.productId, productId) : undefined)
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
    const [created] = await db
      .insert(stockSerialsTable)
      .values({
        productId: body.productId,
        serialNumber: body.serialNumber,
        currentWarehouseId: body.currentWarehouseId ?? null,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر إنشاء الرقم التسلسلي";
    res.status(400).json({ error: msg });
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
    const r = await db.execute(sql`
      INSERT INTO reorder_rules (product_id, warehouse_id, min_qty, max_qty, eoq, is_active)
      VALUES (${body.productId}, ${body.warehouseId}, ${body.minQty}, ${body.maxQty}, ${body.eoq}, ${body.isActive})
      ON CONFLICT (product_id, warehouse_id)
      DO UPDATE SET min_qty = EXCLUDED.min_qty,
                    max_qty = EXCLUDED.max_qty,
                    eoq     = EXCLUDED.eoq,
                    is_active = EXCLUDED.is_active
      RETURNING id
    `);
    const rows = (r as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
    return res.status(201).json({ id: rows[0]?.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر حفظ القاعدة";
    return res.status(400).json({ error: msg });
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
       WHERE r.is_active = true
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
    const result = await db.transaction(async (tx) => {
      const ref = `ST-${Date.now()}`;
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
        .where(eq(stockQuantsTable.warehouseId, body.warehouseId));
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
    });
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر بدء الجرد";
    res.status(400).json({ error: msg });
  }
});

router.get("/inventory/stock-takes", inventoryReadGuard, async (req, res) => {
  const rows = await db
    .select()
    .from(stockTakesTable)
    .orderBy(desc(stockTakesTable.id))
    .limit(50);
  res.json(rows.map((r) => ({
    ...r,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  })));
});

router.get("/inventory/stock-takes/:id", inventoryReadGuard, async (req, res) => {
  const id = Number(req.params.id);
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
      unitCost: stockTakeLinesTable.unitCost,
    })
    .from(stockTakeLinesTable)
    .leftJoin(productsTable, eq(stockTakeLinesTable.productId, productsTable.id))
    .where(eq(stockTakeLinesTable.stockTakeId, id));
  return res.json({
    ...take,
    startedAt: take.startedAt.toISOString(),
    completedAt: take.completedAt?.toISOString() ?? null,
    lines: lines.map((l) => ({
      ...l,
      expectedQty: Number(l.expectedQty),
      countedQty: l.countedQty == null ? null : Number(l.countedQty),
      unitCost: Number(l.unitCost),
    })),
  });
});

router.patch("/inventory/stock-takes/:id/lines/:lineId", inventoryGuard, async (req, res) => {
  try {
    const takeId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const body = z.object({ countedQty: z.coerce.number().nonnegative() }).parse(req.body);
    // Reject the update if the line does not belong to this stock-take, or if
    // the take is no longer in_progress. This preserves the audit trail —
    // completed takes are immutable, and a line can never be reattributed
    // to a different take by URL manipulation.
    const [take] = await db
      .select({ status: stockTakesTable.status })
      .from(stockTakesTable)
      .where(eq(stockTakesTable.id, takeId))
      .limit(1);
    if (!take) return res.status(404).json({ error: "الجرد غير موجود" });
    if (take.status !== "in_progress") {
      return res.status(409).json({ error: "لا يمكن تعديل جرد مغلق" });
    }
    const result = await db
      .update(stockTakeLinesTable)
      .set({ countedQty: String(body.countedQty) })
      .where(and(eq(stockTakeLinesTable.id, lineId), eq(stockTakeLinesTable.stockTakeId, takeId)))
      .returning({ id: stockTakeLinesTable.id });
    if (result.length === 0) {
      return res.status(404).json({ error: "السطر غير موجود في هذه الجلسة" });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// Add a new line for an unexpected item (e.g. scanned during count but the
// initial snapshot did not include it because on-hand was zero). Idempotent
// per (stockTakeId, productId, lotId) — re-posting just bumps countedQty so
// repeat scans of the same barcode keep counting up.
router.post("/inventory/stock-takes/:id/lines", inventoryGuard, async (req, res) => {
  try {
    const takeId = Number(req.params.id);
    const body = z.object({
      productId: z.coerce.number().int(),
      lotId: z.coerce.number().int().optional(),
      countedQty: z.coerce.number().nonnegative().default(1),
    }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [take] = await tx
        .select()
        .from(stockTakesTable)
        .where(eq(stockTakesTable.id, takeId))
        .limit(1);
      if (!take) throw new Error("الجرد غير موجود");
      if (take.status !== "in_progress") throw new Error("لا يمكن تعديل جرد مغلق");

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
        const next = Number(existing[0].countedQty ?? 0) + body.countedQty;
        await tx
          .update(stockTakeLinesTable)
          .set({ countedQty: String(next) })
          .where(eq(stockTakeLinesTable.id, existing[0].id));
        return { lineId: existing[0].id, countedQty: next };
      }

      // Compute expected qty / unit cost from current quants in this warehouse.
      const cur = await tx
        .select({
          quantity: stockQuantsTable.quantity,
          avgCost: stockQuantsTable.avgCost,
        })
        .from(stockQuantsTable)
        .where(and(
          eq(stockQuantsTable.warehouseId, take.warehouseId),
          eq(stockQuantsTable.productId, body.productId),
          body.lotId ? eq(stockQuantsTable.lotId, body.lotId) : sql`${stockQuantsTable.lotId} IS NULL`,
        ))
        .limit(1);
      const expected = cur[0] ? Number(cur[0].quantity) : 0;
      const unitCost = cur[0] ? Number(cur[0].avgCost) : 0;
      const [created] = await tx
        .insert(stockTakeLinesTable)
        .values({
          stockTakeId: takeId,
          productId: body.productId,
          lotId: body.lotId ?? null,
          expectedQty: String(expected),
          countedQty: String(body.countedQty),
          unitCost: String(unitCost),
        })
        .returning({ id: stockTakeLinesTable.id });
      return { lineId: created.id, countedQty: body.countedQty };
    });
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر إضافة سطر للجرد";
    res.status(400).json({ error: msg });
  }
});

router.post("/inventory/stock-takes/:id/complete", inventoryGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await db.transaction(async (tx) => {
      // Atomic state transition: only the caller that successfully flips
      // the take from in_progress -> done proceeds to post adjustments.
      // A second concurrent /complete sees no row returned and aborts,
      // so adjustments and GL postings are never duplicated.
      const [take] = await tx
        .update(stockTakesTable)
        .set({ status: "done", completedAt: new Date(), completedBy: req.session?.userId ?? null })
        .where(and(eq(stockTakesTable.id, id), eq(stockTakesTable.status, "in_progress")))
        .returning();
      if (!take) throw new Error("الجرد غير موجود أو مغلق بالفعل");
      const lines = await tx.select().from(stockTakeLinesTable).where(eq(stockTakeLinesTable.stockTakeId, id));
      let adjustments = 0;
      for (const l of lines) {
        if (l.countedQty == null) continue;
        const expected = Number(l.expectedQty);
        const counted = Number(l.countedQty);
        const variance = counted - expected;
        if (Math.abs(variance) < 0.0001) continue;
        const qty = Math.abs(variance);
        await recordStockMove(tx, {
          productId: l.productId,
          quantity: qty,
          kind: "adjustment",
          fromWarehouseId: variance < 0 ? take.warehouseId : null,
          toWarehouseId: variance > 0 ? take.warehouseId : null,
          lotId: l.lotId ?? null,
          unitCost: Number(l.unitCost),
          sourceType: "stocktake",
          sourceId: id,
          sourceRef: take.reference,
          notes: `تعديل من جرد ${take.reference}`,
          createdBy: req.session?.userId ?? null,
        });
        adjustments++;
      }
      return { adjustments };
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذر إقفال الجرد";
    req.log.error({ err }, "stocktake complete failed");
    res.status(400).json({ error: msg });
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
    .where(productId ? eq(productVariantsTable.productId, productId) : undefined);
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
    const [created] = await db
      .insert(productVariantsTable)
      .values({
        productId: body.productId,
        sku: body.sku,
        barcode: body.barcode ?? null,
        attributes: body.attributes,
        price: body.price != null ? String(body.price) : null,
        costPrice: body.costPrice != null ? String(body.costPrice) : null,
      })
      .returning();
    // Mark parent as variant parent.
    await db.update(productsTable).set({ isVariantParent: true }).where(eq(productsTable.id, body.productId));
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
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
      .where(sql`${productsTable.barcode} = ${code} OR ${productsTable.sku} = ${code}`)
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
      .where(sql`${productVariantsTable.barcode} = ${code} OR ${productVariantsTable.sku} = ${code}`)
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
