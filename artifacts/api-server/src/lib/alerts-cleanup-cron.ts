/**
 * Task #158: nightly retention sweep for the `alerts` table.
 *
 * Background workers (invoice-email-retry, PO-email-retry, KPI eval,
 * fraud detection, stale-scan, intercompany imbalance) keep appending
 * rows to `alerts` and nothing ever deletes them. Over time the
 * dashboard alerts query slows down and the table grows unbounded.
 *
 * This cron deletes alerts that are:
 *   * `is_read = true`
 *   * older than `ALERTS_RETENTION_DAYS` (default 90, configurable via env)
 *
 * It applies to both per-tenant alerts and cross-tenant operational
 * alerts (`company_id IS NULL`) — same rule for both. Thanks to the
 * cascading FK added in task #156 (`alert_dismissals.alert_id ON
 * DELETE CASCADE`), deleting an old alert also auto-cleans its
 * dismissals.
 *
 * Schedule mirrors the other nightly crons: first run ~150s after
 * boot, then every 24h. The interval is `.unref()`-ed.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 150_000;
const DEFAULT_RETENTION_DAYS = 90;

export interface AlertsSweepSummary {
  deleted: number;
  retentionDays: number;
}

function getRetentionDays(): number {
  const raw = process.env.ALERTS_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETENTION_DAYS;
  return parsed;
}

/**
 * Delete read alerts older than the configured retention window.
 * Safe to run repeatedly — once swept, the WHERE clause is a no-op
 * until more rows age past the threshold.
 */
export async function runAlertsCleanup(): Promise<AlertsSweepSummary> {
  const retentionDays = getRetentionDays();
  try {
    const result = await pool.query(
      `
      DELETE FROM alerts
       WHERE is_read = true
         AND created_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      [retentionDays],
    );
    const deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      logger.info(
        { deleted, retentionDays },
        "alerts cleanup: archived read alerts past retention",
      );
    }
    return { deleted, retentionDays };
  } catch (err) {
    logger.error({ err }, "alerts cleanup failed");
    return { deleted: 0, retentionDays };
  }
}

let started = false;
export function startAlertsCleanupCron(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    void runAlertsCleanup();
    setInterval(() => void runAlertsCleanup(), ONE_DAY_MS).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}
