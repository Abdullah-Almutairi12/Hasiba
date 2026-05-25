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
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 3650;

export interface AlertsSweepSummary {
  deleted: number;
  retentionDays: number;
  source: "db" | "env" | "default";
}

function clampRetention(n: number): number | null {
  if (!Number.isFinite(n) || n < MIN_RETENTION_DAYS || n > MAX_RETENTION_DAYS) {
    return null;
  }
  return Math.floor(n);
}

function getEnvRetentionDays(): number | null {
  const raw = process.env.ALERTS_RETENTION_DAYS;
  if (!raw) return null;
  return clampRetention(Number.parseInt(raw, 10));
}

/**
 * Resolve the retention window with the precedence required by task #161:
 *   1. `app_settings.system.alertRetentionDays` (admin-tunable from /admin)
 *   2. `ALERTS_RETENTION_DAYS` environment variable
 *   3. Hardcoded default (90 days)
 *
 * Reads are best-effort — a DB blip falls back to env/default so the sweep
 * still runs.
 */
export async function resolveRetention(): Promise<{
  retentionDays: number;
  source: "db" | "env" | "default";
}> {
  try {
    const result = await pool.query<{ value: number | null }>(
      `SELECT (system->>'alertRetentionDays')::int AS value
         FROM app_settings
        WHERE id = 1`,
    );
    const raw = result.rows[0]?.value;
    if (raw != null) {
      const v = clampRetention(Number(raw));
      if (v != null) return { retentionDays: v, source: "db" };
    }
  } catch (err) {
    logger.warn({ err }, "alerts cleanup: failed to read DB retention setting");
  }
  const env = getEnvRetentionDays();
  if (env != null) return { retentionDays: env, source: "env" };
  return { retentionDays: DEFAULT_RETENTION_DAYS, source: "default" };
}

/**
 * Delete read alerts older than the configured retention window.
 * Safe to run repeatedly — once swept, the WHERE clause is a no-op
 * until more rows age past the threshold.
 */
export async function runAlertsCleanup(): Promise<AlertsSweepSummary> {
  const { retentionDays, source } = await resolveRetention();
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
        { deleted, retentionDays, source },
        "alerts cleanup: archived read alerts past retention",
      );
    }
    return { deleted, retentionDays, source };
  } catch (err) {
    logger.error({ err }, "alerts cleanup failed");
    return { deleted: 0, retentionDays, source };
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
