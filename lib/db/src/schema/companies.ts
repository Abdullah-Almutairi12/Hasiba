import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Legal entities tracked by the system. Phase 1 of Multi-Company introduces
 * this table without yet enforcing scoping on existing routes — a single
 * "Main Company" row is seeded by the backfill script and every existing
 * record is linked to it via the new nullable `company_id` columns.
 *
 * Tenant scoping (NOT NULL + per-request filtering) lands in Phase 2.
 */
export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  vatNumber: text("vat_number"),
  crNumber: text("cr_number"),
  baseCurrency: text("base_currency").notNull().default("SAR"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  logoUrl: text("logo_url"),
  address: jsonb("address").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Per-user access matrix to companies. A user may belong to many companies
 * and have a different role in each. Exactly one row per user should carry
 * `isDefault = true` — the company selected at login when the session does
 * not specify one.
 */
export const userCompaniesTable = pgTable(
  "user_companies",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userCompanyUnique: uniqueIndex("user_companies_user_company_unique").on(
      t.userId,
      t.companyId,
    ),
  }),
);

/** Insert payload for {@link companiesTable}. */
export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;

/** Insert payload for {@link userCompaniesTable}. */
export const insertUserCompanySchema = createInsertSchema(
  userCompaniesTable,
).omit({ id: true, createdAt: true });
export type InsertUserCompany = z.infer<typeof insertUserCompanySchema>;
export type UserCompany = typeof userCompaniesTable.$inferSelect;
