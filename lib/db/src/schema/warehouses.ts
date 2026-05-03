import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const warehousesTable = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isScrap: boolean("is_scrap").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWarehouseSchema = createInsertSchema(warehousesTable).omit({ id: true, createdAt: true });
export type InsertWarehouse = z.infer<typeof insertWarehouseSchema>;
export type Warehouse = typeof warehousesTable.$inferSelect;
