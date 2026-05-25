import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Task #162 — idempotent boot init for the alerts-cleanup audit log.
 * The nightly cron (task #158) appends one row per run so the Admin
 * Panel can show managers when the sweep last ran, how many rows it
 * deleted and what retention window was in effect.
 */
export async function initAlertsCleanupRuns(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts_cleanup_runs (
      id serial PRIMARY KEY,
      ran_at timestamp NOT NULL DEFAULT now(),
      rows_deleted integer NOT NULL DEFAULT 0,
      retention_days integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS alerts_cleanup_runs_ran_at_idx
      ON alerts_cleanup_runs (ran_at DESC);
  `);
  logger.info("alerts_cleanup_runs initialized");
}
