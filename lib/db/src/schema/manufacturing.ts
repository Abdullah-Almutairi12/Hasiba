import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";
import { warehousesTable } from "./warehouses";
import { usersTable } from "./users";

// ===== Bill of Materials =====
export const bomsTable = pgTable(
  "boms",
  {
    id: serial("id").primaryKey(),
    reference: text("reference").notNull().unique(),
    productId: integer("product_id").notNull().references(() => productsTable.id),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("1"),
    isPhantom: boolean("is_phantom").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    routingId: integer("routing_id"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    productIdx: index("boms_product_idx").on(t.productId),
  }),
);

export const bomLinesTable = pgTable(
  "bom_lines",
  {
    id: serial("id").primaryKey(),
    bomId: integer("bom_id").notNull().references(() => bomsTable.id, { onDelete: "cascade" }),
    componentId: integer("component_id").notNull().references(() => productsTable.id),
    quantityPer: numeric("quantity_per", { precision: 18, scale: 4 }).notNull(),
    unit: text("unit").notNull().default("piece"),
    scrapPct: numeric("scrap_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
  },
  (t) => ({
    bomIdx: index("bom_lines_bom_idx").on(t.bomId),
  }),
);

// ===== Work Centers =====
export const workCentersTable = pgTable("work_centers", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  capacityPerDay: numeric("capacity_per_day", { precision: 18, scale: 4 }).notNull().default("8"),
  hourlyCost: numeric("hourly_cost", { precision: 18, scale: 4 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ===== Routings =====
export const routingsTable = pgTable("routings", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const routingOperationsTable = pgTable(
  "routing_operations",
  {
    id: serial("id").primaryKey(),
    routingId: integer("routing_id").notNull().references(() => routingsTable.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull().default(10),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    workCenterId: integer("work_center_id").notNull().references(() => workCentersTable.id),
    durationMinutes: numeric("duration_minutes", { precision: 18, scale: 2 }).notNull().default("0"),
    instructions: text("instructions"),
  },
  (t) => ({
    routingIdx: index("routing_ops_routing_idx").on(t.routingId, t.sequence),
  }),
);

// ===== Work Orders =====
export const WORK_ORDER_STATES = [
  "draft",
  "confirmed",
  "in_progress",
  "done",
  "cancelled",
] as const;
export type WorkOrderState = (typeof WORK_ORDER_STATES)[number];

export const workOrdersTable = pgTable(
  "work_orders",
  {
    id: serial("id").primaryKey(),
    reference: text("reference").notNull().unique(),
    bomId: integer("bom_id").notNull().references(() => bomsTable.id),
    productId: integer("product_id").notNull().references(() => productsTable.id),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    quantityProduced: numeric("quantity_produced", { precision: 18, scale: 4 }).notNull().default("0"),
    warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id),
    state: text("state").notNull().default("draft"),
    plannedStart: date("planned_start"),
    plannedEnd: date("planned_end"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    standardCost: numeric("standard_cost", { precision: 18, scale: 4 }).notNull().default("0"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    completedBy: integer("completed_by").references(() => usersTable.id),
    parentWorkOrderId: integer("parent_work_order_id"),
    isRework: boolean("is_rework").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    stateIdx: index("work_orders_state_idx").on(t.state),
    productIdx: index("work_orders_product_idx").on(t.productId),
  }),
);

// Reservations of components when WO is confirmed (not yet consumed).
export const workOrderReservationsTable = pgTable(
  "work_order_reservations",
  {
    id: serial("id").primaryKey(),
    workOrderId: integer("work_order_id").notNull().references(() => workOrdersTable.id, { onDelete: "cascade" }),
    componentId: integer("component_id").notNull().references(() => productsTable.id),
    warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    consumedQty: numeric("consumed_qty", { precision: 18, scale: 4 }).notNull().default("0"),
  },
  (t) => ({
    woIdx: index("wo_reservations_wo_idx").on(t.workOrderId),
  }),
);

// Real consumption events (linked to a stock_move).
export const workOrderConsumptionsTable = pgTable(
  "work_order_consumptions",
  {
    id: serial("id").primaryKey(),
    workOrderId: integer("work_order_id").notNull().references(() => workOrdersTable.id, { onDelete: "cascade" }),
    componentId: integer("component_id").notNull().references(() => productsTable.id),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull().default("0"),
    stockMoveId: integer("stock_move_id"),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => ({
    woIdx: index("wo_consumptions_wo_idx").on(t.workOrderId),
  }),
);

// Production events (finished goods produced, linked to a stock_move).
export const workOrderProductionsTable = pgTable(
  "work_order_productions",
  {
    id: serial("id").primaryKey(),
    workOrderId: integer("work_order_id").notNull().references(() => workOrdersTable.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull().default("0"),
    stockMoveId: integer("stock_move_id"),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => ({
    woIdx: index("wo_productions_wo_idx").on(t.workOrderId),
  }),
);

// ===== Quality Control =====
export const QC_RESULTS = ["pending", "pass", "fail"] as const;

// QC templates attached to a BoM. Auto-instantiated onto each work order
// created from that BoM, so checkpoints live "per BoM or per operation".
export const bomQcTemplatesTable = pgTable(
  "bom_qc_templates",
  {
    id: serial("id").primaryKey(),
    bomId: integer("bom_id").notNull().references(() => bomsTable.id, { onDelete: "cascade" }),
    operationId: integer("operation_id").references(() => routingOperationsTable.id),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    isMandatory: boolean("is_mandatory").notNull().default(true),
    notes: text("notes"),
  },
  (t) => ({
    bomIdx: index("bom_qc_templates_bom_idx").on(t.bomId),
  }),
);

export const qualityChecksTable = pgTable(
  "quality_checks",
  {
    id: serial("id").primaryKey(),
    workOrderId: integer("work_order_id").notNull().references(() => workOrdersTable.id, { onDelete: "cascade" }),
    operationId: integer("operation_id").references(() => routingOperationsTable.id),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    isMandatory: boolean("is_mandatory").notNull().default(true),
    result: text("result").notNull().default("pending"),
    notes: text("notes"),
    checkedBy: integer("checked_by").references(() => usersTable.id),
    checkedAt: timestamp("checked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    woIdx: index("quality_checks_wo_idx").on(t.workOrderId),
  }),
);

// ===== Scrap & Rework =====
export const SCRAP_REASONS = [
  "defect",
  "damaged",
  "expired",
  "qc_fail",
  "other",
] as const;

export const scrapRecordsTable = pgTable(
  "scrap_records",
  {
    id: serial("id").primaryKey(),
    reference: text("reference").notNull().unique(),
    productId: integer("product_id").notNull().references(() => productsTable.id),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    fromWarehouseId: integer("from_warehouse_id").notNull().references(() => warehousesTable.id),
    toWarehouseId: integer("to_warehouse_id").references(() => warehousesTable.id),
    workOrderId: integer("work_order_id").references(() => workOrdersTable.id),
    reworkedAt: timestamp("reworked_at"),
    reason: text("reason").notNull().default("other"),
    notes: text("notes"),
    stockMoveId: integer("stock_move_id"),
    journalEntryId: integer("journal_entry_id"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    productIdx: index("scrap_records_product_idx").on(t.productId),
    woIdx: index("scrap_records_wo_idx").on(t.workOrderId),
  }),
);

// ===== Zod & types =====
export const insertBomSchema = createInsertSchema(bomsTable).omit({ id: true, createdAt: true });
export type Bom = typeof bomsTable.$inferSelect;
export type InsertBom = z.infer<typeof insertBomSchema>;

export const insertBomLineSchema = createInsertSchema(bomLinesTable).omit({ id: true });
export type BomLine = typeof bomLinesTable.$inferSelect;

export const insertWorkCenterSchema = createInsertSchema(workCentersTable).omit({ id: true, createdAt: true });
export type WorkCenter = typeof workCentersTable.$inferSelect;

export const insertRoutingSchema = createInsertSchema(routingsTable).omit({ id: true, createdAt: true });
export type Routing = typeof routingsTable.$inferSelect;
export type RoutingOperation = typeof routingOperationsTable.$inferSelect;

export const insertWorkOrderSchema = createInsertSchema(workOrdersTable).omit({ id: true, createdAt: true });
export type WorkOrder = typeof workOrdersTable.$inferSelect;

export type WorkOrderConsumption = typeof workOrderConsumptionsTable.$inferSelect;
export type WorkOrderProduction = typeof workOrderProductionsTable.$inferSelect;
export type WorkOrderReservation = typeof workOrderReservationsTable.$inferSelect;
export type QualityCheck = typeof qualityChecksTable.$inferSelect;
export type BomQcTemplate = typeof bomQcTemplatesTable.$inferSelect;
export type ScrapRecord = typeof scrapRecordsTable.$inferSelect;
