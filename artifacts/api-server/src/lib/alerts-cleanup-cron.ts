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
 *
 * Task #162: every run also appends a row to `alerts_cleanup_runs`
 * so the Admin Panel can show managers the last sweep summary
 * (timestamp + rows deleted + retention window).
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 150_000;
const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 3650;
// Task #164: keep ~1 year of nightly audit rows in alerts_cleanup_runs.
// Task #171: the cap is admin-tunable via
// `app_settings.system.cleanupAuditKeepRuns` (clamped to MIN/MAX).
const DEFAULT_AUDIT_KEEP = 365;
const MIN_AUDIT_KEEP = 30;
const MAX_AUDIT_KEEP = 3650;

export interface AlertsSweepSummary {
  deleted: number;
  retentionDays: number;
  source: "db" | "env" | "default";
  runAt: string;
}

/**
 * Persist the last-run summary into `app_settings.system.lastAlertSweep`
 * (singleton row id=1) so the /admin UI can show what the nightly sweep
 * actually did. Best-effort — failures are logged and swallowed so the
 * cron itself doesn't regress.
 */
async function persistLastSweep(summary: AlertsSweepSummary): Promise<void> {
  try {
    await pool.query(
      `
      INSERT INTO app_settings (id, system, updated_at)
      VALUES (
        1,
        jsonb_build_object('lastAlertSweep', $1::jsonb),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
        SET system = COALESCE(app_settings.system, '{}'::jsonb)
                     || jsonb_build_object('lastAlertSweep', $1::jsonb),
            updated_at = NOW()
      `,
      [JSON.stringify(summary)],
    );
  } catch (err) {
    logger.warn({ err }, "alerts cleanup: failed to persist last-run summary");
  }
}

function clampRetention(n: number): number | null {
  if (!Number.isFinite(n) || n < MIN_RETENTION_DAYS || n > MAX_RETENTION_DAYS) {
    return null;
  }
  return Math.floor(n);
}

function clampAuditKeep(n: number): number | null {
  if (!Number.isFinite(n) || n < MIN_AUDIT_KEEP || n > MAX_AUDIT_KEEP) {
    return null;
  }
  return Math.floor(n);
}

/**
 * Resolve the cleanup-runs audit cap from
 * `app_settings.system.cleanupAuditKeepRuns`, falling back to the
 * hardcoded default if the row/value is missing or out-of-range.
 * Best-effort: any DB error reverts to default so the sweep still runs.
 */
export async function resolveAuditKeepRuns(): Promise<number> {
  try {
    const result = await pool.query<{ value: number | null }>(
      `SELECT (system->>'cleanupAuditKeepRuns')::int AS value
         FROM app_settings
        WHERE id = 1`,
    );
    const raw = result.rows[0]?.value;
    if (raw != null) {
      const v = clampAuditKeep(Number(raw));
      if (v != null) return v;
    }
  } catch (err) {
    logger.warn(
      { err },
      "alerts cleanup: failed to read DB audit-keep setting",
    );
  }
  return DEFAULT_AUDIT_KEEP;
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
  let deleted = 0;
  try {
    const result = await pool.query(
      `
      DELETE FROM alerts
       WHERE is_read = true
         AND created_at < NOW() - ($1::int * INTERVAL '1 day')
      `,
      [retentionDays],
    );
    deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      logger.info(
        { deleted, retentionDays, source },
        "alerts cleanup: archived read alerts past retention",
      );
    }
    try {
      await pool.query(
        `
        INSERT INTO alerts_cleanup_runs (rows_deleted, retention_days)
        VALUES ($1::int, $2::int)
        `,
        [deleted, retentionDays],
      );
    } catch (err) {
      logger.error(
        { err },
        "alerts cleanup: failed to record run in alerts_cleanup_runs",
      );
    }
    // Task #164: cap the audit table itself so it doesn't grow forever.
    // Task #171: cap is admin-tunable via
    // `app_settings.system.cleanupAuditKeepRuns` (default 365 ~1y).
    try {
      const auditKeep = await resolveAuditKeepRuns();
      await pool.query(
        `
        DELETE FROM alerts_cleanup_runs
         WHERE id IN (
           SELECT id FROM alerts_cleanup_runs
           ORDER BY ran_at DESC
           OFFSET $1::int
         )
        `,
        [auditKeep],
      );
    } catch (err) {
      logger.warn(
        { err },
        "alerts cleanup: failed to trim alerts_cleanup_runs audit history",
      );
    }
  } catch (err) {
    logger.error({ err }, "alerts cleanup failed");
  }
  const summary: AlertsSweepSummary = {
    deleted,
    retentionDays,
    source,
    runAt: new Date().toISOString(),
  };
  await persistLastSweep(summary);
  return summary;
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
