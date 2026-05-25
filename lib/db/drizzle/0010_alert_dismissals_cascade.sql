-- Task #156: auto-clean dismissals for alerts that no longer exist.
--
-- Adds a real FK column (`alert_id`) on `alert_dismissals` that points
-- to `alerts(id) ON DELETE CASCADE`. Going forward, every dismissal
-- created for a key of the form `alert:<id>` stamps this column, so
-- deleting the alert row removes the dismissal automatically — no
-- orphans, no unbounded growth.
--
-- The column is NULLABLE on purpose:
--   * synthetic banners (e.g. `synthetic:stale_scan`) have no alert row
--   * legacy dismissals written before this migration kept only the
--     `alert_key` text; the backfill below repairs them where the
--     alert still exists, and the nightly sweep cron mops up any
--     stragglers whose alert is already gone.
--
-- Statements are idempotent: re-applying on a database that already
-- has the column / FK / backfill is a no-op.

ALTER TABLE "alert_dismissals"
  ADD COLUMN IF NOT EXISTS "alert_id" integer;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'alert_dismissals'
      AND constraint_name = 'alert_dismissals_alert_id_alerts_id_fk'
  ) THEN
    ALTER TABLE "alert_dismissals"
      ADD CONSTRAINT "alert_dismissals_alert_id_alerts_id_fk"
      FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "alert_dismissals_alert_id_idx"
  ON "alert_dismissals" ("alert_id");
--> statement-breakpoint

-- Backfill alert_id for legacy `alert:<id>` rows whose alert still
-- exists. Rows whose alert is already gone are left untouched here
-- and removed by the one-shot cleanup below.
UPDATE "alert_dismissals" d
   SET "alert_id" = a."id"
  FROM "alerts" a
 WHERE d."alert_id" IS NULL
   AND d."alert_key" ~ '^alert:[0-9]+$'
   AND a."id" = (substring(d."alert_key" from 7))::int;
--> statement-breakpoint

-- One-shot sweep of orphans that pre-date this migration: dismissal
-- rows whose `alert:<id>` target is gone from `alerts`.
DELETE FROM "alert_dismissals" d
 WHERE d."alert_id" IS NULL
   AND d."alert_key" ~ '^alert:[0-9]+$'
   AND NOT EXISTS (
     SELECT 1 FROM "alerts" a
      WHERE a."id" = (substring(d."alert_key" from 7))::int
   );
