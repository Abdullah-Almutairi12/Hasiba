import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Task #204 boot init: bring `cleanup_report_sends` + the new
 * `cleanup_report_send_recipients` table into line with the schema
 * additions for per-recipient delivery tracking. Mirrors the
 * `initAlertDismissals` pattern — idempotent DDL that lets a running
 * deployment self-heal without a manual `drizzle-kit push` or a
 * separate migration step.
 */
export async function initCleanupReportDelivery(): Promise<void> {
  await pool.query(`
    ALTER TABLE cleanup_report_sends
      ADD COLUMN IF NOT EXISTS message_id text;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cleanup_report_send_recipients (
      id serial PRIMARY KEY,
      send_id integer NOT NULL
        REFERENCES cleanup_report_sends(id) ON DELETE CASCADE,
      email text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      reason text,
      delivered_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cleanup_report_send_recipients_send_email_idx
      ON cleanup_report_send_recipients (send_id, email);
  `);
  // Task #222: dedup stamp for the "bounce detected" admin notification.
  await pool.query(`
    ALTER TABLE cleanup_report_send_recipients
      ADD COLUMN IF NOT EXISTS bounce_notified_at timestamp;
  `);
  // Task #232: append-only history of auto-expired suppressions so
  // admins can audit which addresses the daily sweep recently lifted.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cleanup_report_suppression_expiries (
      id serial PRIMARY KEY,
      email text NOT NULL,
      suppressed_at timestamp,
      last_reason text,
      bounce_count integer NOT NULL DEFAULT 0,
      expired_at timestamp NOT NULL DEFAULT now(),
      max_age_days integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cleanup_report_suppression_expiries_expired_at_idx
      ON cleanup_report_suppression_expiries (expired_at DESC);
  `);
  logger.info("cleanup_report_send_recipients initialized");
}
