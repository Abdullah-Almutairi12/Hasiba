import { pgTable, integer, serial, text, jsonb, numeric, boolean, timestamp, primaryKey, uniqueIndex, check, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";
import { employeesTable } from "./hr";
import { usersTable } from "./users";
import { branchesTable } from "./branches";
import { creditNotesTable, customerInvoicesTable, customerReceiptsTable } from "./sales";
import { posSessionsTable } from "./pos";
import { journalEntriesTable } from "./accounting";
import { approvalRequestsTable } from "./workflow";

export const returnAccessTable = pgTable("return_access", {
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  template: text("template").notNull(), capabilities: jsonb("capabilities").$type<string[]>().notNull(),
  branches: jsonb("branches").$type<number[]>().notNull(),
  updatedBy: integer("updated_by").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.companyId, t.userId] })]);
export const returnPoliciesTable = pgTable("return_policies", {
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  branchId: integer("branch_id").notNull().default(0),
  approvalAbove: numeric("approval_above", { precision: 18, scale: 2 }),
  allowResale: boolean("allow_resale").notNull().default(true),
}, t => [primaryKey({ columns: [t.companyId, t.branchId] }), check("return_policies_approval_above_check", sql`${t.approvalAbove} IS NULL OR ${t.approvalAbove}>=0`)]);
export const returnControlsTable = pgTable("return_controls", {
  noteId: integer("note_id").primaryKey().references(() => creditNotesTable.id),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  fingerprint: text("fingerprint").notNull(),
  disposition: text("disposition").notNull(),
  settlementMethod: text("settlement_method").notNull(),
  proofRef: text("proof_ref").notNull(),
  approvalId: integer("approval_id").references(() => approvalRequestsTable.id),
  receiptRequired: boolean("receipt_required").notNull().default(false),
  receivedBy: integer("received_by").references(() => usersTable.id),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  receiptReference: text("receipt_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check("return_controls_disposition_check", sql`${t.disposition} IN ('resale','discard','no_goods')`),
  check("return_controls_settlement_method_check", sql`${t.settlementMethod} IN ('credit','cash','card','transfer','stc')`)]);
export const returnPayoutsTable = pgTable("return_payouts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  noteId: integer("note_id").notNull().references(() => creditNotesTable.id),
  invoiceId: integer("invoice_id").notNull().references(() => customerInvoicesTable.id),
  receiptId: integer("receipt_id").notNull().references(() => customerReceiptsTable.id),
  sessionId: integer("session_id").notNull().references(() => posSessionsTable.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  method: text("method").notNull(), status: text("status").notNull(), reference: text("reference").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), fingerprint: text("fingerprint").notNull(),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  confirmedBy: integer("confirmed_by").references(() => usersTable.id),
  journalId: integer("journal_id").references(() => journalEntriesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, t => [uniqueIndex("return_payouts_company_id_idempotency_key_key").on(t.companyId, t.idempotencyKey),
  check("return_payouts_amount_check", sql`${t.amount}>0`),
  check("return_payouts_method_check", sql`${t.method} IN ('cash','card','transfer','stc')`),
  check("return_payouts_status_check", sql`${t.status} IN ('requested','confirmed','external_confirmed','cancelled')`)]);
export const posCashClosingsTable = pgTable("pos_cash_closings", {
  sessionId: integer("session_id").primaryKey().references(() => posSessionsTable.id),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  expected: numeric("expected", { precision: 18, scale: 2 }).notNull(),
  counted: numeric("counted", { precision: 18, scale: 2 }).notNull(),
  difference: numeric("difference", { precision: 18, scale: 2 }).notNull(),
  reason: text("reason").notNull(), status: text("status").notNull(),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
}, t => [check("pos_cash_closings_counted_check", sql`${t.counted}>=0`),
  check("pos_cash_closings_status_check", sql`${t.status} IN ('pending','approved')`)]);
export const posCashExpensesTable = pgTable("pos_cash_expenses", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  sessionId: integer("session_id").notNull().references(() => posSessionsTable.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), reference: text("reference").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), fingerprint: text("fingerprint").notNull(),
  journalId: integer("journal_id").notNull().references(() => journalEntriesTable.id),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("pos_cash_expenses_company_id_idempotency_key_key").on(t.companyId, t.idempotencyKey),
  check("pos_cash_expenses_amount_check", sql`${t.amount}>0`)]);

export const posOwnerExceptionPoliciesTable = pgTable("pos_owner_exception_policies", {
  companyId:integer("company_id").primaryKey().references(()=>companiesTable.id),
  enabled:boolean("enabled").notNull().default(false),
  operations:jsonb("operations").$type<string[]>().notNull().default([]),
  amountLimit:numeric("amount_limit",{precision:18,scale:2}).notNull().default("0"),
  revision:integer("revision").notNull().default(1),reason:text("reason").notNull(),
  updatedBy:integer("updated_by").notNull().references(()=>usersTable.id),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
}, t=>[check("pos_owner_exception_policies_amount_limit_check",sql`${t.amountLimit}>=0`)]);
export const posOwnerOperationProofsTable = pgTable("pos_owner_operation_proofs", {
  tokenHash:text("token_hash").primaryKey(),companyId:integer("company_id").notNull().references(()=>companiesTable.id),
  userId:integer("user_id").notNull().references(()=>usersTable.id),purpose:text("purpose").notNull(),
  sessionId:integer("session_id").notNull().references(()=>posSessionsTable.id),sourceFingerprint:text("source_fingerprint").notNull(),
  policyRevision:integer("policy_revision").notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
  consumedAt:timestamp("consumed_at",{withTimezone:true}),createdAt:timestamp("created_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
});
export const posCashResponsibilityDecisionsTable = pgTable("pos_cash_responsibility_decisions", {
  id:serial("id").primaryKey(),companyId:integer("company_id").notNull().references(()=>companiesTable.id),
  sessionId:integer("session_id").notNull().references(()=>posSessionsTable.id),decision:text("decision").notNull(),
  employeeId:integer("employee_id").references(()=>employeesTable.id),reason:text("reason").notNull(),evidence:text("evidence").notNull(),
  decidedBy:integer("decided_by").notNull().references(()=>usersTable.id),decidedAt:timestamp("decided_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
  idempotencyKey:uuid("idempotency_key").notNull(),fingerprint:text("fingerprint").notNull(),
  ownerException:boolean("owner_exception").notNull().default(false),
  differenceAmount:numeric("difference_amount",{precision:18,scale:2}).notNull(),
  closingSnapshot:jsonb("closing_snapshot").notNull(),
},t=>[uniqueIndex("pos_cash_responsibility_decisions_company_id_session_id_key").on(t.companyId,t.sessionId),
  uniqueIndex("pos_cash_responsibility_decisions_company_id_idempotency_key_key").on(t.companyId,t.idempotencyKey),
  check("pos_cash_responsibility_decisions_decision_check",sql`${t.decision} IN ('company_bears','employee_responsible')`),
  check("pos_cash_responsibility_decisions_check",sql`(${t.decision}='employee_responsible')=(${t.employeeId} IS NOT NULL)`)]);
