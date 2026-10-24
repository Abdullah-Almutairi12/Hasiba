import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

// ---------------------------------------------------------------------------
// Approval Matrix: per (docType + optional branch) a chain of steps.
// Each step has a role + optional financial threshold + sequence index.
// "sequential" = step N waits for N-1 to approve.
// "parallel"   = all steps can be approved in any order; request is approved
//                only when *all* steps are approved.
// ---------------------------------------------------------------------------
export const approvalRulesTable = pgTable(
  "approval_rules",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companiesTable.id),
    name: text("name").notNull(),
    docType: text("doc_type").notNull(), // purchase_order, sales_order, expense_claim, leave_request, journal_entry, credit_note, payment_run
    branchId: integer("branch_id"),
    minAmount: numeric("min_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    maxAmount: numeric("max_amount", { precision: 18, scale: 2 }),
    mode: text("mode").notNull().default("sequential"), // sequential | parallel
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDoc: index("approval_rules_doc_idx").on(t.docType, t.isActive),
    byCompany: index("approval_rules_company_lookup").on(t.companyId, t.docType, t.isActive),
  }),
);

export const approvalStepsTable = pgTable(
  "approval_steps",
  {
    id: serial("id").primaryKey(),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => approvalRulesTable.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull().default(1),
    approverRole: text("approver_role").notNull(),
    approverUserId: integer("approver_user_id"),
    minAmount: numeric("min_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  },
  (t) => ({
    byRule: index("approval_steps_rule_idx").on(t.ruleId, t.sequence),
  }),
);

// ---------------------------------------------------------------------------
// A live approval request — one per submitted record awaiting a decision.
// The engine writes one row here when a record enters "Pending Approval"
// and writes one row per step into approval_actions as decisions accrue.
// ---------------------------------------------------------------------------
export const approvalRequestsTable = pgTable(
  "approval_requests",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companiesTable.id),
    ruleId: integer("rule_id").references(() => approvalRulesTable.id, { onDelete: "set null" }),
    docType: text("doc_type").notNull(),
    recordId: integer("record_id").notNull(),
    recordRef: text("record_ref"),
    branchId: integer("branch_id"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull().default("0"),
    submittedByUserId: integer("submitted_by_user_id"),
    submittedByName: text("submitted_by_name"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | changes_requested | cancelled
    currentStep: integer("current_step").notNull().default(1),
    notes: text("notes"),
    // Synthesized step chain for forced approvals (ruleId = null). When the
    // engine creates an ad-hoc request that doesn't map to a configured rule
    // (e.g. credit-limit breach routed to a specific role list), we persist
    // the role chain here so actOnApproval can advance multi-step forced
    // approvals correctly instead of collapsing to a single virtual step.
    // Shape: Array<{ sequence: number; approverRole: string; approverUserId: number | null }>
    forcedSteps: jsonb("forced_steps"),
    policySnapshot: jsonb("policy_snapshot"),
    sourceFingerprint: text("source_fingerprint"),
    sourceFingerprintVersion: integer("source_fingerprint_version"),
    reviewInvalidatedReason: text("review_invalidated_reason"),
    reviewInvalidatedAt: timestamp("review_invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => ({
    byStatus: index("approval_requests_status_idx").on(t.status),
    byCompany: index("approval_requests_company_lookup").on(t.companyId, t.status, t.createdAt),
    byDocRecord: index("approval_requests_doc_idx").on(t.docType, t.recordId),
  }),
);

export const approvalActionsTable = pgTable(
  "approval_actions",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => approvalRequestsTable.id, { onDelete: "cascade" }),
    stepSequence: integer("step_sequence").notNull(),
    approverUserId: integer("approver_user_id"),
    approverName: text("approver_name"),
    action: text("action").notNull(), // approve | reject | request_changes | comment | delegated
    comment: text("comment"),
    actedAt: timestamp("acted_at", { withTimezone: true }).notNull().defaultNow(),
    decisionKey: text("decision_key"),
    decisionFingerprint: text("decision_fingerprint"),
    decisionResult: jsonb("decision_result"),
  },
  (t) => ({
    byReq: index("approval_actions_req_idx").on(t.requestId),
  }),
);

export const approverDelegationsTable = pgTable(
  "approver_delegations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companiesTable.id),
    fromUserId: integer("from_user_id").notNull(),
    toUserId: integer("to_user_id").notNull(),
    fromDate: timestamp("from_date", { withTimezone: true }).notNull(),
    toDate: timestamp("to_date", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("approver_delegations_from_idx").on(t.fromUserId, t.fromDate, t.toDate),
    byCompany: index("approver_delegations_company_lookup").on(t.companyId, t.fromUserId, t.fromDate, t.toDate),
  }),
);

// ---------------------------------------------------------------------------
// Per-role financial limits enforced at the action level (e.g. discounts,
// refunds, write-offs). Cashier may discount up to 5%, manager 20%, etc.
// `actionKey` is a free-form identifier shared with the route that calls
// requireFinancialLimit("pos.discount_pct", value).
// ---------------------------------------------------------------------------
export const financialLimitsTable = pgTable(
  "financial_limits",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companiesTable.id),
    role: text("role").notNull(),
    actionKey: text("action_key").notNull(),
    maxValue: numeric("max_value", { precision: 18, scale: 4 }),
    description: text("description"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byKey: index("financial_limits_key_idx").on(t.role, t.actionKey),
    companyKey: uniqueIndex("financial_limits_company_key").on(t.companyId, t.role, t.actionKey),
  }),
);

// ---------------------------------------------------------------------------
// Automation Rules: trigger → conditions (filters) → actions.
// `trigger` shape (jsonb):
//   { type: "record_created"|"record_updated"|"state_changed"|"scheduled",
//     entity: "customer_invoice", state?: "overdue", cron?: "0 9 * * *" }
// `conditions` shape: array of { field, op: "eq"|"ne"|"gt"|"lt"|"gte"|"lte"|"contains", value }
// `actions` shape: array of:
//   { type: "set_field", field, value }
//   { type: "send_notification", recipientRole|recipientUserId, title, message, channel: "inapp"|"email"|"whatsapp" }
//   { type: "create_record", entity, payload }
//   { type: "call_webhook", url, method?, payload? }
// ---------------------------------------------------------------------------
export const automationRulesTable = pgTable(
  "automation_rules",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companiesTable.id),
    branchIds: jsonb("branch_ids").$type<number[] | null>(),
    name: text("name").notNull(),
    description: text("description"),
    trigger: jsonb("trigger").notNull(),
    conditions: jsonb("conditions").notNull().default([]),
    actions: jsonb("actions").notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const automationRunsTable = pgTable(
  "automation_runs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companiesTable.id),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => automationRulesTable.id, { onDelete: "cascade" }),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull(), // success | partial | failed
    matchedRecords: integer("matched_records").notNull().default(0),
    actionsExecuted: integer("actions_executed").notNull().default(0),
    error: text("error"),
    details: jsonb("details"),
  },
  (t) => ({
    byRule: index("automation_runs_rule_idx").on(t.ruleId, t.triggeredAt),
  }),
);

// ---------------------------------------------------------------------------
// In-app notification inbox (per user). The email channel is a side-effect
// performed by the engine; WhatsApp is stubbed in mailer/whatsapp adapter.
// ---------------------------------------------------------------------------
export const notificationInboxTable = pgTable(
  "notification_inbox",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companiesTable.id),
    userId: integer("user_id").notNull(),
    type: text("type").notNull(), // approval | automation | system
    title: text("title").notNull(),
    message: text("message").notNull(),
    link: text("link"),
    payload: jsonb("payload"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("notification_inbox_user_idx").on(t.userId, t.isRead, t.createdAt),
  }),
);

export type ApprovalRule = typeof approvalRulesTable.$inferSelect;
export type ApprovalStep = typeof approvalStepsTable.$inferSelect;
export type ApprovalRequest = typeof approvalRequestsTable.$inferSelect;
export type ApprovalAction = typeof approvalActionsTable.$inferSelect;
export type ApproverDelegation = typeof approverDelegationsTable.$inferSelect;
export type FinancialLimit = typeof financialLimitsTable.$inferSelect;
export type AutomationRule = typeof automationRulesTable.$inferSelect;
export type AutomationRun = typeof automationRunsTable.$inferSelect;
export type NotificationInbox = typeof notificationInboxTable.$inferSelect;
