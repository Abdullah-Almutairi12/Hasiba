import { pool, db, financialLimitsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Boot-time initialization for the Workflow & Approvals subsystem.
 * Creates all required tables idempotently and seeds default per-role
 * financial limits (discount %, refund amount, etc.).
 */
export async function initWorkflow(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS approval_rules (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      branch_id INTEGER,
      min_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      max_amount NUMERIC(18,2),
      mode TEXT NOT NULL DEFAULT 'sequential',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS approval_rules_doc_idx ON approval_rules(doc_type, is_active);

    CREATE TABLE IF NOT EXISTS approval_steps (
      id SERIAL PRIMARY KEY,
      rule_id INTEGER NOT NULL REFERENCES approval_rules(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL DEFAULT 1,
      approver_role TEXT NOT NULL,
      approver_user_id INTEGER,
      min_amount NUMERIC(18,2) NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS approval_steps_rule_idx ON approval_steps(rule_id, sequence);

    CREATE TABLE IF NOT EXISTS approval_requests (
      id SERIAL PRIMARY KEY,
      rule_id INTEGER REFERENCES approval_rules(id) ON DELETE SET NULL,
      doc_type TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      record_ref TEXT,
      branch_id INTEGER,
      amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      submitted_by_user_id INTEGER,
      submitted_by_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      current_step INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      forced_steps JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ
    );
    -- Backfill the forced_steps column on pre-existing databases so
    -- ad-hoc/forced approvals (ruleId = null) can persist their
    -- synthesized step chain. CREATE TABLE IF NOT EXISTS won't add
    -- columns to existing tables.
    ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS forced_steps JSONB;
    CREATE INDEX IF NOT EXISTS approval_requests_status_idx ON approval_requests(status);
    CREATE INDEX IF NOT EXISTS approval_requests_doc_idx ON approval_requests(doc_type, record_id);

    CREATE TABLE IF NOT EXISTS approval_actions (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
      step_sequence INTEGER NOT NULL,
      approver_user_id INTEGER,
      approver_name TEXT,
      action TEXT NOT NULL,
      comment TEXT,
      acted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS approval_actions_req_idx ON approval_actions(request_id);

    CREATE TABLE IF NOT EXISTS approver_delegations (
      id SERIAL PRIMARY KEY,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      from_date TIMESTAMPTZ NOT NULL,
      to_date TIMESTAMPTZ NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS approver_delegations_from_idx ON approver_delegations(from_user_id, from_date, to_date);

    CREATE TABLE IF NOT EXISTS financial_limits (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL,
      action_key TEXT NOT NULL,
      max_value NUMERIC(18,4),
      description TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(role, action_key)
    );
    CREATE INDEX IF NOT EXISTS financial_limits_key_idx ON financial_limits(role, action_key);

    CREATE TABLE IF NOT EXISTS automation_rules (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      trigger JSONB NOT NULL,
      conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
      actions JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_run_at TIMESTAMPTZ,
      created_by_user_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id SERIAL PRIMARY KEY,
      rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
      triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL,
      matched_records INTEGER NOT NULL DEFAULT 0,
      actions_executed INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      details JSONB
    );
    CREATE INDEX IF NOT EXISTS automation_runs_rule_idx ON automation_runs(rule_id, triggered_at);

    CREATE TABLE IF NOT EXISTS notification_inbox (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      payload JSONB,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS notification_inbox_user_idx ON notification_inbox(user_id, is_read, created_at);
  `);

  // Seed default financial limits per role.
  const seeds: Array<{
    role: string;
    actionKey: string;
    maxValue: string | null;
    description: string;
  }> = [
    { role: "cashier",    actionKey: "pos.discount_pct",       maxValue: "5",     description: "أقصى خصم نسبي على فاتورة POS (%)" },
    { role: "sales",      actionKey: "pos.discount_pct",       maxValue: "10",    description: "أقصى خصم نسبي على فاتورة POS (%)" },
    { role: "manager",    actionKey: "pos.discount_pct",       maxValue: "20",    description: "أقصى خصم نسبي على فاتورة POS (%)" },
    { role: "owner",      actionKey: "pos.discount_pct",       maxValue: null,    description: "بدون حد" },
    { role: "cashier",    actionKey: "pos.refund_amount",      maxValue: "500",   description: "أقصى مبلغ استرداد نقدي (ر.س)" },
    { role: "manager",    actionKey: "pos.refund_amount",      maxValue: "5000",  description: "أقصى مبلغ استرداد نقدي (ر.س)" },
    { role: "owner",      actionKey: "pos.refund_amount",      maxValue: null,    description: "بدون حد" },
    { role: "accountant", actionKey: "ap.payment_amount",      maxValue: "100000", description: "أقصى دفعة مورّد بدون اعتماد" },
    { role: "manager",    actionKey: "ap.payment_amount",      maxValue: "500000", description: "أقصى دفعة مورّد بدون اعتماد" },
    { role: "owner",      actionKey: "ap.payment_amount",      maxValue: null,    description: "بدون حد" },
    { role: "sales",      actionKey: "sales.credit_note_amount", maxValue: "1000", description: "أقصى قيمة إشعار دائن بدون اعتماد" },
    { role: "manager",    actionKey: "sales.credit_note_amount", maxValue: "20000", description: "أقصى قيمة إشعار دائن بدون اعتماد" },
    { role: "owner",      actionKey: "sales.credit_note_amount", maxValue: null,  description: "بدون حد" },
  ];

  for (const s of seeds) {
    try {
      await db
        .insert(financialLimitsTable)
        .values({ role: s.role, actionKey: s.actionKey, maxValue: s.maxValue, description: s.description })
        .onConflictDoNothing();
    } catch (err) {
      logger.warn({ err, seed: s }, "seed financial_limit failed");
    }
  }

  // Schedule the automation cron sweep every 60 seconds.
  void scheduleAutomationSweep();
}

let sweepStarted = false;
async function scheduleAutomationSweep(): Promise<void> {
  if (sweepStarted) return;
  sweepStarted = true;
  const { runScheduledAutomations } = await import("./workflow-engine");
  setInterval(() => {
    runScheduledAutomations().catch((err) => logger.warn({ err }, "automation sweep failed"));
  }, 60_000);
  // Kick once on boot (after a short delay so the rest of init can finish).
  setTimeout(() => {
    runScheduledAutomations().catch(() => {});
  }, 5_000);
}

// Silence unused-import warning for sql in case future seeds need it.
void sql;
