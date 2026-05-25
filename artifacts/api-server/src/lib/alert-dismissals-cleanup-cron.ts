/**
 * Task #156: nightly sweep that removes orphaned rows from
 * `alert_dismissals`.
 *
 * Most cleanup is now handled by the cascading FK added in
 * `initAlertDismissals()` — when an alert row is deleted, every
 * dismissal that pointed at it via `alert_id` goes with it. This
 * cron exists for the stragglers the FK can't catch:
 *
 *   * Legacy rows written before the `alert_id` column existed:
 *     `alert_id IS NULL` but the key still parses as `alert:<id>`.
 *     If that alert is gone, the dismissal is dead weight.
 *
 *   * Any future write path that forgets to populate `alert_id` for
 *     an `alert:*` key.
 *
 * Synthetic keys (e.g. `synthetic:stale_scan`) are intentionally
 * left alone — they have no `alerts` row to test against.
 *
 * Schedule mirrors the other nightly crons: first run ~120s after
 * boot, then every 24h. The interval is `.unref()`-ed.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 120_000;

export interface DismissalSweepSummary {
  deleted: number;
}

/**
 * Delete dismissal rows whose `alert:<id>` target no longer exists
 * in `alerts`. Safe to run repeatedly — the WHERE clause becomes a
 * no-op once the orphans are gone.
 */
export async function runAlertDismissalsCleanup(): Promise<DismissalSweepSummary> {
  try {
    const result = await pool.query(`
      DELETE FROM alert_dismissals d
       WHERE d.alert_id IS NULL
         AND d.alert_key ~ '^alert:[0-9]+$'
         AND NOT EXISTS (
           SELECT 1 FROM alerts a
            WHERE a.id = (substring(d.alert_key from 7))::int
         )
    `);
    const deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      logger.info({ deleted }, "alert_dismissals cleanup: removed orphans");
    }
    return { deleted };
  } catch (err) {
    logger.error({ err }, "alert_dismissals cleanup failed");
    return { deleted: 0 };
  }
}

let started = false;
export function startAlertDismissalsCleanupCron(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    void runAlertDismissalsCleanup();
    setInterval(() => void runAlertDismissalsCleanup(), ONE_DAY_MS).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}
