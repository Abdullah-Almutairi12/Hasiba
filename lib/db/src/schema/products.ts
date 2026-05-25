import { pgTable, serial, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";
import { companiesTable } from "./companies";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  sku: text("sku").notNull().unique(),
  categoryId: integer("category_id").notNull().references(() => categoriesTable.id),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  costPrice: numeric("cost_price", { precision: 10, scale: 2 }).notNull(),
  stock: numeric("stock", { precision: 18, scale: 4 }).notNull().default("0"),
  minStock: integer("min_stock").notNull().default(5),
  unit: text("unit").notNull().default("piece"),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").notNull().default(true),
  // Inventory ledger fields (Task #2)
  barcode: text("barcode"),
  trackingMode: text("tracking_mode").notNull().default("none"), // none | lot | serial
  costingMethod: text("costing_method").notNull().default("average"), // fifo | average | standard
  isVariantParent: boolean("is_variant_parent").notNull().default(false),
  /** Nullable in Phase 1; becomes NOT NULL in Phase 2 once tenant scoping lands. */
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
