import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  totalOrders: integer("total_orders").notNull().default(0),
  totalSpent: numeric("total_spent", { precision: 10, scale: 2 }).notNull().default("0"),
  // Q2C extensions (Task #4)
  segment: text("segment").notNull().default("retail"), // retail | wholesale | vip | distributor
  defaultPricelistId: integer("default_pricelist_id"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(0),
  creditLimit: numeric("credit_limit", { precision: 18, scale: 2 }).notNull().default("0"),
  taxNumber: text("tax_number"),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  /** Nullable in Phase 1; becomes NOT NULL in Phase 2 once tenant scoping lands. */
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, totalOrders: true, totalSpent: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
