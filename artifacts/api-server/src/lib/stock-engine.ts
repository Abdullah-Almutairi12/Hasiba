import {
  productsTable,
  stockMovesTable,
  stockLotsTable,
  stockSerialsTable,
  warehousesTable,
  productVariantsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { postJournalEntry, type DbOrTx } from "./journal-posting";
import { db, alertsTable, usersTable, userCompaniesTable } from "@workspace/db";
import {
  sendByTemplate,
  hasRecentLowStockAlert,
} from "./integrations/messaging-templates";
import { logger } from "./logger";
import { supplyScope } from "./supply-chain-scope";

/**
 * If the freshly-recomputed cached stock for `productId` has fallen
 * at or below the product's min_stock threshold, push a debounced
 * alert (in-app row in `alerts` + WhatsApp message to managers).
 *
 * Debouncing: we look for any matching `low_stock` alert in the last
 * 24h to avoid spamming managers as more units of the same product
 * are sold. The product id is embedded in the message text so we can
 * key off it without a schema change to the (intentionally minimal)
 * alerts table.
 */
async function scheduleLowStockNotification(productId: number): Promise<void> {
  try {
    const [p] = await db
      .select({
        id: productsTable.id,
        nameAr: productsTable.nameAr,
        sku: productsTable.sku,
        stock: productsTable.stock,
        minStock: productsTable.minStock,
        isActive: productsTable.isActive,
        companyId: productsTable.companyId,
      })
      .from(productsTable)
      .where(eq(productsTable.id, productId));
    if (!p || !p.isActive) return;
    const stock = Number(p.stock);
    const minStock = Number(p.minStock);
    if (!(stock <= minStock)) return;
    if (await hasRecentLowStockAlert(productId, 24)) return;

    await db.insert(alertsTable).values({
      type: "low_stock",
      title: `مخزون منخفض: ${p.nameAr}`,
      message: `المنتج #${productId} (${p.sku}) وصلت كميته إلى ${stock} وحدة (الحد الأدنى ${minStock}).`,
      // Inherit tenant scope from the product so this alert only surfaces
      // in the owning company's notification list.
      companyId: p.companyId ?? null,
    });

    const managers = await db
      .select({ phone: usersTable.phone, name: usersTable.name })
      .from(usersTable)
      .innerJoin(userCompaniesTable, and(eq(userCompaniesTable.userId, usersTable.id), eq(userCompaniesTable.companyId, p.companyId!)))
      .where(
        and(
          eq(usersTable.isActive, true),
          eq(userCompaniesTable.role, "manager"),
        ),
      );
    for (const m of managers) {
      const phone = m.phone?.trim();
      if (!phone) continue;
      await sendByTemplate({
        templateName: "low_stock_alert",
        to: phone,
        variables: {
          product_name: p.nameAr,
          sku: p.sku,
          stock: String(stock),
          min_stock: String(minStock),
        },
      });
    }
  } catch (err) {
    logger.warn({ err, productId }, "low-stock notify failed");
  }
}

export type StockMoveKind =
  | "receipt"
  | "issue"
  | "transfer"
  | "adjustment"
  | "return_in"
  | "return_out";

export interface RecordMoveInput {
  companyId?: number;
  productId: number;
  variantId?: number | null;
  fromWarehouseId?: number | null;
  toWarehouseId?: number | null;
  quantity: number;
  unitCost?: number;
  kind: StockMoveKind;
  state?: "draft" | "in_transit" | "done";
  lotId?: number | null;
  serialId?: number | null;
  sourceType?: string | null;
  sourceId?: number | null;
  sourceRef?: string | null;
  invoiceLineId?: number | null;
  originalMoveId?: number | null;
  occurredAt?: Date;
  createdBy?: number | null;
  notes?: string | null;
  /** Skip GL posting (caller already posts a balanced entry covering the move). */
  skipJournal?: boolean;
}

const EPSILON = 0.0001;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] } | undefined;
  return r?.rows ?? [];
}

async function getDefaultWarehouseId(tx: DbOrTx, companyId?: number): Promise<number> {
  const [w] = await tx
    .select({ id: warehousesTable.id })
    .from(warehousesTable)
    .where(and(eq(warehousesTable.isDefault, true), companyId == null ? undefined : eq(warehousesTable.companyId, companyId)))
    .limit(1);
  if (w) return w.id;
  const [any] = await tx.select({ id: warehousesTable.id }).from(warehousesTable).where(companyId == null ? undefined : eq(warehousesTable.companyId, companyId)).limit(1);
  if (!any) throw new Error("لا يوجد مستودع مُعرَّف في النظام");
  return any.id;
}

export async function getOrCreateLot(
  tx: DbOrTx,
  productId: number,
  lotNumber: string,
  expiryDate?: string | null,
  supplierRef?: string | null,
): Promise<number> {
  const [existing] = await tx
    .select()
    .from(stockLotsTable)
    .where(and(eq(stockLotsTable.productId, productId), eq(stockLotsTable.lotNumber, lotNumber)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(stockLotsTable)
    .values({
      productId,
      lotNumber,
      expiryDate: expiryDate ?? null,
      supplierRef: supplierRef ?? null,
    })
    .returning();
  return created.id;
}

async function applyQuantDelta(
  tx: DbOrTx,
  productId: number,
  warehouseId: number,
  variantId: number | null,
  lotId: number | null,
  qtyDelta: number,
  unitCost: number,
): Promise<void> {
  // Serialize concurrent read-modify-write on the same quant key for the
  // duration of this transaction. Two POS sales / transfers targeting the
  // same (product,warehouse,variant,lot) can no longer race — the second
  // caller blocks here until the first commits, then sees the updated row.
  const key = `${productId}-${warehouseId}-${variantId ?? 0}-${lotId ?? 0}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);

  const cur = await tx.execute(sql`
    SELECT id, quantity::float8 AS quantity, avg_cost::float8 AS avg_cost
      FROM stock_quants
     WHERE product_id = ${productId}
       AND warehouse_id = ${warehouseId}
       AND COALESCE(variant_id,0) = ${variantId ?? 0}
       AND COALESCE(lot_id,0) = ${lotId ?? 0}
     FOR UPDATE
  `);
  const existing = rowsOf<{ id: number; quantity: number; avg_cost: number }>(cur)[0];

  if (existing) {
    const newQty = existing.quantity + qtyDelta;
    if (newQty < -EPSILON) {
      throw new Error(`رصيد المخزون غير كافٍ (متاح ${existing.quantity}، مطلوب ${-qtyDelta})`);
    }
    // avg_cost is the carrying value per remaining unit, including FIFO.
    // Removing units at FIFO cost must remove that value, not the old average.
    const totalValue = existing.quantity * existing.avg_cost + qtyDelta * unitCost;
    const newAvg = newQty > EPSILON ? totalValue / newQty : 0;
    await tx.execute(sql`
      UPDATE stock_quants
         SET quantity = ${newQty}, avg_cost = ${newAvg}, updated_at = now()
       WHERE id = ${existing.id}
    `);
  } else {
    if (qtyDelta < -EPSILON) {
      throw new Error("لا يمكن إصدار مخزون من موقع لا يحتوي على رصيد");
    }
    // Advisory lock above already guarantees no concurrent insert for the
    // same key, but ON CONFLICT keeps us safe even if a future caller
    // bypasses it (e.g. raw SQL migrations).
    await tx.execute(sql`
      INSERT INTO stock_quants (product_id, warehouse_id, variant_id, lot_id, quantity, avg_cost)
      VALUES (${productId}, ${warehouseId}, ${variantId}, ${lotId}, ${qtyDelta}, ${unitCost})
      ON CONFLICT (product_id, warehouse_id, COALESCE(variant_id, 0), COALESCE(lot_id, 0))
      DO UPDATE SET quantity = stock_quants.quantity + EXCLUDED.quantity,
                    avg_cost = CASE
                      WHEN EXCLUDED.quantity > 0 AND EXCLUDED.avg_cost > 0
                        AND (stock_quants.quantity + EXCLUDED.quantity) > 0
                      THEN (stock_quants.quantity * stock_quants.avg_cost
                            + EXCLUDED.quantity * EXCLUDED.avg_cost)
                           / (stock_quants.quantity + EXCLUDED.quantity)
                      ELSE stock_quants.avg_cost
                    END,
                    updated_at = now()
    `);
  }
}

interface ProductInfo {
  tracking: string;
  costingMethod: string;
  costPrice: number;
}

async function getProductInfo(tx: DbOrTx, productId: number): Promise<ProductInfo & { companyId: number | null }> {
  const [p] = await tx
    .select({
      tracking: productsTable.trackingMode,
      costingMethod: productsTable.costingMethod,
      costPrice: productsTable.costPrice,
      companyId: productsTable.companyId,
    })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!p) throw new Error("المنتج غير موجود");
  return {
    tracking: p.tracking,
    costingMethod: p.costingMethod,
    costPrice: Number(p.costPrice ?? 0),
    companyId: p.companyId ?? null,
  };
}

/**
 * Consume FIFO layers for an issue. Walks layers oldest-first, reducing
 * remaining_qty and computing the weighted unit cost for the consumed slice.
 * Returns null when the product has no layers (caller should fall back).
 */
async function consumeFifoLayers(
  tx: DbOrTx,
  productId: number,
  warehouseId: number,
  qty: number,
  lotId: number | null,
  companyId: number,
): Promise<number | null> {
  const lotFilter = lotId == null ? sql`AND lot_id IS NULL` : sql`AND lot_id = ${lotId}`;
  const layers = rowsOf<{ id: number; remaining: number; unit_cost: number }>(
    await tx.execute(sql`
      SELECT id, remaining_qty::float8 AS remaining, unit_cost::float8 AS unit_cost
        FROM stock_layers
       WHERE product_id = ${productId}
         AND warehouse_id = ${warehouseId}
         AND remaining_qty > 0
         AND ${supplyScope("move", sql`receipt_move_id`, companyId)}
         ${lotFilter}
       ORDER BY created_at ASC, id ASC
       FOR UPDATE
    `),
  );
  if (layers.length === 0) return null;
  let remaining = qty;
  let totalCost = 0;
  for (const layer of layers) {
    if (remaining <= EPSILON) break;
    const take = Math.min(remaining, layer.remaining);
    totalCost += take * layer.unit_cost;
    remaining -= take;
    const newRem = layer.remaining - take;
    await tx.execute(sql`UPDATE stock_layers SET remaining_qty = ${newRem} WHERE id = ${layer.id}`);
  }
  if (remaining > EPSILON) {
    throw new Error(`المخزون غير كافٍ في الطبقات (FIFO)، مطلوب إضافي ${remaining}`);
  }
  return totalCost / qty;
}

/**
 * FEFO lot allocation. Returns slices [{lotId, qty}] picked from non-expired
 * lots first by earliest expiry, then by lot id.
 */
export async function allocateLotsFEFO(
  tx: DbOrTx,
  productId: number,
  warehouseId: number,
  qtyNeeded: number,
): Promise<Array<{ lotId: number; qty: number }>> {
  const product = await getProductInfo(tx, productId);
  if (product.companyId == null) throw new Error("Stock resource not found");
  const today = new Date().toISOString().slice(0, 10);
  const rows = rowsOf<{ lot_id: number; quantity: number }>(
    await tx.execute(sql`
      SELECT q.lot_id, q.quantity::float8 AS quantity
        FROM stock_quants q
        LEFT JOIN stock_lots l ON l.id = q.lot_id
       WHERE q.product_id = ${productId}
         AND q.warehouse_id = ${warehouseId}
         AND ${supplyScope("quant", sql`q.id`, product.companyId)}
         AND q.quantity > 0
         AND q.lot_id IS NOT NULL
         AND (l.expiry_date IS NULL OR l.expiry_date >= ${today})
       ORDER BY l.expiry_date NULLS LAST, q.lot_id ASC
    `),
  );
  const out: Array<{ lotId: number; qty: number }> = [];
  let remaining = qtyNeeded;
  for (const r of rows) {
    if (remaining <= EPSILON) break;
    const take = Math.min(remaining, r.quantity);
    out.push({ lotId: r.lot_id, qty: take });
    remaining -= take;
  }
  if (remaining > EPSILON) {
    throw new Error(`المخزون اللوتي غير كافٍ (نقص ${remaining})`);
  }
  return out;
}

/** Single source-of-truth API to mutate stock; see module README for semantics. */
export async function recordStockMove(
  tx: DbOrTx,
  input: RecordMoveInput,
): Promise<{ moveId: number; moveIds: number[]; unitCost: number }> {
  const qty = Number(input.quantity);
  if (!(qty > 0)) throw new Error("الكمية يجب أن تكون أكبر من صفر");

  const product = await getProductInfo(tx, input.productId);
  // Enforce consistency even for background/internal callers. A product and
  // both ends of a move must have the same proven owner, before any write.
  if (product.companyId == null || (input.companyId != null && product.companyId !== input.companyId)) {
    throw new Error("Stock resource not found");
  }
  for (const warehouseId of [input.fromWarehouseId, input.toWarehouseId]) {
    if (warehouseId == null) continue;
    const [warehouse] = await tx.select({ id: warehousesTable.id }).from(warehousesTable)
      .where(and(eq(warehousesTable.id, warehouseId), eq(warehousesTable.companyId, product.companyId))).limit(1);
    if (!warehouse) throw new Error("Stock resource not found");
  }
  for (const [table, id] of [
    [stockLotsTable, input.lotId], [stockSerialsTable, input.serialId], [productVariantsTable, input.variantId],
  ] as const) {
    if (id == null) continue;
    const [owned] = await tx.select({ id: table.id }).from(table)
      .where(and(eq(table.id, id), eq(table.productId, input.productId))).limit(1);
    if (!owned) throw new Error("Stock tracking reference does not match product");
  }

  // Serial enforcement.
  if (product.tracking === "serial") {
    if (!input.serialId) throw new Error("هذا المنتج يتطلب رقم تسلسلي (Serial)");
    if (qty !== 1) throw new Error("المنتجات التسلسلية لا تسمح بكمية غير 1");
  }

  // Lot enforcement on receipts.
  const isInbound = input.kind === "receipt" || input.kind === "return_in";
  const isOutbound =
    input.kind === "issue" || input.kind === "return_out" || input.kind === "transfer";
  if (product.tracking === "lot" && isInbound && !input.lotId) {
    throw new Error("هذا المنتج يتطلب رقم تشغيلة (Lot) عند الاستلام");
  }

  // Auto-FEFO for outbound lot-tracked products without an explicit lot.
  if (
    product.tracking === "lot" &&
    isOutbound &&
    !input.lotId &&
    input.fromWarehouseId != null &&
    (input.state ?? "done") === "done"
  ) {
    const slices = await allocateLotsFEFO(tx, input.productId, input.fromWarehouseId, qty);
    let firstMoveId = 0;
    const moveIds: number[] = [];
    let weightedCost = 0;
    for (const slice of slices) {
      const r = await recordStockMove(tx, { ...input, quantity: slice.qty, lotId: slice.lotId });
      if (!firstMoveId) firstMoveId = r.moveId;
      moveIds.push(...r.moveIds);
      weightedCost += r.unitCost * slice.qty;
    }
    return { moveId: firstMoveId, moveIds, unitCost: weightedCost / qty };
  }

  // Block expired lots from being issued.
  if (input.lotId && isOutbound) {
    const [lot] = await tx
      .select({ expiryDate: stockLotsTable.expiryDate })
      .from(stockLotsTable)
      .where(eq(stockLotsTable.id, input.lotId))
      .limit(1);
    if (lot?.expiryDate && lot.expiryDate < new Date().toISOString().slice(0, 10)) {
      throw new Error("لا يمكن إصدار تشغيلة منتهية الصلاحية");
    }
  }

  // ---- Resolve unit cost ----
  let unitCost = input.unitCost ?? 0;
  const state = input.state ?? "done";
  // For FIFO products, layers MUST be decremented on every outbound leg
  // regardless of whether the caller supplied unitCost — otherwise stocktake
  // adjustments and manual issues would leave layers and on-hand out of sync.
  // The FIFO-derived cost is used when the caller did not provide one.
  if (isOutbound && (state === "done" || state === "in_transit")) {
    if (input.fromWarehouseId == null) throw new Error("issue/transfer/return_out يتطلب fromWarehouseId");
    if (product.costingMethod === "fifo") {
      const fifoCost = await consumeFifoLayers(
        tx,
        input.productId,
        input.fromWarehouseId,
        qty,
        input.lotId ?? null,
        product.companyId,
      );
      if (input.unitCost == null) unitCost = fifoCost ?? product.costPrice;
    } else if (input.unitCost == null) {
      if (product.costingMethod === "standard") {
        unitCost = product.costPrice;
      } else {
        // Average: read avg_cost from the quant.
        const cur = rowsOf<{ avg_cost: number }>(
          await tx.execute(sql`
            SELECT avg_cost::float8 AS avg_cost FROM stock_quants
             WHERE product_id = ${input.productId}
               AND warehouse_id = ${input.fromWarehouseId}
               AND COALESCE(variant_id,0) = ${input.variantId ?? 0}
               AND COALESCE(lot_id,0) = ${input.lotId ?? 0}
             LIMIT 1
          `),
        );
        unitCost = cur[0]?.avg_cost ?? product.costPrice;
      }
    }
  }
  if (isInbound && input.unitCost == null) {
    unitCost = product.costPrice;
  }

  // ---- Insert move row ----
  const [move] = await tx
    .insert(stockMovesTable)
    .values({
      productId: input.productId,
      variantId: input.variantId ?? null,
      fromWarehouseId: input.fromWarehouseId ?? null,
      toWarehouseId: input.toWarehouseId ?? null,
      quantity: String(qty),
      unitCost: String(unitCost),
      lotId: input.lotId ?? null,
      serialId: input.serialId ?? null,
      kind: input.kind,
      state,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      sourceRef: input.sourceRef ?? null,
      invoiceLineId: input.invoiceLineId ?? null,
      originalMoveId: input.originalMoveId ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      createdBy: input.createdBy ?? null,
      notes: input.notes ?? null,
    })
    .returning();

  // ---- Apply quant deltas ----
  if (state === "done") {
    if (input.fromWarehouseId != null) {
      await applyQuantDelta(
        tx,
        input.productId,
        input.fromWarehouseId,
        input.variantId ?? null,
        input.lotId ?? null,
        -qty,
        unitCost,
      );
    }
    if (input.toWarehouseId != null) {
      await applyQuantDelta(
        tx,
        input.productId,
        input.toWarehouseId,
        input.variantId ?? null,
        input.lotId ?? null,
        qty,
        unitCost,
      );
      // Open a FIFO layer for inbound moves on FIFO-costed products.
      if (
        product.costingMethod === "fifo" &&
        (input.kind === "receipt" || input.kind === "return_in" || input.kind === "adjustment")
      ) {
        await tx.execute(sql`
          INSERT INTO stock_layers
            (receipt_move_id, product_id, warehouse_id, variant_id, lot_id, unit_cost, remaining_qty)
          VALUES (${move.id}, ${input.productId}, ${input.toWarehouseId},
                  ${input.variantId ?? null}, ${input.lotId ?? null}, ${unitCost}, ${qty})
        `);
      }
    }
    if (input.serialId) {
      await tx
        .update(stockSerialsTable)
        .set({
          currentWarehouseId: input.toWarehouseId ?? null,
          state: input.kind === "issue" ? "sold" : input.toWarehouseId ? "in_stock" : "scrapped",
        })
        .where(eq(stockSerialsTable.id, input.serialId));
    }
  } else if (state === "in_transit" && input.fromWarehouseId != null) {
    // Outbound leg only — destination is credited when the transfer completes.
    // FIFO layers were already consumed during cost resolution above.
    await applyQuantDelta(
      tx,
      input.productId,
      input.fromWarehouseId,
      input.variantId ?? null,
      input.lotId ?? null,
      -qty,
      unitCost,
    );
  }

  // Refresh products.stock cache. Scrap warehouses (is_scrap=true) hold
  // physically-tracked but written-off goods — exclude them so the cached
  // stock matches the GL inventory balance.
  await tx.execute(sql`
    UPDATE products
       SET stock = COALESCE((
         SELECT SUM(q.quantity)::numeric
           FROM stock_quants q
           JOIN warehouses w ON w.id = q.warehouse_id
          WHERE q.product_id = ${input.productId}
            AND w.is_scrap = false
            AND ${supplyScope("quant", sql`q.id`, product.companyId)}
       ), 0)
     WHERE id = ${input.productId}
  `);

  // Marketplace inventory broadcast — every stock movement fans
  // out a debounced (1s) inventory push to every connector that has
  // this product mapped. The helper is a no-op when there are no
  // mappings, so the hot path is unaffected when marketplaces are
  // unused. Deferred until after the surrounding tx is likely to
  // have committed so the read sees committed quants.
  {
    const productIdForBroadcast = input.productId;
    setTimeout(() => {
      void import("./integrations/marketplaces")
        .then((m) => m.broadcastInventoryChange(productIdForBroadcast))
        .catch(() => {
          /* logged inside helper */
        });
    }, 250).unref();
  }

  // Low-stock notification hook — fires (debounced) the moment a
  // movement drops cached stock at-or-below the product's min_stock
  // threshold. Issued lazily so the hot path is unaffected by a
  // missing WhatsApp credential.
  if (input.kind === "issue" || input.kind === "adjustment") {
    // `recordStockMove` is almost always called inside a
    // `db.transaction((tx) => ...)` block. The cached `products.stock`
    // we just wrote with `tx.execute(...)` is invisible to other
    // connections until the surrounding transaction commits, so we
    // can't dispatch the notification synchronously — the helper would
    // read a stale row through the global `db` pool. Defer briefly so
    // the caller's transaction has a chance to commit first; the
    // helper itself is debounced via `hasRecentLowStockAlert` so the
    // small race against extremely-long transactions is harmless.
    const productId = input.productId;
    setTimeout(() => {
      void scheduleLowStockNotification(productId).catch(() => {
        /* logged inside helper */
      });
    }, 500).unref();
  }

  // ---- GL postings ----
  if (!input.skipJournal && unitCost > 0 && state === "done") {
    const value = qty * unitCost;
    const ref = input.sourceRef ?? `MOVE-${move.id}`;
    if (product.companyId == null) {
      throw new Error(
        `Cannot post stock-move journal: product ${input.productId} has no companyId`,
      );
    }
    const moveCompanyId = product.companyId;
    const postWith = async (
      lines: Array<{ systemKey: string; debit?: number; credit?: number; description?: string }>,
      desc: string,
    ) => {
      const { id: jid } = await postJournalEntry(
        tx,
        {
          entryDate: input.occurredAt ?? new Date(),
          description: desc,
          reference: ref,
          source: "system",
          sourceRef: `STOCK-MOVE-${move.id}`,
          createdBy: input.createdBy ?? null,
          status: "posted",
          companyId: moveCompanyId,
        },
        lines,
      );
      await tx.update(stockMovesTable).set({ journalEntryId: jid }).where(eq(stockMovesTable.id, move.id));
    };
    if (input.kind === "receipt") {
      const counter = input.sourceType === "supplier_invoice" ? "ap" : "retained_earnings";
      await postWith(
        [
          { systemKey: "inventory", debit: value, description: "استلام مخزون" },
          { systemKey: counter, credit: value },
        ],
        `استلام مخزون — ${ref}`,
      );
    } else if (input.kind === "issue") {
      await postWith(
        [
          { systemKey: "cogs", debit: value },
          { systemKey: "inventory", credit: value, description: "صرف مخزون" },
        ],
        `صرف مخزون — ${ref}`,
      );
    } else if (input.kind === "adjustment") {
      if (input.fromWarehouseId != null) {
        await postWith(
          [
            { systemKey: "other_expense", debit: value, description: "نقص جرد" },
            { systemKey: "inventory", credit: value },
          ],
          `تعديل جرد (نقص) — ${ref}`,
        );
      } else if (input.toWarehouseId != null) {
        await postWith(
          [
            { systemKey: "inventory", debit: value },
            { systemKey: "other_income", credit: value, description: "زيادة جرد" },
          ],
          `تعديل جرد (زيادة) — ${ref}`,
        );
      }
    }
    // transfer/return moves: no GL impact (transfer stays on inventory; returns
    // are reversed by the related sale/purchase journal).
  }

  return { moveId: move.id, moveIds: [move.id], unitCost };
}

/**
 * Complete a transfer that was previously dispatched as in_transit. Flips the
 * existing move row to 'done' and credits the destination warehouse. Does NOT
 * insert a second move row, so the ledger has exactly one row per transfer.
 */
export async function completeTransfer(
  tx: DbOrTx,
  moveId: number,
  completedBy: number | null,
  companyId: number,
): Promise<void> {
  // Atomic state transition: only the caller that succeeds in flipping
  // the move from in_transit -> done proceeds to credit the destination.
  // A second concurrent /transfers/:id/receive sees no row returned and
  // gets "already received", so the destination is never double-credited.
  const updated = rowsOf<{
    id: number;
    product_id: number;
    variant_id: number | null;
    to_warehouse_id: number | null;
    lot_id: number | null;
    quantity: string;
    unit_cost: string;
    notes: string | null;
  }>(
    await tx.execute(sql`
      UPDATE stock_moves
         SET state = 'done',
             notes = COALESCE(notes,'') ||
                     ${completedBy ? sql` ' — استلام بواسطة #' || ${completedBy}` : sql`''`}
       WHERE id = ${moveId}
         AND ${supplyScope("move", sql`stock_moves.id`, companyId)}
         AND kind = 'transfer'
         AND state = 'in_transit'
         AND to_warehouse_id IS NOT NULL
   RETURNING id, product_id, variant_id, to_warehouse_id, lot_id,
             quantity::text, unit_cost::text, notes
    `),
  );
  const m = updated[0];
  if (!m) throw new Error("التحويل غير موجود أو تم استلامه بالفعل");

  const qty = Number(m.quantity);
  const cost = Number(m.unit_cost);
  const toWarehouseId = m.to_warehouse_id as number;

  await applyQuantDelta(tx, m.product_id, toWarehouseId, m.variant_id, m.lot_id, qty, cost);

  // For FIFO-costed products, open a layer at the destination so subsequent
  // issues there can consume it. Cost is preserved from the source layer
  // already consumed on dispatch.
  const product = await getProductInfo(tx, m.product_id);
  if (product.costingMethod === "fifo") {
    await tx.execute(sql`
      INSERT INTO stock_layers
        (receipt_move_id, product_id, warehouse_id, variant_id, lot_id, unit_cost, remaining_qty)
      VALUES (${m.id}, ${m.product_id}, ${toWarehouseId},
              ${m.variant_id}, ${m.lot_id}, ${cost}, ${qty})
    `);
  }

  await tx.execute(sql`
    UPDATE products SET stock = COALESCE((
      SELECT SUM(q.quantity)::numeric
        FROM stock_quants q
        JOIN warehouses w ON w.id = q.warehouse_id
       WHERE q.product_id = ${m.product_id}
         AND w.is_scrap = false
    ), 0)
     WHERE id = ${m.product_id}
  `);
}

export { getDefaultWarehouseId };
