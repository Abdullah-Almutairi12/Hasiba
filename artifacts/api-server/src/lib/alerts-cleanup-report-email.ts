/**
 * Task #178: scheduled email of the alerts-cleanup PDF report.
 *
 * Auditors used to have to remember to log into the Admin Panel and
 * download the PDF themselves. This worker mails the same PDF (built
 * by `buildAlertsCleanupPdf`) to a configurable list of recipients on
 * a configurable schedule (weekly / monthly).
 *
 * Config lives in `app_settings.system.cleanupReport`:
 *   {
 *     schedule: "off" | "weekly" | "monthly",
 *     recipients: string[],        // raw email addresses
 *     lastSentAt: string | null,   // ISO timestamp of last successful send
 *   }
 *
 * Schedule semantics:
 *   - weekly  → send if (lastSentAt is null) OR (now - lastSentAt >= 7d)
 *   - monthly → send if (lastSentAt is null) OR (now - lastSentAt >= 30d)
 * The PDF window mirrors that cadence — weekly mails the last 7 days,
 * monthly mails the last 30 days.
 *
 * The cron itself ticks once an hour (first run ~3 min after boot) so
 * a freshly configured schedule kicks in promptly without spawning a
 * dedicated calendar scheduler. Sending is skipped silently if SMTP
 * isn't configured or the recipients list is empty.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";
import { sendMail, isMailerConfigured } from "./mailer";
import { buildAlertsCleanupPdf } from "./alerts-cleanup-pdf";

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 180_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const CLEANUP_REPORT_SCHEDULES = ["off", "weekly", "monthly"] as const;
export type CleanupReportSchedule = (typeof CLEANUP_REPORT_SCHEDULES)[number];

export interface CleanupReportConfig {
  schedule: CleanupReportSchedule;
  recipients: string[];
  lastSentAt: string | null;
}

export function defaultCleanupReportConfig(): CleanupReportConfig {
  return { schedule: "off", recipients: [], lastSentAt: null };
}

export function readCleanupReportConfig(
  systemBag: unknown,
): CleanupReportConfig {
  const out = defaultCleanupReportConfig();
  if (!systemBag || typeof systemBag !== "object") return out;
  const raw = (systemBag as Record<string, unknown>)["cleanupReport"];
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.schedule === "string" &&
    (CLEANUP_REPORT_SCHEDULES as readonly string[]).includes(o.schedule)
  ) {
    out.schedule = o.schedule as CleanupReportSchedule;
  }
  if (Array.isArray(o.recipients)) {
    out.recipients = o.recipients
      .filter((r): r is string => typeof r === "string")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
  }
  if (typeof o.lastSentAt === "string") {
    out.lastSentAt = o.lastSentAt;
  }
  return out;
}

async function loadConfig(): Promise<CleanupReportConfig> {
  try {
    const result = await pool.query<{ system: unknown }>(
      `SELECT system FROM app_settings WHERE id = 1`,
    );
    return readCleanupReportConfig(result.rows[0]?.system);
  } catch (err) {
    logger.warn({ err }, "cleanup report: failed to load config");
    return defaultCleanupReportConfig();
  }
}

async function persistLastSentAt(at: Date): Promise<void> {
  try {
    await pool.query(
      `
      INSERT INTO app_settings (id, system, updated_at)
      VALUES (
        1,
        jsonb_build_object(
          'cleanupReport',
          jsonb_build_object('lastSentAt', to_jsonb($1::text))
        ),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
        SET system = COALESCE(app_settings.system, '{}'::jsonb)
                     || jsonb_build_object(
                          'cleanupReport',
                          COALESCE(app_settings.system->'cleanupReport', '{}'::jsonb)
                            || jsonb_build_object('lastSentAt', to_jsonb($1::text))
                        ),
            updated_at = NOW()
      `,
      [at.toISOString()],
    );
  } catch (err) {
    logger.warn({ err }, "cleanup report: failed to persist lastSentAt");
  }
}

function windowDaysForSchedule(schedule: CleanupReportSchedule): number {
  return schedule === "monthly" ? 30 : 7;
}

export interface CleanupReportSendResult {
  sent: boolean;
  reason?: string;
  recipients?: string[];
  rowCount?: number;
}

/**
 * Build the PDF for the last N days (per schedule) and email it to
 * every configured recipient. On success, updates `lastSentAt`.
 *
 * `force=true` bypasses the schedule cadence check (used by the manual
 * "send now" admin endpoint).
 */
export async function sendCleanupReportEmail(opts: {
  force?: boolean;
} = {}): Promise<CleanupReportSendResult> {
  const cfg = await loadConfig();
  if (!opts.force && cfg.schedule === "off") {
    return { sent: false, reason: "schedule_off" };
  }
  if (cfg.recipients.length === 0) {
    return { sent: false, reason: "no_recipients" };
  }
  if (!isMailerConfigured()) {
    return { sent: false, reason: "mailer_not_configured" };
  }

  // For force-mode without an active schedule, default to a weekly window.
  const effectiveSchedule: CleanupReportSchedule =
    cfg.schedule === "off" ? "weekly" : cfg.schedule;
  const days = windowDaysForSchedule(effectiveSchedule);
  const to = new Date();
  const from = new Date(to.getTime() - days * ONE_DAY_MS);

  const { buffer, filename, rowCount } = await buildAlertsCleanupPdf({
    from,
    to,
  });

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const periodLabel = effectiveSchedule === "monthly" ? "الشهري" : "الأسبوعي";
  const subject = `تقرير تنظيف التنبيهات ${periodLabel} (${fmt(from)} → ${fmt(to)})`;
  const body =
    `مرفق تقرير تنظيف التنبيهات ${periodLabel}.\n\n` +
    `النطاق: ${fmt(from)} إلى ${fmt(to)}\n` +
    `عدد عمليات التنظيف في هذا النطاق: ${rowCount}\n\n` +
    `تم إنشاء هذا التقرير تلقائياً من نظام حاسبة.AI.\n`;

  const result = await sendMail({
    to: cfg.recipients.join(", "),
    subject,
    body,
    attachments: [
      { filename, content: buffer, contentType: "application/pdf" },
    ],
  });

  if (!result.sent) {
    logger.error(
      { reason: result.reason, recipients: cfg.recipients.length },
      "cleanup report: email send failed",
    );
    return { sent: false, reason: result.reason };
  }
  await persistLastSentAt(to);
  logger.info(
    {
      recipients: cfg.recipients.length,
      rowCount,
      schedule: effectiveSchedule,
    },
    "cleanup report: emailed",
  );
  return { sent: true, recipients: cfg.recipients, rowCount };
}

/**
 * Per-tick decision: should we send right now given the configured
 * cadence and the timestamp of the last successful send? Pure for
 * easier testing.
 */
export function isDue(cfg: CleanupReportConfig, now: Date): boolean {
  if (cfg.schedule === "off") return false;
  if (cfg.recipients.length === 0) return false;
  if (!cfg.lastSentAt) return true;
  const last = new Date(cfg.lastSentAt).getTime();
  if (!Number.isFinite(last)) return true;
  const intervalMs = windowDaysForSchedule(cfg.schedule) * ONE_DAY_MS;
  return now.getTime() - last >= intervalMs;
}

async function tick(): Promise<void> {
  try {
    const cfg = await loadConfig();
    if (!isDue(cfg, new Date())) return;
    if (!isMailerConfigured()) return;
    await sendCleanupReportEmail();
  } catch (err) {
    logger.error({ err }, "cleanup report: tick failed");
  }
}

let started = false;
export function startCleanupReportEmailCron(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), ONE_HOUR_MS).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}
