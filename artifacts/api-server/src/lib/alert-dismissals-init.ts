import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Task #156 boot init: bring the `alert_dismissals` table in line with
 * the schema addition that introduced `alert_id` + a cascading FK to
 * `alerts(id)`. Mirrors the `initIntercompany()` pattern — pure
 * idempotent DDL + a one-shot backfill / orphan sweep so an already
 * running deployment self-heals without a manual `drizzle-kit push`.
 *
 * The cascade ensures that going forward, deleting an alert
 * automatically removes any user dismissals that pointed at it. The
 * sibling nightly cron (`alert-dismissals-cleanup-cron.ts`) handles
 * the residual case of legacy rows that have only `alert_key` (no
 * `alert_id`).
 */
export async function initAlertDismissals(): Promise<void> {
  // Create the table if drizzle-kit push hasn't yet been run against
  // this environment. The schema below mirrors `alertDismissalsTable`
  // in `lib/db/src/schema/alerts.ts` exactly; once present, the
  // subsequent ALTER / FK / index statements are no-ops.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alert_dismissals (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      alert_key text NOT NULL,
      dismissed_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS alert_dismissals_user_company_key_uq
      ON alert_dismissals (user_id, company_id, alert_key);
  `);
  await pool.query(`
    ALTER TABLE alert_dismissals
      ADD COLUMN IF NOT EXISTS alert_id integer;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'alert_dismissals'
          AND constraint_name = 'alert_dismissals_alert_id_alerts_id_fk'
      ) THEN
        ALTER TABLE alert_dismissals
          ADD CONSTRAINT alert_dismissals_alert_id_alerts_id_fk
          FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS alert_dismissals_alert_id_idx
      ON alert_dismissals (alert_id);
  `);
  // Backfill legacy rows whose alert is still present.
  await pool.query(`
    UPDATE alert_dismissals d
       SET alert_id = a.id
      FROM alerts a
     WHERE d.alert_id IS NULL
       AND d.alert_key ~ '^alert:[0-9]+$'
       AND a.id = (substring(d.alert_key from 7))::int;
  `);
  logger.info("alert_dismissals cascade FK initialized");
}
