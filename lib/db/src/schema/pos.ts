import { pgTable, serial, text, integer, numeric, timestamp, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { branchesTable } from "./branches";
import { customersTable } from "./customers";
import { companiesTable } from "./companies";

export const posSessionsTable = pgTable("pos_sessions", {
  posStationId: integer("pos_station_id"),
  id: serial("id").primaryKey(),
  sessionNumber: text("session_number").notNull().unique(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  cashierName: text("cashier_name").notNull(),
  openingCash: numeric("opening_cash", { precision: 10, scale: 2 }).notNull().default("0"),
  totalSales: numeric("total_sales", { precision: 10, scale: 2 }).notNull().default("0"),
  ordersCount: integer("orders_count").notNull().default(0),
  status: text("status").notNull().default("open"),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const posOrdersTable = pgTable("pos_orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  sessionId: integer("session_id").notNull().references(() => posSessionsTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  items: jsonb("items").notNull().default([]),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: numeric("tax", { precision: 10, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 10, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  /**
   * Lifecycle status. `paid` = completed checkout (default historical
   * behaviour). `parked` = Order Parking (hold) — cashier saved the
   * basket to resume later; not counted in session totals until resumed
   * and re-checked-out.
   */
  status: text("status").notNull().default("paid"),
  /** When `status='parked'`: the cashier-supplied label (e.g. "طاولة 5"). */
  parkedLabel: text("parked_label"),
  /** Nullable in Phase 1; becomes NOT NULL in Phase 2 once tenant scoping lands. */
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPosSessionSchema = createInsertSchema(posSessionsTable).omit({ id: true, openedAt: true, closedAt: true, totalSales: true, ordersCount: true, status: true });
export type InsertPosSession = z.infer<typeof insertPosSessionSchema>;
export type PosSession = typeof posSessionsTable.$inferSelect;

export const posOrderPaymentsTable = pgTable(
  "pos_order_payments",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull().references(() => posOrdersTable.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    reference: text("reference"),
    payerName: text("payer_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    amountChk: check("pos_order_payments_amount_chk", sql`${t.amount} > 0`),
    methodChk: check(
      "pos_order_payments_method_chk",
      sql`${t.method} IN ('cash','card','transfer','stc','deferred')`,
    ),
  }),
);

export const insertPosOrderSchema = createInsertSchema(posOrdersTable).omit({ id: true, createdAt: true });
export type InsertPosOrder = z.infer<typeof insertPosOrderSchema>;
export type PosOrder = typeof posOrdersTable.$inferSelect;
export type PosOrderPayment = typeof posOrderPaymentsTable.$inferSelect;
