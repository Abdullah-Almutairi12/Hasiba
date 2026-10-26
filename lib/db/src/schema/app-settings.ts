import { pgTable, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { branchesTable } from "./branches";
import { usersTable } from "./users";

// Tenant/branch sections. Unassigned historic rows (including the platform
// system singleton id=1) are retained, never inherited by a company.
export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  // NULL ownership is retained legacy/platform history, never a tenant default.
  companyId: integer("company_id").references(() => companiesTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  revision: integer("revision").notNull().default(0),
  company: jsonb("company").notNull().default({}),
  tax: jsonb("tax").notNull().default({}),
  branches: jsonb("branches").notNull().default({}),
  pos: jsonb("pos").notNull().default({}),
  permissions: jsonb("permissions").notNull().default({}),
  accounting: jsonb("accounting").notNull().default({}),
  integrations: jsonb("integrations").notNull().default({}),
  // Phase: full settings surface for subscribers. Each section is a free
  // jsonb bag; shape is enforced by the API layer + UI, never by SQL.
  notifications: jsonb("notifications").notNull().default({}),
  localization: jsonb("localization").notNull().default({}),
  numbering: jsonb("numbering").notNull().default({}),
  appearance: jsonb("appearance").notNull().default({}),
  backup: jsonb("backup").notNull().default({}),
  templates: jsonb("templates").notNull().default({}),
  // System-level toggles exposed in /admin (e.g. alertRetentionDays).
  // Free jsonb bag; shape enforced at the API layer.
  system: jsonb("system").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppSettings = typeof appSettingsTable.$inferSelect;

export const appSettingsVersionsTable=pgTable("app_settings_versions",{
 id:serial("id").primaryKey(),
 companyId:integer("company_id").notNull().references(()=>companiesTable.id),
 branchId:integer("branch_id").references(()=>branchesTable.id),
 revision:integer("revision").notNull(),
 parentRevision:integer("parent_revision").notNull(),
 changedSections:jsonb("changed_sections").notNull(),
 createdBy:integer("created_by").notNull().references(()=>usersTable.id),
 createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
