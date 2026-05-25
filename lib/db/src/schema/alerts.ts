import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  /** Nullable in Phase 1; becomes NOT NULL in Phase 2 once tenant scoping lands. */
  /**
   * Nullable on purpose: cross-tenant operational alerts emitted by
   * background workers (invoice-email-retry-worker for quotation/PO
   * outboxes, reporting-workers KPI evaluator) cannot derive a single
   * tenant because their parent tables aren't yet tenant-scoped. The
   * dashboard reader (/dashboard/alerts) uses strict eq(companyId,…),
   * so NULL alerts never leak into a specific tenant's feed — they
   * remain visible only via cross-tenant operations views.
   */
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;
