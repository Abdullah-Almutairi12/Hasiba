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
import {
  recordStockMove,
  getDefaultWarehouseId,
  getOrCreateLot,
} from "../lib/stock-engine";
import { stockLotsTable, stockSerialsTable } from "@workspace/db";
import { postJournalEntry } from "../lib/journal-posting";
import { getCompanyId } from "../lib/scoped-db";
import { supplyScope, supplyParam, supplyReferencesGuard, requireSupplyReference } from "../lib/supply-chain-scope";

const router = Router();
router.use("/manufacturing", supplyReferencesGuard);
router.param("id", supplyParam((path) =>
  path.includes("/boms/") ? "bom" :
  path.includes("/work-orders/") ? "workOrder" :
  path.includes("/quality-checks/") ? "qualityCheck" :
  path.includes("/scrap/") ? "scrap" : undefined));

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
      .where(supplyScope("bom", bomsTable.id, getCompanyId(req)))
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
          companyId: getCompanyId(req),
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
  companyId: number,
  acc: Map<number, number> = new Map(),
): Promise<LeafReq[]> {
  await requireSupplyReference("bom", bomId, companyId);
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
          supplyScope("bom", bomsTable.id, companyId),
          eq(bomsTable.isPhantom, true),
          eq(bomsTable.isActive, true),
        ),
      )
      .limit(1);
    if (phantom) {
      // Producing `qty` of the phantom needs (qty / phantom.qty) batches.
      await explodeBom(phantom.id, qty / Number(phantom.qty), companyId, acc);
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
async function costRollup(bomId: number, companyId: number): Promise<number> {
  await requireSupplyReference("bom", bomId, companyId);
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
          supplyScope("bom", bomsTable.id, companyId),
          eq(bomsTable.isPhantom, true),
          eq(bomsTable.isActive, true),
        ),
      )
      .limit(1);
    if (phantom) {
      const sub = await costRollup(phantom.id, companyId);
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
    const total = await costRollup(id, getCompanyId(req));
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
    const rows = await db.select().from(workCentersTable).where(supplyScope("workCenter", workCentersTable.id, getCompanyId(req))).orderBy(workCentersTable.code);
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
        companyId: getCompanyId(req),
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
    const routings = await db.select().from(routingsTable).where(supplyScope("routing", routingsTable.id, getCompanyId(req))).orderBy(desc(routingsTable.id));
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
      .where(supplyScope("operation", routingOperationsTable.id, getCompanyId(req)))
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
        .values({ companyId: getCompanyId(req), reference, name: body.name, nameAr: body.nameAr })
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
    const conds = [supplyScope("workOrder", workOrdersTable.id, getCompanyId(req)), ...(state ? [eq(workOrdersTable.state, state)] : [])];
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
        trackingMode: productsTable.trackingMode,
      })
      .from(workOrderReservationsTable)
      .leftJoin(productsTable, eq(workOrderReservationsTable.componentId, productsTable.id))
      .where(eq(workOrderReservationsTable.workOrderId, id));
    // Per-reservation availability of lots / serials at the WO warehouse
    // so the operator can pick which lot/serial to consume.
    const availability = await Promise.all(
      reservations.map(async (r) => {
        if (r.trackingMode === "lot") {
          const lots = (await db.execute(sql`
            SELECT l.id AS lot_id, l.lot_number, l.expiry_date,
                   q.quantity::float8 AS quantity
              FROM stock_quants q
              JOIN stock_lots l ON l.id = q.lot_id
             WHERE q.product_id = ${r.componentId}
               AND q.warehouse_id = ${r.warehouseId}
               AND ${supplyScope("quant", sql`q.id`, getCompanyId(req))}
               AND q.quantity > 0
             ORDER BY l.expiry_date NULLS LAST, l.id ASC
          `) as unknown as { rows: Array<{ lot_id: number; lot_number: string; expiry_date: string | null; quantity: number }> }).rows;
          return {
            reservationId: r.id,
            lots: lots.map((x) => ({
              lotId: x.lot_id,
              lotNumber: x.lot_number,
              expiryDate: x.expiry_date,
              quantity: Number(x.quantity),
            })),
            serials: [] as Array<{ serialId: number; serialNumber: string }>,
          };
        }
        if (r.trackingMode === "serial") {
          const serials = (await db.execute(sql`
            SELECT s.id AS serial_id, s.serial_number
              FROM stock_serials s
             WHERE s.product_id = ${r.componentId}
               AND s.current_warehouse_id = ${r.warehouseId}
               AND s.state = 'in_stock'
             ORDER BY s.id ASC
          `) as unknown as { rows: Array<{ serial_id: number; serial_number: string }> }).rows;
          return {
            reservationId: r.id,
            lots: [] as Array<{ lotId: number; lotNumber: string; expiryDate: string | null; quantity: number }>,
            serials: serials.map((x) => ({ serialId: x.serial_id, serialNumber: x.serial_number })),
          };
        }
        return {
          reservationId: r.id,
          lots: [] as Array<{ lotId: number; lotNumber: string; expiryDate: string | null; quantity: number }>,
          serials: [] as Array<{ serialId: number; serialNumber: string }>,
        };
      }),
    );
    const availabilityMap = new Map(availability.map((a) => [a.reservationId, a]));
    const [productInfo] = await db
      .select({ trackingMode: productsTable.trackingMode })
      .from(productsTable)
      .where(eq(productsTable.id, wo.productId))
      .limit(1);
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
      productTrackingMode: productInfo?.trackingMode ?? "none",
      reservations: reservations.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        consumedQty: Number(r.consumedQty),
        availableLots: availabilityMap.get(r.id)?.lots ?? [],
        availableSerials: availabilityMap.get(r.id)?.serials ?? [],
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
      const warehouseId = body.warehouseId ?? (await getDefaultWarehouseId(tx, getCompanyId(req)));
      const reference = await nextRef("WO");
      const stdCost = await costRollup(body.bomId, getCompanyId(req));
      const unitCost = stdCost / Number(bom.quantity);
      const [wo] = await tx
        .insert(workOrdersTable)
        .values({
          companyId: getCompanyId(req),
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

// Reschedule planned start/end dates (used by the visual schedule calendar).
const WorkOrderPatchBody = z.object({
  plannedStart: z.string().nullable().optional(),
  plannedEnd: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.patch("/manufacturing/work-orders/:id", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, "معرف غير صالح");
    const body = WorkOrderPatchBody.parse(req.body);
    const [existing] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).limit(1);
    if (!existing) throw new HttpError(404, "أمر الإنتاج غير موجود");
    if (existing.state === "done" || existing.state === "cancelled") {
      throw new HttpError(409, "لا يمكن إعادة جدولة أمر إنتاج مكتمل أو ملغى");
    }
    const updates: Record<string, unknown> = {};
    if (body.plannedStart !== undefined) updates.plannedStart = body.plannedStart;
    if (body.plannedEnd !== undefined) updates.plannedEnd = body.plannedEnd;
    if (body.notes !== undefined) updates.notes = body.notes;
    // Validate against the effective final values (merge of request + existing),
    // not just the fields that happen to be in this request body.
    const effStart = body.plannedStart !== undefined ? body.plannedStart : existing.plannedStart;
    const effEnd = body.plannedEnd !== undefined ? body.plannedEnd : existing.plannedEnd;
    if (typeof effStart === "string" && typeof effEnd === "string" && effEnd < effStart) {
      throw new HttpError(400, "تاريخ النهاية يجب أن يكون بعد تاريخ البداية");
    }
    if (Object.keys(updates).length === 0) {
      return res.json(existing);
    }
    const [updated] = await db
      .update(workOrdersTable)
      .set(updates)
      .where(eq(workOrdersTable.id, id))
      .returning();
    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "patch work order failed");
    return respondError(res, err);
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
      const leaves = await explodeBom(wo.bomId, ratio, getCompanyId(req));
      if (leaves.length === 0) throw new HttpError(400, "قائمة المواد لا تحتوي على مكونات");

      // Availability check per component: on-hand at the WO warehouse must
      // cover the requested quantity net of any other open reservations.
      for (const leaf of leaves) {
        const [{ onhand }] = (await tx.execute(sql`
          SELECT COALESCE(SUM(quantity)::float8, 0) AS onhand
            FROM stock_quants
           WHERE product_id = ${leaf.componentId}
             AND warehouse_id = ${wo.warehouseId}
             AND ${supplyScope("quant", sql`stock_quants.id`, getCompanyId(req))}
        `) as unknown as { rows: Array<{ onhand: number }> }).rows;
        const [{ reserved }] = (await tx.execute(sql`
          SELECT COALESCE(SUM(r.quantity - r.consumed_qty)::float8, 0) AS reserved
            FROM work_order_reservations r
            JOIN work_orders w ON w.id = r.work_order_id
           WHERE r.component_id = ${leaf.componentId}
             AND r.warehouse_id = ${wo.warehouseId}
             AND w.state IN ('confirmed','in_progress')
             AND w.company_id = ${getCompanyId(req)}
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

// Per-reservation pick override: each slice consumes from a specific lot
// or serial instead of the default FEFO behavior. Slice quantities must
// sum to the requested take for the reservation.
type ReservationPick = {
  reservationId: number;
  slices: Array<{ lotId?: number | null; serialId?: number | null; quantity: number }>;
};

// Internal: consume some/all open reservations into WIP. Issues stock
// (skipJournal) and posts Inventory Cr / WIP Dr per consumption batch.
// Returns total value moved Inventory -> WIP.
async function consumeWork(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  woId: number,
  pickRemaining: number,
  userId: number | null,
  companyId: number,
  picks?: ReservationPick[],
): Promise<number> {
  const [wo] = await tx.select().from(workOrdersTable).where(and(eq(workOrdersTable.id, woId), supplyScope("workOrder", workOrdersTable.id, companyId))).limit(1);
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
  const pickMap = new Map<number, ReservationPick>();
  for (const p of picks ?? []) pickMap.set(p.reservationId, p);
  let consumedValue = 0;
  for (const r of reservations) {
    const remaining = Number(r.quantity) - Number(r.consumedQty);
    if (remaining <= 0.0001) continue;
    const take = remaining * fraction;
    const pick = pickMap.get(r.id);
    // Build the slice list. With no pick override we issue one slice with
    // no lot/serial — the stock-engine will auto-FEFO if the component is
    // lot-tracked, or refuse outright if it is serial-tracked (we then
    // require an explicit pick at the route layer).
    const slices = pick?.slices && pick.slices.length > 0
      ? pick.slices
      : [{ lotId: null, serialId: null, quantity: take }];
    const sliceTotal = slices.reduce((s, x) => s + Number(x.quantity), 0);
    if (Math.abs(sliceTotal - take) > 0.0001) {
      throw new HttpError(
        400,
        `إجمالي الانتقاءات (${sliceTotal.toFixed(2)}) لا يطابق الكمية المطلوبة (${take.toFixed(2)})`,
      );
    }
    let totalQtyForRes = 0;
    for (const slice of slices) {
      const sliceQty = Number(slice.quantity);
      if (!(sliceQty > 0)) continue;
      // Validate that the picked lot/serial belongs to this reservation's
      // component, and (for serials) is currently in stock at the
      // reservation's warehouse. Prevents traceability drift from a
      // crafted/stale picker payload.
      if (slice.lotId != null) {
        const [lot] = await tx
          .select({ productId: stockLotsTable.productId })
          .from(stockLotsTable)
          .where(eq(stockLotsTable.id, slice.lotId))
          .limit(1);
        if (!lot || lot.productId !== r.componentId) {
          throw new HttpError(400, `التشغيلة المختارة لا تنتمي للمكون "${r.componentId}"`);
        }
      }
      if (slice.serialId != null) {
        const [sn] = await tx
          .select({
            productId: stockSerialsTable.productId,
            warehouseId: stockSerialsTable.currentWarehouseId,
            state: stockSerialsTable.state,
          })
          .from(stockSerialsTable)
          .where(eq(stockSerialsTable.id, slice.serialId))
          .limit(1);
        if (!sn || sn.productId !== r.componentId) {
          throw new HttpError(400, "الرقم التسلسلي المختار لا يطابق المكون");
        }
        if (sn.warehouseId !== r.warehouseId || sn.state !== "in_stock") {
          throw new HttpError(409, "الرقم التسلسلي غير متاح في مستودع الحجز");
        }
        if (sliceQty !== 1) {
          throw new HttpError(400, "الانتقاء التسلسلي يجب أن يكون كمية = 1");
        }
      }
      const move = await recordStockMove(tx, {
        companyId,
        productId: r.componentId,
        fromWarehouseId: r.warehouseId,
        quantity: sliceQty,
        kind: "issue",
        sourceType: "work_order",
        sourceId: wo.id,
        sourceRef: wo.reference,
        lotId: slice.lotId ?? null,
        serialId: slice.serialId ?? null,
        createdBy: userId,
        skipJournal: true,
      });
      consumedValue += sliceQty * move.unitCost;
      totalQtyForRes += sliceQty;
      await tx.insert(workOrderConsumptionsTable).values({
        workOrderId: wo.id,
        componentId: r.componentId,
        quantity: String(sliceQty),
        unitCost: String(move.unitCost),
        lotId: slice.lotId ?? null,
        serialId: slice.serialId ?? null,
        stockMoveId: move.moveId,
      });
    }
    if (totalQtyForRes > 0) {
      await tx
        .update(workOrderReservationsTable)
        .set({ consumedQty: String(Number(r.consumedQty) + totalQtyForRes) })
        .where(eq(workOrderReservationsTable.id, r.id));
    }
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
        companyId,
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
// `finished` carries the operator's lot/serial selection for traceable
// finished products (required when the WO product is lot/serial-tracked).
type FinishedSelection = {
  lotNumber?: string | null;
  expiryDate?: string | null;
  serialNumbers?: string[] | null;
};
async function produceWork(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  woId: number,
  qty: number,
  userId: number | null,
  companyId: number,
  finished?: FinishedSelection,
): Promise<number> {
  const [wo] = await tx.select().from(workOrdersTable).where(and(eq(workOrdersTable.id, woId), supplyScope("workOrder", workOrdersTable.id, companyId))).limit(1);
  if (!wo) throw new HttpError(404, "أمر الإنتاج غير موجود");
  const remaining = Number(wo.quantity) - Number(wo.quantityProduced);
  if (qty > remaining + 0.0001) {
    throw new HttpError(409, `الكمية تتجاوز المتبقي (${remaining.toFixed(2)})`);
  }
  const finishedUnitCost = Number(wo.standardCost);
  const finishedValue = finishedUnitCost * qty;
  // Resolve the finished-good tracking strategy and emit the matching set
  // of receipt moves (1 per serial unit, or 1 lot-bearing receipt).
  const [prod] = await tx
    .select({ tracking: productsTable.trackingMode })
    .from(productsTable)
    .where(eq(productsTable.id, wo.productId))
    .limit(1);
  const tracking = prod?.tracking ?? "none";
  const insertProduction = async (
    sliceQty: number,
    lotId: number | null,
    serialId: number | null,
  ) => {
    const move = await recordStockMove(tx, {
      companyId,
      productId: wo.productId,
      toWarehouseId: wo.warehouseId,
      quantity: sliceQty,
      unitCost: finishedUnitCost,
      kind: "receipt",
      sourceType: "work_order",
      sourceId: wo.id,
      sourceRef: wo.reference,
      lotId,
      serialId,
      createdBy: userId,
      skipJournal: true,
    });
    await tx.insert(workOrderProductionsTable).values({
      workOrderId: wo.id,
      quantity: String(sliceQty),
      unitCost: String(finishedUnitCost),
      lotId,
      serialId,
      stockMoveId: move.moveId,
    });
  };
  if (tracking === "lot") {
    if (!finished?.lotNumber) {
      throw new HttpError(400, "يجب إدخال رقم تشغيلة للمنتج التام");
    }
    const lotId = await getOrCreateLot(
      tx,
      wo.productId,
      finished.lotNumber,
      finished.expiryDate ?? null,
      wo.reference,
    );
    await insertProduction(qty, lotId, null);
  } else if (tracking === "serial") {
    const serials = finished?.serialNumbers ?? [];
    const expected = Math.round(qty);
    if (Math.abs(qty - expected) > 0.0001) {
      throw new HttpError(400, "كمية المنتج التسلسلي يجب أن تكون عدداً صحيحاً");
    }
    if (serials.length !== expected) {
      throw new HttpError(400, `يجب إدخال ${expected} رقم تسلسلي للمنتج التام`);
    }
    if (new Set(serials).size !== serials.length) {
      throw new HttpError(400, "الأرقام التسلسلية مكررة");
    }
    for (const sn of serials) {
      const cleaned = sn.trim();
      if (!cleaned) throw new HttpError(400, "رقم تسلسلي فارغ");
      // Reject collisions with existing serials for this product.
      const [existing] = await tx
        .select({ id: stockSerialsTable.id })
        .from(stockSerialsTable)
        .where(
          and(
            eq(stockSerialsTable.productId, wo.productId),
            eq(stockSerialsTable.serialNumber, cleaned),
          ),
        )
        .limit(1);
      if (existing) {
        throw new HttpError(409, `الرقم التسلسلي "${cleaned}" مستخدم مسبقاً`);
      }
      const [created] = await tx
        .insert(stockSerialsTable)
        .values({
          productId: wo.productId,
          serialNumber: cleaned,
          currentWarehouseId: wo.warehouseId,
          state: "in_stock",
        })
        .returning({ id: stockSerialsTable.id });
      await insertProduction(1, null, created.id);
    }
  } else {
    await insertProduction(qty, null, null);
  }
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
        companyId,
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

// Operator-supplied per-reservation lot/serial slices.
const PicksSchema = z
  .array(
    z.object({
      reservationId: z.coerce.number().int(),
      slices: z
        .array(
          z.object({
            lotId: z.coerce.number().int().optional().nullable(),
            serialId: z.coerce.number().int().optional().nullable(),
            quantity: z.coerce.number().positive(),
          }),
        )
        .min(1),
    }),
  )
  .optional();

// Explicit consume endpoint: move some/all reserved components into WIP
// without producing finished goods yet. Body: { fraction?: 0..1, picks? }
// (defaults to 1 = consume everything still reserved). `picks` overrides
// the FEFO/auto behavior with explicit lot/serial selections per reservation.
router.post("/manufacturing/work-orders/:id/consume", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = z.object({
      fraction: z.coerce.number().min(0).max(1).optional(),
      picks: PicksSchema,
    });
    const body = Body.parse(req.body ?? {});
    const consumed = await db.transaction(async (tx) => {
      const [wo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).limit(1);
      if (!wo) throw new HttpError(404, "أمر الإنتاج غير موجود");
      if (wo.state !== "in_progress") {
        throw new HttpError(409, "ابدأ أمر الإنتاج أولاً");
      }
      return await consumeWork(
        tx,
        id,
        body.fraction ?? 1,
        req.session?.userId ?? null,
        getCompanyId(req),
        body.picks,
      );
    });
    res.json({ ok: true, consumedValue: consumed });
  } catch (err) {
    req.log.error({ err }, "consume failed");
    respondError(res, err);
  }
});

const FinishedSchema = z
  .object({
    lotNumber: z.string().min(1).optional().nullable(),
    expiryDate: z.string().optional().nullable(),
    serialNumbers: z.array(z.string().min(1)).optional().nullable(),
  })
  .optional();

// Explicit produce endpoint: clear `quantity` finished units from WIP
// into Finished Goods at standard cost. Blocks on any failed mandatory QC.
router.post("/manufacturing/work-orders/:id/produce", productionGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = z.object({
      quantity: z.coerce.number().positive(),
      finished: FinishedSchema,
    });
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
      return await produceWork(
        tx,
        id,
        body.quantity,
        req.session?.userId ?? null,
        getCompanyId(req),
        body.finished,
      );
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
    const Body = z.object({
      picks: PicksSchema,
      finished: FinishedSchema,
    });
    const body = Body.parse(req.body ?? {});
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
      const consumedValue = await consumeWork(
        tx,
        id,
        1,
        req.session?.userId ?? null,
        getCompanyId(req),
        body.picks,
      );
      // Produce the full remaining planned quantity — no partial completion.
      const remaining = Number(wo.quantity) - Number(wo.quantityProduced);
      let finishedValue = 0;
      if (remaining > 0.0001) {
        finishedValue = await produceWork(
          tx,
          id,
          remaining,
          req.session?.userId ?? null,
          getCompanyId(req),
          body.finished,
        );
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
            companyId: getCompanyId(req),
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
      .where(supplyScope("scrap", scrapRecordsTable.id, getCompanyId(req)))
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
    WITH src AS (SELECT branch_id, company_id FROM warehouses WHERE id = ${fromWarehouseId})
    SELECT id FROM warehouses
     WHERE name = 'Scrap'
       AND branch_id = (SELECT branch_id FROM src)
       AND company_id = (SELECT company_id FROM src)
     LIMIT 1
  `)) as unknown as { rows: Array<{ id: number }> };
  if (r.rows[0]) return r.rows[0].id;
  const r2 = (await tx.execute(sql`SELECT id FROM warehouses WHERE name = 'Scrap' AND company_id = (SELECT company_id FROM warehouses WHERE id = ${fromWarehouseId}) LIMIT 1`)) as unknown as { rows: Array<{ id: number }> };
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
        companyId: getCompanyId(req),
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
        companyId: getCompanyId(req),
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
            companyId: getCompanyId(req),
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
        companyId: getCompanyId(req),
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
        companyId: getCompanyId(req),
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
            companyId: getCompanyId(req),
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
              companyId: getCompanyId(req),
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
      .where(and(supplyScope("workOrder", workOrdersTable.id, getCompanyId(req)), sql`${workOrdersTable.state} IN ('confirmed','in_progress','draft')`));
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

// Manufacturing variance report: per work order and per period.
// Variance = Σ(consumed value) − Σ(produced value) for each WO. A positive
// value means the WO consumed more than the standard cost produced
// (unfavorable, cleared as COGS Dr / WIP Cr at completion); a negative
// value means it consumed less (favorable, cleared as WIP Dr / COGS Cr).
// `posted` is true if a variance journal was actually posted (i.e. the
// WO was completed and the residual exceeded the rounding epsilon).
router.get("/manufacturing/reports/variance", inventoryReadGuard, async (req, res) => {
  try {
    const rows = (await db.execute(sql`
      WITH cons AS (
        SELECT work_order_id, COALESCE(SUM(quantity * unit_cost)::float8, 0) AS v
          FROM work_order_consumptions GROUP BY work_order_id
      ), prod AS (
        SELECT work_order_id, COALESCE(SUM(quantity * unit_cost)::float8, 0) AS v
          FROM work_order_productions GROUP BY work_order_id
      ), jrn AS (
        SELECT source_ref, id AS entry_id, entry_number
          FROM journal_entries
         WHERE source_ref LIKE 'WO-VAR-%' AND company_id = ${getCompanyId(req)}
      )
      SELECT wo.id, wo.reference, wo.state,
             wo.completed_at, wo.quantity::float8 AS quantity,
             wo.quantity_produced::float8 AS quantity_produced,
             p.name_ar AS product_name, p.sku AS sku,
             COALESCE(cons.v, 0)::float8 AS consumed_value,
             COALESCE(prod.v, 0)::float8 AS produced_value,
             (COALESCE(cons.v, 0) - COALESCE(prod.v, 0))::float8 AS variance,
             jrn.entry_id AS journal_entry_id,
             jrn.entry_number AS journal_entry_number
        FROM work_orders wo
        LEFT JOIN products p ON p.id = wo.product_id
        LEFT JOIN cons ON cons.work_order_id = wo.id
        LEFT JOIN prod ON prod.work_order_id = wo.id
        LEFT JOIN jrn  ON jrn.source_ref = 'WO-VAR-' || wo.id
       WHERE wo.state IN ('in_progress','done') AND ${supplyScope("workOrder", sql`wo.id`, getCompanyId(req))}
       ORDER BY wo.completed_at DESC NULLS LAST, wo.id DESC
       LIMIT 500
    `) as unknown as { rows: any[] }).rows;

    const periods = (await db.execute(sql`
      WITH cons AS (
        SELECT work_order_id, COALESCE(SUM(quantity * unit_cost)::float8, 0) AS v
          FROM work_order_consumptions GROUP BY work_order_id
      ), prod AS (
        SELECT work_order_id, COALESCE(SUM(quantity * unit_cost)::float8, 0) AS v
          FROM work_order_productions GROUP BY work_order_id
      )
      SELECT to_char(date_trunc('month', wo.completed_at), 'YYYY-MM') AS period,
             COUNT(*)::int AS work_orders,
             COALESCE(SUM(GREATEST(COALESCE(cons.v,0) - COALESCE(prod.v,0), 0))::float8, 0) AS unfavorable,
             COALESCE(SUM(LEAST(COALESCE(cons.v,0) - COALESCE(prod.v,0), 0))::float8, 0) AS favorable,
             COALESCE(SUM(COALESCE(cons.v,0) - COALESCE(prod.v,0))::float8, 0) AS net_variance
        FROM work_orders wo
        LEFT JOIN cons ON cons.work_order_id = wo.id
        LEFT JOIN prod ON prod.work_order_id = wo.id
       WHERE wo.state = 'done' AND wo.completed_at IS NOT NULL AND ${supplyScope("workOrder", sql`wo.id`, getCompanyId(req))}
       GROUP BY 1 ORDER BY 1 DESC
       LIMIT 24
    `) as unknown as { rows: any[] }).rows;

    res.json({
      workOrders: rows.map((r) => ({
        id: Number(r.id),
        reference: r.reference,
        state: r.state,
        completedAt: r.completed_at,
        quantity: Number(r.quantity),
        quantityProduced: Number(r.quantity_produced),
        productName: r.product_name,
        sku: r.sku,
        consumedValue: Number(r.consumed_value),
        producedValue: Number(r.produced_value),
        variance: Number(r.variance),
        posted: r.journal_entry_id != null,
        journalEntryId: r.journal_entry_id != null ? Number(r.journal_entry_id) : null,
        journalEntryNumber: r.journal_entry_number ?? null,
      })),
      periods: periods.map((p) => ({
        period: p.period,
        workOrders: Number(p.work_orders),
        unfavorable: Number(p.unfavorable),
        favorable: Number(p.favorable),
        netVariance: Number(p.net_variance),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "variance report failed");
    respondError(res, err);
  }
});

router.get("/manufacturing/reports/summary", inventoryReadGuard, async (req, res) => {
  try {
    const [done] = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_done,
        COALESCE(SUM(quantity_produced)::float8, 0) AS total_produced,
        COALESCE(SUM(CASE WHEN planned_end IS NOT NULL
                          AND completed_at::date <= planned_end
                          THEN 1 ELSE 0 END)::float8, 0) AS on_time
        FROM work_orders WHERE state = 'done' AND ${supplyScope("workOrder", sql`id`, getCompanyId(req))}
    `).then((r) => (r as unknown as { rows: any[] }).rows);

    const [scrap] = await db.execute(sql`
      SELECT
        COALESCE(SUM(quantity)::float8, 0) AS scrap_qty,
        COUNT(*)::int AS scrap_events
        FROM scrap_records WHERE ${supplyScope("scrap", sql`scrap_records.id`, getCompanyId(req))}
    `).then((r) => (r as unknown as { rows: any[] }).rows);

    const [util] = await db.execute(sql`
      SELECT COUNT(*)::int AS active_centers FROM work_centers WHERE is_active = true AND company_id = ${getCompanyId(req)}
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
           AND ${supplyScope("workOrder", sql`wo.id`, getCompanyId(req))}
           AND wo.created_at >= now() - interval '30 days'
         GROUP BY ro.work_center_id
      )
      SELECT wc.id, wc.code, wc.name_ar AS name_ar,
             wc.capacity_per_day::float8 AS capacity_per_day,
             COALESCE(b.minutes, 0)::float8 AS booked_minutes,
             (wc.capacity_per_day::float8 * 60.0 * 30.0) AS capacity_minutes
        FROM work_centers wc
        LEFT JOIN booked b ON b.work_center_id = wc.id
       WHERE wc.is_active = true AND wc.company_id = ${getCompanyId(req)}
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
