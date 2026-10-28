import { pgTable, uuid, integer, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { companiesTable } from "./companies";
import { usersTable } from "./users";
// Scope key zero represents company defaults, not a fictitious branch.
// Tenant/branch ownership and immutable evidence are enforced in migration
// constraints/triggers as well as the existing settings authorization service.
export const invoiceEditorDraftsTable = pgTable("invoice_editor_drafts", {
  id: uuid("id").primaryKey(), companyId: integer("company_id").notNull().references(() => companiesTable.id),
  scopeKey: integer("scope_key").notNull(), revision: integer("revision").notNull(),
  design: jsonb("design").notNull(), updatedBy: integer("updated_by").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const invoiceEditorReleasesTable = pgTable("invoice_editor_releases", {
  id: uuid("id").primaryKey(), companyId: integer("company_id").notNull().references(() => companiesTable.id),
  draftId: uuid("draft_id").notNull().references(() => invoiceEditorDraftsTable.id),
  draftRevision: integer("draft_revision").notNull(), design: jsonb("design").notNull(),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const invoiceEditorActivationTable = pgTable("invoice_editor_activation", {
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  scopeKey: integer("scope_key").notNull(), revision: integer("revision").notNull().default(0),
  releaseId: uuid("release_id"),
}, t => [primaryKey({ columns: [t.companyId, t.scopeKey] })]);
export const invoiceEditorRequestsTable = pgTable("invoice_editor_requests", {
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  requestId: uuid("request_id").notNull(), actorId: integer("actor_id").notNull().references(() => usersTable.id),
  bodyHash: text("body_hash").notNull(), result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.companyId, t.requestId] })]);
export const invoiceEditorPreviewsTable = pgTable("invoice_editor_previews", {
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  scopeKey: integer("scope_key").notNull(), designHash: text("design_hash").notNull(),
  sample: text("sample").notNull(), width: text("width").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.companyId, t.scopeKey, t.designHash, t.sample, t.width] })]);
export const insertInvoiceEditorDraftSchema = createInsertSchema(invoiceEditorDraftsTable);
export type InvoiceEditorDraft = typeof invoiceEditorDraftsTable.$inferSelect;
