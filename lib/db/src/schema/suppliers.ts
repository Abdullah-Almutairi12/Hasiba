import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Postgres treats each NULL as distinct in a UNIQUE constraint, so this still
  // allows multiple "informal" suppliers without a VAT number while preventing
  // duplicate registered suppliers (used by the OCR find-or-create flow).
  vatNumber: text("vat_number").unique(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({
  id: true,
  createdAt: true,
  balance: true,
});
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;
