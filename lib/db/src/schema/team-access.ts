import { pgTable, integer, text, timestamp, jsonb, serial, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { employeesTable } from "./hr";
import { usersTable } from "./users";
import { branchesTable } from "./branches";

export const teamSetupStateTable = pgTable("team_setup_state", {
  companyId: integer("company_id").primaryKey().references(() => companiesTable.id),
  mode: text("mode").notNull().default("team"),
  step: text("step").notNull().default("people"),
  draft: jsonb("draft").notNull().default({}),
  revision: integer("revision").notNull().default(1),
  updatedBy: integer("updated_by").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const teamAccessPolicyTable = pgTable("team_access_policy", {
  companyId: integer("company_id").primaryKey().references(() => companiesTable.id),
  enabledModules: text("enabled_modules").array().notNull(),
  seatLimit: integer("seat_limit"),
  source: text("source").notNull().default("development_configuration"),
  updatedBy: integer("updated_by").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const employeeAccessTable = pgTable("employee_access", {
  employeeId: integer("employee_id").primaryKey().references(() => employeesTable.id),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  userId: integer("user_id").references(() => usersTable.id),
  loginKinds: text("login_kinds").array().notNull(),
  status: text("status").notNull(),
  deniedActions: text("denied_actions").array().notNull(),
  revision: integer("revision").notNull().default(1),
  creationKey: text("creation_key").notNull(),
  creationHash: text("creation_hash").notNull(),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("employee_access_creation_key").on(t.companyId, t.creationKey)]);
export const responsibilityGrantsTable = pgTable("responsibility_grants", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeeAccessTable.employeeId),
  resource: text("resource").notNull(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  warehouseIds: integer("warehouse_ids").array().notNull(),
  actions: text("actions").array().notNull(),
  amountLimit: numeric("amount_limit", { precision: 18, scale: 4 }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const teamInvitationsTable = pgTable("team_invitations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  employeeId: integer("employee_id").notNull().references(() => employeeAccessTable.employeeId),
  revision: integer("revision").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  recipientEmail: text("recipient_email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
