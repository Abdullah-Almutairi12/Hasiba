-- Task #204: per-recipient delivery status tracking for cleanup-report
-- emails. Adds `message_id` on `cleanup_report_sends` (so we can match
-- async provider webhooks back to a send) and a new
-- `cleanup_report_send_recipients` child table that holds one row per
-- (send, email) with status delivered | bounced | pending | deferred.
--
-- All statements are idempotent so re-applying on a database already
-- patched via `drizzle-kit push` (or the boot-time
-- `initCleanupReportDelivery()` self-heal) is a no-op.

ALTER TABLE "cleanup_report_sends"
  ADD COLUMN IF NOT EXISTS "message_id" text;

CREATE TABLE IF NOT EXISTS "cleanup_report_send_recipients" (
  "id" serial PRIMARY KEY,
  "send_id" integer NOT NULL
    REFERENCES "cleanup_report_sends"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "reason" text,
  "delivered_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "cleanup_report_send_recipients_send_email_idx"
  ON "cleanup_report_send_recipients" ("send_id", "email");
