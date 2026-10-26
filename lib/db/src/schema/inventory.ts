import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  uniqueIndex,
  index,
  check,
  jsonb,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { productsTable } from "./products";
import { warehousesTable } from "./warehouses";
import { usersTable } from "./users";
import { customerInvoiceLinesTable } from "./sales";

// ===== Lots / Batches =====
export const stockLotsTable = pgTable(
  "stock_lots",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => productsTable.id),
    lotNumber: text("lot_number").notNull(),
    expiryDate: date("expiry_date"),
    supplierRef: text("supplier_ref"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("stock_lots_unique").on(t.productId, t.lotNumber),
    expIdx: index("stock_lots_expiry_idx").on(t.expiryDate),
  }),
);

// ===== Serials =====
export const stockSerialsTable = pgTable(
  "stock_serials",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => productsTable.id),
    serialNumber: text("serial_number").notNull(),
    currentWarehouseId: integer("current_warehouse_id").references(() => warehousesTable.id),
    state: text("state").notNull().default("in_stock"), // in_stock / sold / scrapped / in_transit
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("stock_serials_unique").on(t.productId, t.serialNumber),
  }),
);

// ===== Stock Moves (the ledger) =====
export const STOCK_MOVE_KINDS = [
  "receipt",      // supplier receipt: null -> warehouse
  "issue",        // sale / consumption: warehouse -> null
  "transfer",     // warehouse -> warehouse
  "adjustment",   // stocktake / manual adjustment (signed)
  "return_in",    // customer return
  "return_out",   // supplier return
] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];

export const STOCK_MOVE_STATES = ["draft", "in_transit", "done", "cancelled"] as const;
export type StockMoveState = (typeof STOCK_MOVE_STATES)[number];

export const stockMovesTable = pgTable(
  "stock_moves",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => productsTable.id),
    variantId: integer("variant_id"),
    fromWarehouseId: integer("from_warehouse_id").references(() => warehousesTable.id),
    toWarehouseId: integer("to_warehouse_id").references(() => warehousesTable.id),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 30, scale: 16 }).notNull().default("0"),
    lotId: integer("lot_id").references(() => stockLotsTable.id),
    serialId: integer("serial_id").references(() => stockSerialsTable.id),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("done"),
    sourceType: text("source_type"), // pos | invoice | transfer | stocktake | manual
    sourceId: integer("source_id"),
    sourceRef: text("source_ref"),
    invoiceLineId: integer("invoice_line_id").references(() => customerInvoiceLinesTable.id),
    originalMoveId: integer("original_move_id").references((): AnyPgColumn => stockMovesTable.id),
    journalEntryId: integer("journal_entry_id"),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => ({
    productIdx: index("stock_moves_product_idx").on(t.productId, t.occurredAt),
    fromIdx: index("stock_moves_from_idx").on(t.fromWarehouseId),
    toIdx: index("stock_moves_to_idx").on(t.toWarehouseId),
    kindIdx: index("stock_moves_kind_idx").on(t.kind, t.state),
    sourceIdx: index("stock_moves_source_idx").on(t.sourceType, t.sourceId),
    invoiceLineIdx: index("stock_moves_invoice_line_idx").on(t.invoiceLineId),
    originalMoveIdx: index("stock_moves_original_move_idx").on(t.originalMoveId),
  }),
);

// A delivery issue may be billed across several partial invoices. Preserve the
// exact quantity/cost slice owned by each invoice instead of looking up an SO
// line's oldest unreturned issue when the customer later returns goods.
export const salesIssueAllocationsTable = pgTable(
  "sales_issue_allocations",
  {
    id: serial("id").primaryKey(),
    invoiceLineId: integer("invoice_line_id").notNull().references(() => customerInvoiceLinesTable.id),
    issueMoveId: integer("issue_move_id").notNull().references(() => stockMovesTable.id),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 30, scale: 16 }).notNull(),
  },
  (t) => ({
    lineMoveUnique: uniqueIndex("sales_issue_allocations_line_move_unique").on(t.invoiceLineId, t.issueMoveId),
    moveIdx: index("sales_issue_allocations_move_idx").on(t.issueMoveId),
    positiveQuantity: check("sales_issue_allocations_quantity_check", sql`${t.quantity} > 0`),
    nonnegativeCost: check("sales_issue_allocations_unit_cost_check", sql`${t.unitCost} >= 0`),
  }),
);

// ===== Quants (cached on-hand by location) =====
export const stockQuantsTable = pgTable(
  "stock_quants",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => productsTable.id),
    variantId: integer("variant_id"),
    warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id),
    lotId: integer("lot_id").references(() => stockLotsTable.id),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("0"),
    avgCost: numeric("avg_cost", { precision: 30, scale: 16 }).notNull().default("0"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("stock_quants_unique").on(t.productId, t.warehouseId, sql`COALESCE(${t.variantId}, 0)`, sql`COALESCE(${t.lotId}, 0)`),
    whIdx: index("stock_quants_warehouse_idx").on(t.warehouseId),
  }),
);

// ===== Variants =====
export const productVariantsTable = pgTable(
  "product_variants",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    barcode: text("barcode"),
    attributes: jsonb("attributes").notNull().default({}), // { color: "أحمر", size: "L" }
    price: numeric("price", { precision: 10, scale: 2 }),
    costPrice: numeric("cost_price", { precision: 10, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    productIdx: index("product_variants_product_idx").on(t.productId),
    barcodeIdx: index("product_variants_barcode_idx").on(t.barcode),
  }),
);

export const productVariantAttributesTable = pgTable(
  "product_variant_attributes",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),       // color
    nameAr: text("name_ar").notNull(),  // اللون
    values: jsonb("values").notNull().default([]), // ["red","blue"]
  },
  (t) => ({
    productIdx: index("product_variant_attrs_product_idx").on(t.productId),
  }),
);

// ===== Reorder rules =====
export const reorderRulesTable = pgTable(
  "reorder_rules",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => productsTable.id),
    warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id),
    minQty: numeric("min_qty", { precision: 18, scale: 4 }).notNull().default("0"),
    maxQty: numeric("max_qty", { precision: 18, scale: 4 }).notNull().default("0"),
    eoq: numeric("eoq", { precision: 18, scale: 4 }).notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("reorder_rules_unique").on(t.productId, t.warehouseId),
  }),
);

// ===== Stock takes =====
export const STOCK_TAKE_STATES = ["draft", "in_progress", "done", "cancelled"] as const;
export const stockTakesTable = pgTable("stock_takes", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => usersTable.id),
  createdBy: integer("created_by").references(() => usersTable.id),
  closureResult: jsonb("closure_result"),
  countParticipationIncomplete: boolean("count_participation_incomplete").notNull().default(false),
});

export const stockTakeLinesTable = pgTable(
  "stock_take_lines",
  {
    id: serial("id").primaryKey(),
    stockTakeId: integer("stock_take_id").notNull().references(() => stockTakesTable.id, { onDelete: "cascade" }),
    productId: integer("product_id").notNull().references(() => productsTable.id),
    variantId: integer("variant_id"),
    lotId: integer("lot_id").references(() => stockLotsTable.id),
    expectedQty: numeric("expected_qty", { precision: 18, scale: 4 }).notNull().default("0"),
    countedQty: numeric("counted_qty", { precision: 18, scale: 4 }),
    countRevision: numeric("count_revision", { precision: 30, scale: 0 }).notNull().default("0"),
    countCheckpoint: jsonb("count_checkpoint"),
    unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull().default("0"),
  },
  (t) => ({
    takeIdx: index("stock_take_lines_take_idx").on(t.stockTakeId),
  }),
);

// ===== Zod & types =====
export const insertStockMoveSchema = createInsertSchema(stockMovesTable).omit({ id: true, createdAt: true });
export type StockMove = typeof stockMovesTable.$inferSelect;
export type InsertStockMove = z.infer<typeof insertStockMoveSchema>;

export const insertStockLotSchema = createInsertSchema(stockLotsTable).omit({ id: true, createdAt: true });
export type StockLot = typeof stockLotsTable.$inferSelect;

export const insertStockSerialSchema = createInsertSchema(stockSerialsTable).omit({ id: true, createdAt: true });
export type StockSerial = typeof stockSerialsTable.$inferSelect;

export type StockQuant = typeof stockQuantsTable.$inferSelect;

export const insertProductVariantSchema = createInsertSchema(productVariantsTable).omit({ id: true, createdAt: true });
export type ProductVariant = typeof productVariantsTable.$inferSelect;

export const insertReorderRuleSchema = createInsertSchema(reorderRulesTable).omit({ id: true, createdAt: true });
export type ReorderRule = typeof reorderRulesTable.$inferSelect;

export type StockTake = typeof stockTakesTable.$inferSelect;
export type StockTakeLine = typeof stockTakeLinesTable.$inferSelect;
