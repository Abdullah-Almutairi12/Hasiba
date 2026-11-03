import { pgTable, serial, text, numeric, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Identity is company-local. NULL is missing evidence, not registration status.
  vatNumber: text("vat_number"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  // Procurement extensions (added & backfilled in procurement-init).
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  defaultCurrency: text("default_currency").notNull().default("SAR"),
  leadTimeDays: integer("lead_time_days").notNull().default(7),
  defaultTax: numeric("default_tax", { precision: 5, scale: 2 }).notNull().default("15"),
  notes: text("notes"),
  /** Tenant scope (Phase 2): NOT NULL with restrict to prevent silent orphans. */
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  /**
   * Multi-Company Phase 5: when set, this supplier represents another
   * company inside the group. Purchase orders to such a supplier are
   * mirrored as sales orders on the linked company via
   * lib/intercompany-mirror.ts.
   */
  linkedCompanyId: integer("linked_company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [unique("suppliers_company_vat_number_unique").on(table.companyId, table.vatNumber)]);

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({
  id: true,
  createdAt: true,
  balance: true,
});
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;
