import { Router } from "express";
import {
  db,
  productsTable,
  warehousesTable,
  bomsTable,
  bomLinesTable,
  workCentersTable,
  routingsTable,
  routingOperationsTable,
  workOrdersTable,
  workOrderReservationsTable,
  workOrderConsumptionsTable,
  workOrderProductionsTable,
  qualityChecksTable,
  bomQcTemplatesTable,
  scrapRecordsTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  productionGuard,
  inventoryReadGuard,
} from "../middlewares/require-role";
import { recordStockMove, getDefaultWarehouseId } from "../lib/stock-engine";
import { postJournalEntry } from "../lib/journal-posting";

const router = Router();

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function respondError(res: import("express").Response, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const msg = err instanceof Error ? err.message : "internal";
  res.status(500).json({ error: msg });
}

async function nextRef(prefix: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const seqName = `mrp_${prefix.toLowerCase()}_seq_${year}`;
  await db.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${seqName} MINVALUE 1 START 1`));
  const r = await db.execute(sql.raw(`SELECT nextval('${seqName}')::bigint AS n`));
  const rows = (r as unknown as { rows?: Array<{ n: string | number }> }).rows ?? [];
  const seq = Number(rows[0]?.n ?? 1);
  return `${prefix}-${year}-${String(seq).padStart(5, "0")}`;
}

// ===========================================================================
// Bills of Materials
// ===========================================================================

router.get("/manufacturing/boms", inventoryReadGuard, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: bomsTable.id,
        reference: bomsTable.reference,
        productId: bomsTable.productId,
        productName: productsTable.nameAr,
        sku: productsTable.sku,
        quantity: bomsTable.quantity,
        isPhantom: bomsTable.isPhantom,
        isActive: bomsTable.isActive,
        routingId: bomsTable.routingId,
        notes: bomsTable.notes,
        createdAt: bomsTable.createdAt,
      })
      .from(bomsTable)
      .leftJoin(productsTable, eq(bomsTable.productId, productsTable.id))
      .orderBy(desc(bomsTable.id));
    res.json(rows.map((r) => ({ ...r, quantity: Number(r.quantity) })));
  } catch (err) {
    req.log.error({ err }, "list BoMs failed");
    respondError(res, err);
  }
});

router.get("/manufacturing/boms/:id", inventoryReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, id)).limit(1);
    if (!bom) return res.status(404).json({ error: "غير موجود" });
    const lines = await db
      .select({
        id: bomLinesTable.id,
        componentId: bomLinesTable.componentId,
        componentName: productsTable.nameAr,
        sku: productsTable.sku,
        quantityPer: bomLinesTable.quantityPer,
        unit: bomLinesTable.unit,
        scrapPct: bomLinesTable.scrapPct,
        notes: bomLinesTable.notes,
        costPrice: productsTable.costPrice,
      })
      .from(bomLinesTable)
      .leftJoin(productsTable, eq(bomLinesTable.componentId, productsTable.id))
      .where(eq(bomLinesTable.bomId, id));
    const qcTemplates = await db
      .select()
      .from(bomQcTemplatesTable)
      .where(eq(bomQcTemplatesTable.bomId, id));
    return res.json({
      ...bom,
      quantity: Number(bom.quantity),
      lines: lines.map((l) => ({
        ...l,
        quantityPer: Number(l.quantityPer),
        scrapPct: Number(l.scrapPct),
        costPrice: Number(l.costPrice ?? 0),
      })),
      qcTemplates,
    });
  } catch (err) {
    req.log.error({ err }, "get BoM failed");
    return respondError(res, err);
  }
});

const BomBody = z.object({
  productId: z.coerce.number().int(),
  quantity: z.coerce.number().positive().default(1),
  isPhantom: z.boolean().default(false),
  routingId: z.coerce.number().int().optional(),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        componentId: z.coerce.number().int(),
        quantityPer: z.coerce.number().positive(),
        unit: z.string().default("piece"),
        scrapPct: z.coerce.number().min(0).max(100).default(0),
        notes: z.string().optional(),
      }),
    )
    .min(1),
  qcTemplates: z
    .array(
      z.object({
        name: z.string().min(1),
        nameAr: z.string().min(1),
        isMandatory: z.boolean().default(true),
        operationId: z.coerce.number().int().optional(),
      }),
    )
    .optional(),
});

router.post("/manufacturing/boms", productionGuard, async (req, res) => {
  try {
    const body = BomBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const reference = await nextRef("BOM");
      const [bom] = await tx
        .insert(bomsTable)
        .values({
          reference,
          productId: body.productId,
          quantity: String(body.quantity),
          isPhantom: body.isPhantom,
          routingId: body.routingId ?? null,
          notes: body.notes ?? null,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      for (const ln of body.lines) {
        await tx.insert(bomLinesTable).values({
          bomId: bom.id,
          componentId: ln.componentId,
          quantityPer: String(ln.quantityPer),
          unit: ln.unit,
          scrapPct: String(ln.scrapPct),
          notes: ln.notes ?? null,
        });
      }
      for (const qt of body.qcTemplates ?? []) {
        await tx.insert(bomQcTemplatesTable).values({
          bomId: bom.id,
          name: qt.name,
          nameAr: qt.nameAr,
          isMandatory: qt.isMandatory,
          operationId: qt.operationId ?? null,
        });
      }
      return bom;
    });
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "create BoM failed");
    respondError(res, err);
  }
});

// Recursively explode a BoM into leaf component requirements (skipping
// phantom assemblies, which are expanded into their own children).
// Returns one entry per leaf component, summing quantities across the
// whole tree. `outerRatio` scales every quantity by the WO/BoM ratio.
type LeafReq = { componentId: number; quantity: number };
async function explodeBom(
  bomId: number,
  outerRatio: number,
  acc: Map<number, number> = new Map(),
): Promise<LeafReq[]> {
  const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, bomId)).limit(1);
  if (!bom) return [];
  const lines = await db
    .select()
    .from(bomLinesTable)
    .where(eq(bomLinesTable.bomId, bomId));
  const innerRatio = outerRatio; // bom_lines are per `bom.quantity` of parent
  for (const ln of lines) {
    const qty =
      Number(ln.quantityPer) * innerRatio * (1 + Number(ln.scrapPct) / 100);
    // If the component itself has an active phantom BoM, recurse instead
    // of consuming the phantom product directly.
    const [phantom] = await db
      .select({ id: bomsTable.id, qty: bomsTable.quantity })
      .from(bomsTable)
      .where(
        and(
          eq(bomsTable.productId, ln.componentId),
          eq(bomsTable.isPhantom, true),
          eq(bomsTable.isActive, true),
        ),
      )
      .limit(1);
    if (phantom) {
      // Producing `qty` of the phantom needs (qty / phantom.qty) batches.
      await explodeBom(phantom.id, qty / Number(phantom.qty), acc);
    } else {
      acc.set(ln.componentId, (acc.get(ln.componentId) ?? 0) + qty);
    }
  }
  return Array.from(acc.entries()).map(([componentId, quantity]) => ({
    componentId,
    quantity,
  }));
}

// Standard cost roll-up: sum(quantity_per * cost_price) over BoM lines per
// finished-goods quantity. Phantom BoM components are expanded recursively.
async function costRollup(bomId: number): Promise<number> {
  const lines = await db
    .select({
      componentId: bomLinesTable.componentId,
      quantityPer: bomLinesTable.quantityPer,
      scrapPct: bomLinesTable.scrapPct,
      costPrice: productsTable.costPrice,
    })
    .from(bomLinesTable)
    .leftJoin(productsTable, eq(bomLinesTable.componentId, productsTable.id))
    .where(eq(bomLinesTable.bomId, bomId));
  let total = 0;
  for (const ln of lines) {
    const qp = Number(ln.quantityPer) * (1 + Number(ln.scrapPct) / 100);
    // Phantom expansion: if the component itself has an active phantom BoM
    // use its rolled-up cost instead of the component's own cost_price.
    const [phantom] = await db
      .select({ id: bomsTable.id, qty: bomsTable.quantity })
      .from(bomsTable)
      .where(
        and(
          eq(bomsTable.productId, ln.componentId),
          eq(bomsTable.isPhantom, true),
          eq(bomsTable.isActive, true),
        ),
      )
      .limit(1);
    if (phantom) {
      const sub = await costRollup(phantom.id);
      total += qp * (sub / Number(phantom.qty));
    } else {
      total += qp * Number(ln.costPrice ?? 0);
    }
  }
  return total;
}

router.get("/manufacturing/boms/:id/cost", inventoryReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, id)).limit(1);
    if (!bom) return res.status(404).json({ error: "غير موجود" });
    const total = await costRollup(id);
    return res.json({
      bomId: id,
      bomQuantity: Number(bom.quantity),
      totalCost: total,
      unitCost: total / Number(bom.quantity),
    });
  } catch (err) {
    req.log.error({ err }, "BoM cost rollup failed");
    return respondError(res, err);
  }
});

// ===========================================================================
// Work Centers
// ===========================================================================

router.get("/manufacturing/work-centers", inventoryReadGuard, async (req, res) => {
  try {
    const rows = await db.select().from(workCentersTable).orderBy(workCentersTable.code);
    res.json(rows.map((r) => ({
      ...r,
      capacityPerDay: Number(r.capacityPerDay),
      hourlyCost: Number(r.hourlyCost),
    })));
  } catch (err) {
    respondError(res, err);
  }
});

const WorkCenterBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().min(1),
  capacityPerDay: z.coerce.number().positive().default(8),
  hourlyCost: z.coerce.number().nonnegative().default(0),
  notes: z.string().optional(),
});

router.post("/manufacturing/work-centers", productionGuard, async (req, res) => {
  try {
    const body = WorkCenterBody.parse(req.body);
    const [row] = await db
      .insert(workCentersTable)
      .values({
        code: body.code,
        name: body.name,
        nameAr: body.nameAr,
        capacityPerDay: String(body.capacityPerDay),
        hourlyCost: String(body.hourlyCost),
        notes: body.notes ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "create work center failed");
    respondError(res, err);
  }
});

// ===========================================================================
// Routings
// ===========================================================================

router.get("/manufacturing/routings", inventoryReadGuard, async (req, res) => {
  try {
    const routings = await db.select().from(routingsTable).orderBy(desc(routingsTable.id));
    const ops = await db
      .select({
        id: routingOperationsTable.id,
        routingId: routingOperationsTable.routingId,
        sequence: routingOperationsTable.sequence,
        name: routingOperationsTable.name,
        nameAr: routingOperationsTable.nameAr,
        workCenterId: routingOperationsTable.workCenterId,
        workCenterName: workCentersTable.nameAr,
        durationMinutes: routingOperationsTable.durationMinutes,
        instructions: routingOperationsTable.instructions,
      })
      .from(routingOperationsTable)
      .leftJoin(workCentersTable, eq(routingOperationsTable.workCenterId, workCentersTable.id))
      .orderBy(routingOperationsTable.sequence);
    res.json(
      routings.map((r) => ({
        ...r,
        operations: ops
          .filter((o) => o.routingId === r.id)
          .map((o) => ({ ...o, durationMinutes: Number(o.durationMinutes) })),
      })),
    );
  } catch (err) {
    respondError(res, err);
  }
});

const RoutingBody = z.object({
  name: z.string().min(1),
  nameAr: z.string().min(1),
  operations: z
    .array(
      z.object({
        sequence: z.coerce.number().int().default(10),
        name: z.string().min(1),
        nameAr: z.string().min(1),
        workCenterId: z.coerce.number().int(),
        durationMinutes: z.coerce.number().nonnegative().default(0),
        instructions: z.string().optional(),
      }),
    )
    .min(1),
});

router.post("/manufacturing/routings", productionGuard, async (req, res) => {
  try {
    const body = RoutingBody.parse(req.body);
    const reference = await nextRef("RTG");
    const result = await db.transaction(async (tx) => {
      const [routing] = await tx
        .insert(routingsTable)
        .values({ reference, name: body.name, nameAr: body.nameAr })
        .returning();
      for (const op of body.operations) {
        await tx.insert(routingOperationsTable).values({
          routingId: routing.id,
          sequence: op.sequence,
          name: op.name,
          nameAr: op.nameAr,
          workCenterId: op.workCenterId,
          durationMinutes: String(op.durationMinutes),
          instructions: op.instructions ?? null,
        });
      }
      return routing;
    });
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "create routing failed");
    respondError(res, err);
  }
});

// ===========================================================================
// Work Orders
// ===========================================================================

router.get("/manufacturing/work-orders", inventoryReadGuard, async (req, res) => {
  try {
    const state = req.query.state as string | undefined;
    const conds = state ? [eq(workOrdersTable.state, state)] : [];
    const rows = await db
      .select({
        id: workOrdersTable.id,
        reference: workOrdersTable.reference,
        bomId: workOrdersTable.bomId,
        productId: workOrdersTable.productId,
        productName: productsTable.nameAr,
        sku: productsTable.sku,
        quantity: workOrdersTable.quantity,
        quantityProduced: workOrdersTable.quantityProduced,
        warehouseId: workOrdersTable.warehouseId,
        warehouseName: warehousesTable.nameAr,
        state: workOrdersTable.state,
        plannedStart: workOrdersTable.plannedStart,
        plannedEnd: workOrdersTable.plannedEnd,
        startedAt: workOrdersTable.startedAt,
        completedAt: workOrdersTable.completedAt,
        standardCost: workOrdersTable.standardCost,
        notes: workOrdersTable.notes,
        createdAt: workOrdersTable.createdAt,
      })
      .from(workOrdersTable)
      .leftJoin(productsTable, eq(workOrdersTable.productId, productsTable.id))
      .leftJoin(warehousesTable, eq(workOrdersTable.warehouseId, warehousesTable.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(workOrdersTable.id))
      .limit(200);
    res.json(
      rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        quantityProduced: Number(r.quantityProduced),
        standardCost: Number(r.standardCost),
      })),
    );
  } catch (err) {
    respondError(res, err);
  }
});

router.get("/manufacturing/work-orders/:id", inventoryReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).limit(1);
    if (!wo) return res.status(404).json({ error: "غير موجود" });
    const reservations = await db
      .select({
        id: workOrderReservationsTable.id,
        componentId: workOrderReservationsTable.componentId,
        componentName: productsTable.nameAr,
        sku: productsTable.sku,
        warehouseId: workOrderReservationsTable.warehouseId,
        quantity: workOrderReservationsTable.quantity,
        consumedQty: workOrderReservationsTable.consumedQty,
      })
      .from(workOrderReservationsTable)
      .leftJoin(productsTable, eq(workOrderReservationsTable.componentId, productsTable.id))
      .where(eq(workOrderReservationsTable.workOrderId, id));
    const consumptions = await db
      .select()
      .from(workOrderConsumptionsTable)
      .where(eq(workOrderConsumptionsTable.workOrderId, id))
      .orderBy(desc(workOrderConsumptionsTable.id));
    const productions = await db
      .select()
      .from(workOrderProductionsTable)
      .where(eq(workOrderProductionsTable.workOrderId, id))
      .orderBy(desc(workOrderProductionsTable.id));
    const checks = await db
      .select()
      .from(qualityChecksTable)
      .where(eq(qualityChecksTable.workOrderId, id));
    return res.json({
      ...wo,
      quantity: Number(wo.quantity),
      quantityProduced: Number(wo.quantityProduced),
      standardCost: Number(wo.standardCost),
      reservations: reservations.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        consumedQty: Number(r.consumedQty),
      })),
      consumptions: consumptions.map((c) => ({
        ...c,
        quantity: Number(c.quantity),
        unitCost: Number(c.unitCost),
      })),
      productions: productions.map((p) => ({
        ...p,
        quantity: Number(p.quantity),
        unitCost: Number(p.unitCost),
      })),
      qualityChecks: checks,
    });
  } catch (err) {
    req.log.error({ err }, "get work order failed");
    return respondError(res, err);
  }
});

const WorkOrderBody = z.object({
  bomId: z.coerce.number().int(),
  quantity: z.coerce.number().positive(),
  warehouseId: z.coerce.number().int().optional(),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/manufacturing/work-orders", productionGuard, async (req, res) => {
  try {
    const body = WorkOrderBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [bom] = await tx.select().from(bomsTable).where(eq(bomsTable.id, body.bomId)).limit(1);
      if (!bom) throw new HttpError(400, "قائمة المواد غير موجودة");
      if (!bom.isActive) throw new HttpError(400, "قائمة المواد غير مفعلة");
      const warehouseId = body.warehouseId ?? (await getDefaultWarehouseId(tx));
      const reference = await nextRef("WO");
      const stdCost = await costRollup(body.bomId);
      const unitCost = stdCost / Number(bom.quantity);
      const [wo] = await tx
        .insert(workOrdersTable)
        .values({
          reference,
          bomId: bom.id,
          productId: bom.productId,
          quantity: String(body.quantity),
          warehouseId,
          state: "draft",
          plannedStart: body.plannedStart ?? null,
          plannedEnd: body.plannedEnd ?? null,
          standardCost: String(unitCost),
          notes: body.notes ?? null,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      // Auto-instantiate BoM-level QC templates onto this work order so
      // every WO ships with the BoM's required checkpoints by default.
      const templates = await tx
        .select()
        .from(bomQcTemplatesTable)
        .where(eq(bomQcTemplatesTable.bomId, bom.id));
      for (const t of templates) {
        await tx.insert(qualityChecksTable).values({
          workOrderId: wo.id,
          operationId: t.operationId,
          name: t.name,
          nameAr: t.nameAr,
          isMandatory: t.isMandatory,
          notes: t.notes,
        });
      }
      return wo;
    });
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "create work order failed");
    respondError(res, err);
  }
});

// Confirm: explode the BoM (recursively expanding phantom assemblies),
// validate that enough on-hand stock exists net of existing reservations,
// then snapshot reservations. No stock moves until consume.
router.post("/manufacturing/work-orders/:id/confirm", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.transaction(async (tx) => {
      const [wo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).limit(1);
      if (!wo) throw new HttpError(404, "أمر الإنتاج غير موجود");
      if (wo.state !== "draft") throw new HttpError(409, "لا يمكن تأكيد أمر إنتاج بهذه الحالة");
      const [parentBom] = await tx
        .select({ qty: bomsTable.quantity })
        .from(bomsTable)
        .where(eq(bomsTable.id, wo.bomId))
        .limit(1);
      const ratio = Number(wo.quantity) / Number(parentBom.qty);
      const leaves = await explodeBom(wo.bomId, ratio);
      if (leaves.length === 0) throw new HttpError(400, "قائمة المواد لا تحتوي على مكونات");

      // Availability check per component: on-hand at the WO warehouse must
      // cover the requested quantity net of any other open reservations.
      for (const leaf of leaves) {
        const [{ onhand }] = (await tx.execute(sql`
          SELECT COALESCE(SUM(quantity)::float8, 0) AS onhand
            FROM stock_quants
           WHERE product_id = ${leaf.componentId}
             AND warehouse_id = ${wo.warehouseId}
        `) as unknown as { rows: Array<{ onhand: number }> }).rows;
        const [{ reserved }] = (await tx.execute(sql`
          SELECT COALESCE(SUM(quantity - consumed_qty)::float8, 0) AS reserved
            FROM work_order_reservations r
            JOIN work_orders w ON w.id = r.work_order_id
           WHERE r.component_id = ${leaf.componentId}
             AND r.warehouse_id = ${wo.warehouseId}
             AND w.state IN ('confirmed','in_progress')
        `) as unknown as { rows: Array<{ reserved: number }> }).rows;
        const available = Number(onhand) - Number(reserved);
        if (available < leaf.quantity - 0.0001) {
          const [p] = await tx
            .select({ name: productsTable.nameAr })
            .from(productsTable)
            .where(eq(productsTable.id, leaf.componentId))
            .limit(1);
          throw new HttpError(
            409,
            `كمية غير كافية للمكون ${p?.name ?? leaf.componentId}: المطلوب ${leaf.quantity.toFixed(2)}، المتاح ${available.toFixed(2)}`,
          );
        }
      }

      for (const leaf of leaves) {
        await tx.insert(workOrderReservationsTable).values({
          workOrderId: wo.id,
          componentId: leaf.componentId,
          warehouseId: wo.warehouseId,
          quantity: String(leaf.quantity),
        });
      }
      await tx
        .update(workOrdersTable)
        .set({ state: "confirmed" })
        .where(eq(workOrdersTable.id, id));
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "confirm work order failed");
    respondError(res, err);
  }
});

router.post("/manufacturing/work-orders/:id/start", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.transaction(async (tx) => {
      const [wo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).limit(1);
      if (!wo) throw new HttpError(404, "أمر الإنتاج غير موجود");
      if (wo.state !== "confirmed") throw new HttpError(409, "يجب تأكيد أمر الإنتاج أولاً");
      await tx
        .update(workOrdersTable)
        .set({ state: "in_progress", startedAt: new Date() })
        .where(eq(workOrdersTable.id, id));
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "start work order failed");
    respondError(res, err);
  }
});

// Internal: consume some/all open reservations into WIP. Issues stock
// (skipJournal) and posts Inventory Cr / WIP Dr per consumption batch.
// Returns total value moved Inventory -> WIP.
async function consumeWork(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  woId: number,
  pickRemaining: number,
  userId: number | null,
): Promise<number> {
  const [wo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, woId)).limit(1);
  if (!wo) throw new HttpError(404, "أمر الإنتاج غير موجود");
  const reservations = await tx
    .select()
    .from(workOrderReservationsTable)
    .where(eq(workOrderReservationsTable.workOrderId, woId));
  const totalRemaining = reservations.reduce(
    (s, r) => s + Math.max(0, Number(r.quantity) - Number(r.consumedQty)),
    0,
  );
  const fraction = pickRemaining >= 1 ? 1 : Math.max(0, Math.min(1, pickRemaining));
  if (totalRemaining <= 0.0001 || fraction <= 0) return 0;
  let consumedValue = 0;
  for (const r of reservations) {
    const remaining = Number(r.quantity) - Number(r.consumedQty);
    if (remaining <= 0.0001) continue;
    const take = remaining * fraction;
    const move = await recordStockMove(tx, {
      productId: r.componentId,
      fromWarehouseId: r.warehouseId,
      quantity: take,
      kind: "issue",
      sourceType: "work_order",
      sourceId: wo.id,
      sourceRef: wo.reference,
      createdBy: userId,
      skipJournal: true,
    });
    consumedValue += take * move.unitCost;
    await tx
      .update(workOrderReservationsTable)
      .set({ consumedQty: String(Number(r.consumedQty) + take) })
      .where(eq(workOrderReservationsTable.id, r.id));
    await tx.insert(workOrderConsumptionsTable).values({
      workOrderId: wo.id,
      componentId: r.componentId,
      quantity: String(take),
      unitCost: String(move.unitCost),
      stockMoveId: move.moveId,
    });
  }
  if (consumedValue > 0) {
    await postJournalEntry(
      tx,
      {
        entryDate: new Date(),
        description: `استهلاك مكونات — ${wo.reference}`,
        reference: wo.reference,
        source: "system",
        sourceRef: `WO-CONS-${wo.id}`,
        createdBy: userId,
        status: "posted",
      },
      [
        { systemKey: "wip", debit: consumedValue, description: `WIP — ${wo.reference}` },
        { systemKey: "inventory", credit: consumedValue },
      ],
    );
  }
  return consumedValue;
}

// Internal: produce `qty` finished units out of WIP into finished_goods at
// the WO standard cost. Posts Finished Goods Dr / WIP Cr.
async function produceWork(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  woId: number,
  qty: number,
  userId: number | null,
): Promise<number> {
  const [wo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, woId)).limit(1);
  if (!wo) throw new HttpError(404, "أمر الإنتاج غير موجود");
  const remaining = Number(wo.quantity) - Number(wo.quantityProduced);
  if (qty > remaining + 0.0001) {
    throw new HttpError(409, `الكمية تتجاوز المتبقي (${remaining.toFixed(2)})`);
  }
  const finishedUnitCost = Number(wo.standardCost);
  const finishedValue = finishedUnitCost * qty;
  const move = await recordStockMove(tx, {
    productId: wo.productId,
    toWarehouseId: wo.warehouseId,
    quantity: qty,
    unitCost: finishedUnitCost,
    kind: "receipt",
    sourceType: "work_order",
    sourceId: wo.id,
    sourceRef: wo.reference,
    createdBy: userId,
    skipJournal: true,
  });
  await tx.insert(workOrderProductionsTable).values({
    workOrderId: wo.id,
    quantity: String(qty),
    unitCost: String(finishedUnitCost),
    stockMoveId: move.moveId,
  });
  if (finishedValue > 0) {
    await postJournalEntry(
      tx,
      {
        entryDate: new Date(),
        description: `إنتاج تام — ${wo.reference}`,
        reference: wo.reference,
        source: "system",
        sourceRef: `WO-PROD-${wo.id}`,
        createdBy: userId,
        status: "posted",
      },
      [
        { systemKey: "finished_goods", debit: finishedValue, description: `بضاعة تامة ${wo.reference}` },
        { systemKey: "wip", credit: finishedValue },
      ],
    );
  }
  await tx
    .update(workOrdersTable)
    .set({ quantityProduced: String(Number(wo.quantityProduced) + qty) })
    .where(eq(workOrdersTable.id, wo.id));
  return finishedValue;
}

async function assertNoFailedQc(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  woId: number,
): Promise<void> {
  const failed = await tx
    .select({ id: qualityChecksTable.id })
    .from(qualityChecksTable)
    .where(
      and(
        eq(qualityChecksTable.workOrderId, woId),
        eq(qualityChecksTable.isMandatory, true),
        eq(qualityChecksTable.result, "fail"),
      ),
    );
  if (failed.length > 0) {
    throw new HttpError(409, "يوجد فحوصات جودة فاشلة — لا يمكن المتابعة");
  }
}

// Explicit consume endpoint: move some/all reserved components into WIP
// without producing finished goods yet. Body: { fraction?: 0..1 }
// (defaults to 1 = consume everything still reserved).
router.post("/manufacturing/work-orders/:id/consume", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = z.object({ fraction: z.coerce.number().min(0).max(1).optional() });
    const body = Body.parse(req.body ?? {});
    const consumed = await db.transaction(async (tx) => {
      const [wo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).limit(1);
      if (!wo) throw new HttpError(404, "أمر الإنتاج غير موجود");
      if (wo.state !== "in_progress") {
        throw new HttpError(409, "ابدأ أمر الإنتاج أولاً");
      }
      return await consumeWork(tx, id, body.fraction ?? 1, req.session?.userId ?? null);
    });
    res.json({ ok: true, consumedValue: consumed });
  } catch (err) {
    req.log.error({ err }, "consume failed");
    respondError(res, err);
  }
});

// Explicit produce endpoint: clear `quantity` finished units from WIP
// into Finished Goods at standard cost. Blocks on any failed mandatory QC.
router.post("/manufacturing/work-orders/:id/produce", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = z.object({ quantity: z.coerce.number().positive() });
    const body = Body.parse(req.body ?? {});
    const finished = await db.transaction(async (tx) => {
      const [wo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).limit(1);
      if (!wo) throw new HttpError(404, "أمر الإنتاج غير موجود");
      if (wo.state !== "in_progress") {
        throw new HttpError(409, "ابدأ أمر الإنتاج أولاً");
      }
      // Enforce that some consumption has occurred before any production,
      // so WIP cannot go negative.
      const [{ consumed }] = (await tx.execute(sql`
        SELECT COALESCE(SUM(quantity * unit_cost)::float8, 0) AS consumed
          FROM work_order_consumptions WHERE work_order_id = ${id}
      `) as unknown as { rows: Array<{ consumed: number }> }).rows;
      const [{ produced }] = (await tx.execute(sql`
        SELECT COALESCE(SUM(quantity * unit_cost)::float8, 0) AS produced
          FROM work_order_productions WHERE work_order_id = ${id}
      `) as unknown as { rows: Array<{ produced: number }> }).rows;
      const wipBalance = Number(consumed) - Number(produced);
      const wouldProduce = Number(wo.standardCost) * body.quantity;
      if (wouldProduce > wipBalance + 0.0001) {
        throw new HttpError(409, "يجب استهلاك المكونات قبل الإنتاج لتجنّب رصيد سالب على حساب تحت التشغيل");
      }
      await assertNoFailedQc(tx, id);
      return await produceWork(tx, id, body.quantity, req.session?.userId ?? null);
    });
    res.json({ ok: true, finishedValue: finished });
  } catch (err) {
    req.log.error({ err }, "produce failed");
    respondError(res, err);
  }
});

// Complete (Done): finalize — consume any remaining reservations, produce
// all remaining planned quantity (no partial completion), then clear any
// residual WIP balance to COGS as a manufacturing variance. Mandatory QC
// checks must all pass first.
router.post("/manufacturing/work-orders/:id/complete", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const out = await db.transaction(async (tx) => {
      const [wo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).limit(1);
      if (!wo) throw new HttpError(404, "أمر الإنتاج غير موجود");
      if (wo.state !== "in_progress") {
        throw new HttpError(409, "ابدأ أمر الإنتاج قبل إنهائه");
      }
      await assertNoFailedQc(tx, id);
      const pendingMandatory = await tx
        .select({ id: qualityChecksTable.id })
        .from(qualityChecksTable)
        .where(
          and(
            eq(qualityChecksTable.workOrderId, id),
            eq(qualityChecksTable.isMandatory, true),
            eq(qualityChecksTable.result, "pending"),
          ),
        );
      if (pendingMandatory.length > 0) {
        throw new HttpError(409, "يوجد فحوصات جودة إلزامية لم تُنجز");
      }
      // Always consume everything still reserved before finishing.
      const consumedValue = await consumeWork(tx, id, 1, req.session?.userId ?? null);
      // Produce the full remaining planned quantity — no partial completion.
      const remaining = Number(wo.quantity) - Number(wo.quantityProduced);
      let finishedValue = 0;
      if (remaining > 0.0001) {
        finishedValue = await produceWork(tx, id, remaining, req.session?.userId ?? null);
      }
      // Clear any residual WIP balance for this WO to COGS as a variance.
      const [{ consumedTot }] = (await tx.execute(sql`
        SELECT COALESCE(SUM(quantity * unit_cost)::float8, 0) AS "consumedTot"
          FROM work_order_consumptions WHERE work_order_id = ${id}
      `) as unknown as { rows: Array<{ consumedTot: number }> }).rows;
      const [{ producedTot }] = (await tx.execute(sql`
        SELECT COALESCE(SUM(quantity * unit_cost)::float8, 0) AS "producedTot"
          FROM work_order_productions WHERE work_order_id = ${id}
      `) as unknown as { rows: Array<{ producedTot: number }> }).rows;
      const wipResidual = Number(consumedTot) - Number(producedTot);
      let variance = 0;
      if (Math.abs(wipResidual) > 0.005) {
        variance = wipResidual;
        const lines =
          wipResidual > 0
            ? [
                { systemKey: "cogs", debit: wipResidual, description: `فرق تصنيع — ${wo.reference}` },
                { systemKey: "wip", credit: wipResidual },
              ]
            : [
                { systemKey: "wip", debit: -wipResidual, description: `فرق تصنيع مفضّل — ${wo.reference}` },
                { systemKey: "cogs", credit: -wipResidual },
              ];
        await postJournalEntry(
          tx,
          {
            entryDate: new Date(),
            description: `تسوية حساب تحت التشغيل — ${wo.reference}`,
            reference: wo.reference,
            source: "system",
            sourceRef: `WO-VAR-${wo.id}`,
            createdBy: req.session?.userId ?? null,
            status: "posted",
          },
          lines,
        );
      }
      await tx
        .update(workOrdersTable)
        .set({
          state: "done",
          completedAt: new Date(),
          completedBy: req.session?.userId ?? null,
        })
        .where(eq(workOrdersTable.id, id));
      return { id: wo.id, producedQty: remaining, consumedValue, finishedValue, variance };
    });
    res.json({ ok: true, ...out });
  } catch (err) {
    req.log.error({ err }, "complete work order failed");
    respondError(res, err);
  }
});

// Cancel: only allowed BEFORE execution starts (draft / confirmed). Once a
// WO is in_progress there are real consumed components, WIP entries, and
// possibly finished-goods receipts — those require explicit reversal which
// we do not implement here, so we refuse the cancel rather than leave
// stranded inventory and journal entries.
router.post("/manufacturing/work-orders/:id/cancel", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.transaction(async (tx) => {
      const [wo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).limit(1);
      if (!wo) throw new HttpError(404, "أمر الإنتاج غير موجود");
      if (wo.state === "done") throw new HttpError(409, "لا يمكن إلغاء أمر إنتاج منتهٍ");
      if (wo.state === "cancelled") throw new HttpError(409, "أمر الإنتاج ملغى مسبقاً");
      if (wo.state === "in_progress") {
        throw new HttpError(409, "تم بدء التنفيذ — لا يمكن الإلغاء بعد استهلاك المكونات");
      }
      // For confirmed WOs, release the reservations so other orders can
      // use the planned-but-untouched inventory.
      if (wo.state === "confirmed") {
        await tx.delete(workOrderReservationsTable).where(eq(workOrderReservationsTable.workOrderId, id));
      }
      await tx
        .update(workOrdersTable)
        .set({ state: "cancelled" })
        .where(eq(workOrdersTable.id, id));
    });
    res.json({ ok: true });
  } catch (err) {
    respondError(res, err);
  }
});

// ===========================================================================
// Quality Checks
// ===========================================================================

const QcBody = z.object({
  workOrderId: z.coerce.number().int(),
  operationId: z.coerce.number().int().optional(),
  name: z.string().min(1),
  nameAr: z.string().min(1),
  isMandatory: z.boolean().default(true),
});

router.post("/manufacturing/quality-checks", productionGuard, async (req, res) => {
  try {
    const body = QcBody.parse(req.body);
    const [row] = await db.insert(qualityChecksTable).values({
      workOrderId: body.workOrderId,
      operationId: body.operationId ?? null,
      name: body.name,
      nameAr: body.nameAr,
      isMandatory: body.isMandatory,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "create QC failed");
    respondError(res, err);
  }
});

const QcResultBody = z.object({
  result: z.enum(["pass", "fail"]),
  notes: z.string().optional(),
});

router.post("/manufacturing/quality-checks/:id/result", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = QcResultBody.parse(req.body);
    await db
      .update(qualityChecksTable)
      .set({
        result: body.result,
        notes: body.notes ?? null,
        checkedBy: req.session?.userId ?? null,
        checkedAt: new Date(),
      })
      .where(eq(qualityChecksTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    respondError(res, err);
  }
});

// ===========================================================================
// Scrap
// ===========================================================================

const ScrapBody = z.object({
  productId: z.coerce.number().int(),
  quantity: z.coerce.number().positive(),
  fromWarehouseId: z.coerce.number().int(),
  workOrderId: z.coerce.number().int().optional(),
  reason: z.enum(["defect", "damaged", "expired", "qc_fail", "other"]).default("other"),
  notes: z.string().optional(),
});

router.get("/manufacturing/scrap", inventoryReadGuard, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: scrapRecordsTable.id,
        reference: scrapRecordsTable.reference,
        productId: scrapRecordsTable.productId,
        productName: productsTable.nameAr,
        sku: productsTable.sku,
        quantity: scrapRecordsTable.quantity,
        fromWarehouseId: scrapRecordsTable.fromWarehouseId,
        warehouseName: warehousesTable.nameAr,
        workOrderId: scrapRecordsTable.workOrderId,
        reason: scrapRecordsTable.reason,
        notes: scrapRecordsTable.notes,
        reworkedAt: scrapRecordsTable.reworkedAt,
        createdAt: scrapRecordsTable.createdAt,
      })
      .from(scrapRecordsTable)
      .leftJoin(productsTable, eq(scrapRecordsTable.productId, productsTable.id))
      .leftJoin(warehousesTable, eq(scrapRecordsTable.fromWarehouseId, warehousesTable.id))
      .orderBy(desc(scrapRecordsTable.id))
      .limit(200);
    res.json(rows.map((r) => ({ ...r, quantity: Number(r.quantity) })));
  } catch (err) {
    respondError(res, err);
  }
});

// Resolve the dedicated Scrap warehouse for a given source warehouse's
// branch (seeded by manufacturing-init). Falls back to any warehouse named
// 'Scrap'. Returns null only if the seed never ran (we then refuse the move).
async function findScrapWarehouseId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  fromWarehouseId: number,
): Promise<number | null> {
  const r = (await tx.execute(sql`
    WITH src AS (SELECT branch_id FROM warehouses WHERE id = ${fromWarehouseId})
    SELECT id FROM warehouses
     WHERE name = 'Scrap'
       AND branch_id = (SELECT branch_id FROM src)
     LIMIT 1
  `)) as unknown as { rows: Array<{ id: number }> };
  if (r.rows[0]) return r.rows[0].id;
  const r2 = (await tx.execute(sql`SELECT id FROM warehouses WHERE name = 'Scrap' LIMIT 1`)) as unknown as { rows: Array<{ id: number }> };
  return r2.rows[0]?.id ?? null;
}

router.post("/manufacturing/scrap", productionGuard, async (req, res) => {
  try {
    const body = ScrapBody.parse(req.body);
    const out = await db.transaction(async (tx) => {
      const reference = await nextRef("SCR");
      const scrapWhId = await findScrapWarehouseId(tx, body.fromWarehouseId);
      if (!scrapWhId) {
        throw new HttpError(500, "لا يوجد مستودع تالف مهيأ");
      }
      if (scrapWhId === body.fromWarehouseId) {
        throw new HttpError(400, "لا يمكن إتلاف من مستودع التالف نفسه");
      }
      // 1) Issue from source warehouse (skipJournal — we post our own).
      const issueMove = await recordStockMove(tx, {
        productId: body.productId,
        fromWarehouseId: body.fromWarehouseId,
        quantity: body.quantity,
        kind: "issue",
        sourceType: "scrap",
        sourceRef: reference,
        notes: body.notes ?? body.reason,
        createdBy: req.session?.userId ?? null,
        skipJournal: true,
      });
      const value = body.quantity * issueMove.unitCost;
      // 2) Receipt into the dedicated Scrap warehouse so the scrapped
      //    quantity has a real physical location (cost preserved).
      await recordStockMove(tx, {
        productId: body.productId,
        toWarehouseId: scrapWhId,
        quantity: body.quantity,
        unitCost: issueMove.unitCost,
        kind: "receipt",
        sourceType: "scrap",
        sourceRef: reference,
        notes: `Scrap from ${body.fromWarehouseId}`,
        createdBy: req.session?.userId ?? null,
        skipJournal: true,
      });
      // 3) Write off the value: Scrap Loss Dr / Inventory Cr.
      let journalEntryId: number | null = null;
      if (value > 0) {
        const j = await postJournalEntry(
          tx,
          {
            entryDate: new Date(),
            description: `إتلاف مخزون — ${reference} (${body.reason})`,
            reference,
            source: "system",
            sourceRef: `SCRAP-${reference}`,
            createdBy: req.session?.userId ?? null,
            status: "posted",
          },
          [
            { systemKey: "scrap_loss", debit: value, description: `خسارة إتلاف ${body.reason}` },
            { systemKey: "inventory", credit: value },
          ],
        );
        journalEntryId = j.id;
      }
      const [row] = await tx
        .insert(scrapRecordsTable)
        .values({
          reference,
          productId: body.productId,
          quantity: String(body.quantity),
          fromWarehouseId: body.fromWarehouseId,
          toWarehouseId: scrapWhId,
          workOrderId: body.workOrderId ?? null,
          reason: body.reason,
          notes: body.notes ?? null,
          stockMoveId: issueMove.moveId,
          journalEntryId,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      return row;
    });
    res.status(201).json(out);
  } catch (err) {
    req.log.error({ err }, "scrap create failed");
    respondError(res, err);
  }
});

// Rework a scrap record: pull the scrapped qty back out of the Scrap
// warehouse into the source warehouse, reverse the loss journal, and
// optionally open a child rework Work Order linked to the original WO.
router.post("/manufacturing/scrap/:id/rework", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const out = await db.transaction(async (tx) => {
      const [scrap] = await tx
        .select()
        .from(scrapRecordsTable)
        .where(eq(scrapRecordsTable.id, id))
        .limit(1);
      if (!scrap) throw new HttpError(404, "سجل الإتلاف غير موجود");
      if (scrap.reworkedAt) throw new HttpError(409, "تمت المعالجة مسبقاً");
      if (!scrap.toWarehouseId) {
        throw new HttpError(409, "لا يوجد مستودع تالف لاستعادة المنتج منه");
      }
      const qty = Number(scrap.quantity);
      // Issue out of scrap warehouse.
      const issueMove = await recordStockMove(tx, {
        productId: scrap.productId,
        fromWarehouseId: scrap.toWarehouseId,
        quantity: qty,
        kind: "issue",
        sourceType: "scrap_rework",
        sourceRef: scrap.reference,
        createdBy: req.session?.userId ?? null,
        skipJournal: true,
      });
      // Receipt back into source warehouse.
      await recordStockMove(tx, {
        productId: scrap.productId,
        toWarehouseId: scrap.fromWarehouseId,
        quantity: qty,
        unitCost: issueMove.unitCost,
        kind: "receipt",
        sourceType: "scrap_rework",
        sourceRef: scrap.reference,
        createdBy: req.session?.userId ?? null,
        skipJournal: true,
      });
      // Reverse the scrap-loss journal: Inventory Dr / Scrap Loss Cr.
      const value = qty * issueMove.unitCost;
      if (value > 0) {
        await postJournalEntry(
          tx,
          {
            entryDate: new Date(),
            description: `إعادة معالجة — ${scrap.reference}`,
            reference: scrap.reference,
            source: "system",
            sourceRef: `REWORK-${scrap.reference}`,
            createdBy: req.session?.userId ?? null,
            status: "posted",
          },
          [
            { systemKey: "inventory", debit: value, description: `استرداد إتلاف ${scrap.reference}` },
            { systemKey: "scrap_loss", credit: value },
          ],
        );
      }
      // Optional child rework WO if the scrap belonged to a WO.
      let reworkWoId: number | null = null;
      if (scrap.workOrderId) {
        const [parent] = await tx
          .select()
          .from(workOrdersTable)
          .where(eq(workOrdersTable.id, scrap.workOrderId))
          .limit(1);
        if (parent) {
          const reference = await nextRef("WO");
          const [child] = await tx
            .insert(workOrdersTable)
            .values({
              reference,
              bomId: parent.bomId,
              productId: parent.productId,
              quantity: String(qty),
              warehouseId: parent.warehouseId,
              state: "draft",
              standardCost: parent.standardCost,
              notes: `إعادة معالجة من ${scrap.reference}`,
              parentWorkOrderId: parent.id,
              isRework: true,
              createdBy: req.session?.userId ?? null,
            })
            .returning();
          reworkWoId = child.id;
        }
      }
      await tx
        .update(scrapRecordsTable)
        .set({ reworkedAt: new Date() })
        .where(eq(scrapRecordsTable.id, id));
      return { ok: true, reworkWoId };
    });
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "rework failed");
    respondError(res, err);
  }
});

// ===========================================================================
// Production schedule (capacity-vs-load per work center, weekly grid)
// ===========================================================================

router.get("/manufacturing/schedule", inventoryReadGuard, async (req, res) => {
  try {
    const rows = await db
      .select({
        workCenterId: routingOperationsTable.workCenterId,
        workCenterName: workCentersTable.nameAr,
        capacityPerDay: workCentersTable.capacityPerDay,
        plannedStart: workOrdersTable.plannedStart,
        plannedEnd: workOrdersTable.plannedEnd,
        woId: workOrdersTable.id,
        woRef: workOrdersTable.reference,
        productName: productsTable.nameAr,
        quantity: workOrdersTable.quantity,
        durationMinutes: routingOperationsTable.durationMinutes,
        state: workOrdersTable.state,
      })
      .from(workOrdersTable)
      .leftJoin(bomsTable, eq(workOrdersTable.bomId, bomsTable.id))
      .leftJoin(routingOperationsTable, eq(bomsTable.routingId, routingOperationsTable.routingId))
      .leftJoin(workCentersTable, eq(routingOperationsTable.workCenterId, workCentersTable.id))
      .leftJoin(productsTable, eq(workOrdersTable.productId, productsTable.id))
      .where(sql`${workOrdersTable.state} IN ('confirmed','in_progress','draft')`);
    res.json(
      rows.map((r) => ({
        ...r,
        capacityPerDay: r.capacityPerDay ? Number(r.capacityPerDay) : null,
        durationMinutes: r.durationMinutes ? Number(r.durationMinutes) : 0,
        quantity: Number(r.quantity),
      })),
    );
  } catch (err) {
    respondError(res, err);
  }
});

// ===========================================================================
// Reports: throughput, on-time, scrap rate, utilization
// ===========================================================================

router.get("/manufacturing/reports/summary", inventoryReadGuard, async (req, res) => {
  try {
    const [done] = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_done,
        COALESCE(SUM(quantity_produced)::float8, 0) AS total_produced,
        COALESCE(SUM(CASE WHEN planned_end IS NOT NULL
                          AND completed_at::date <= planned_end
                          THEN 1 ELSE 0 END)::float8, 0) AS on_time
        FROM work_orders WHERE state = 'done'
    `).then((r) => (r as unknown as { rows: any[] }).rows);

    const [scrap] = await db.execute(sql`
      SELECT
        COALESCE(SUM(quantity)::float8, 0) AS scrap_qty,
        COUNT(*)::int AS scrap_events
        FROM scrap_records
    `).then((r) => (r as unknown as { rows: any[] }).rows);

    const [util] = await db.execute(sql`
      SELECT COUNT(*)::int AS active_centers FROM work_centers WHERE is_active = true
    `).then((r) => (r as unknown as { rows: any[] }).rows);

    // Window utilization (last 30 days) = booked_minutes / capacity_minutes
    // booked_minutes = Σ (op.duration_minutes × wo.quantity) across non-cancelled WOs
    const utilRows = (await db.execute(sql`
      WITH booked AS (
        SELECT ro.work_center_id,
               COALESCE(SUM(ro.duration_minutes * wo.quantity)::float8, 0) AS minutes
          FROM work_orders wo
          JOIN boms b ON b.id = wo.bom_id
          JOIN routing_operations ro ON ro.routing_id = b.routing_id
         WHERE wo.state IN ('confirmed','in_progress','done')
           AND wo.created_at >= now() - interval '30 days'
         GROUP BY ro.work_center_id
      )
      SELECT wc.id, wc.code, wc.name_ar AS name_ar,
             wc.capacity_per_day::float8 AS capacity_per_day,
             COALESCE(b.minutes, 0)::float8 AS booked_minutes,
             (wc.capacity_per_day::float8 * 60.0 * 30.0) AS capacity_minutes
        FROM work_centers wc
        LEFT JOIN booked b ON b.work_center_id = wc.id
       WHERE wc.is_active = true
       ORDER BY wc.id
    `).then((r) => (r as unknown as { rows: any[] }).rows));
    const utilization = utilRows.map((r: any) => ({
      workCenterId: Number(r.id),
      code: r.code,
      nameAr: r.name_ar,
      bookedMinutes: Number(r.booked_minutes),
      capacityMinutes: Number(r.capacity_minutes),
      utilization: Number(r.capacity_minutes) > 0 ? Number(r.booked_minutes) / Number(r.capacity_minutes) : 0,
    }));

    const totalDone = Number(done?.total_done ?? 0);
    const onTime = Number(done?.on_time ?? 0);
    const totalProduced = Number(done?.total_produced ?? 0);
    const scrapQty = Number(scrap?.scrap_qty ?? 0);
    const scrapRate = totalProduced + scrapQty > 0 ? scrapQty / (totalProduced + scrapQty) : 0;
    res.json({
      throughput: totalProduced,
      ordersCompleted: totalDone,
      onTimePct: totalDone > 0 ? onTime / totalDone : 0,
      scrapEvents: Number(scrap?.scrap_events ?? 0),
      scrapQuantity: scrapQty,
      scrapRate,
      activeWorkCenters: Number(util?.active_centers ?? 0),
      utilization,
    });
  } catch (err) {
    respondError(res, err);
  }
});

export default router;
