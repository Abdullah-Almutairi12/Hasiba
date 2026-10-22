import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { stockQuantsTable } from "./inventory";
import { accountsTable, journalEntriesTable } from "./accounting";
import { usersTable } from "./users";

// Value-only movement ledger. Never mix zero-quantity valuation entries with
// physical stock moves, whose quantity * unitCost describes actual goods.
export const stockRevaluationsTable = pgTable("stock_revaluations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  quantId: integer("quant_id").notNull().references(() => stockQuantsTable.id),
  productName: text("product_name").notNull(),
  warehouseName: text("warehouse_name").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  oldCost: numeric("old_cost", { precision: 30, scale: 16 }).notNull(),
  targetCost: numeric("target_cost", { precision: 30, scale: 16 }).notNull(),
  oldValue: numeric("old_value", { precision: 48, scale: 20 }).notNull(),
  newValue: numeric("new_value", { precision: 48, scale: 20 }).notNull(),
  delta: numeric("delta", { precision: 18, scale: 2 }).notNull(),
  quantVersion: text("quant_version").notNull(),
  lastMoveId: integer("last_move_id").notNull(),
  varianceAccountId: integer("variance_account_id").notNull().references(() => accountsTable.id),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("preview"),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  confirmedBy: integer("confirmed_by").references(() => usersTable.id),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  journalEntryId: integer("journal_entry_id").unique().references(() => journalEntriesTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at"),
  approvedAt: timestamp("approved_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: integer("cancelled_by").references(() => usersTable.id),
});
