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
 *     subject: string | null,      // optional override for the email subject
 *     intro: string | null,        // optional override for the body intro
 *   }
 *
 * `subject` may contain the tokens `{period}`, `{from}`, `{to}` which are
 * substituted at send time. `intro` is prepended to the default body (the
 * scope / row-count / footer lines stay as-is so auditors always see the
 * machine-readable summary).
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

import { pool, db, cleanupReportSendsTable } from "@workspace/db";
import { logger } from "./logger";
import { sendMail, isMailerConfigured } from "./mailer";
import { buildAlertsCleanupPdf } from "./alerts-cleanup-pdf";
import { loadComplianceReportSummary } from "./compliance/report-section";

export type CleanupReportTrigger = "cron" | "manual" | "test";

async function recordSendAttempt(row: {
  trigger: CleanupReportTrigger;
  triggeredByUserId: number | null;
  triggeredByUserName: string | null;
  recipients: string[];
  rowCount: number | null;
  status: "success" | "failure";
  failureReason: string | null;
}): Promise<void> {
  try {
    await db.insert(cleanupReportSendsTable).values({
      trigger: row.trigger,
      triggeredByUserId: row.triggeredByUserId,
      triggeredByUserName: row.triggeredByUserName,
      recipientCount: row.recipients.length,
      recipients: row.recipients.join(", "),
      rowCount: row.rowCount,
      status: row.status,
      failureReason: row.failureReason,
    });
  } catch (err) {
    logger.warn({ err }, "cleanup report: failed to record send attempt");
  }
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 180_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const CLEANUP_REPORT_SCHEDULES = ["off", "weekly", "monthly"] as const;
export type CleanupReportSchedule = (typeof CLEANUP_REPORT_SCHEDULES)[number];

export const CLEANUP_REPORT_SUBJECT_MAX = 200;
export const CLEANUP_REPORT_INTRO_MAX = 2000;

export interface CleanupReportConfig {
  schedule: CleanupReportSchedule;
  recipients: string[];
  lastSentAt: string | null;
  subject: string | null;
  intro: string | null;
}

export function defaultCleanupReportConfig(): CleanupReportConfig {
  return {
    schedule: "off",
    recipients: [],
    lastSentAt: null,
    subject: null,
    intro: null,
  };
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
  if (typeof o.subject === "string") {
    const s = o.subject.trim();
    out.subject = s.length > 0 ? s.slice(0, CLEANUP_REPORT_SUBJECT_MAX) : null;
  }
  if (typeof o.intro === "string") {
    const s = o.intro.trim();
    out.intro = s.length > 0 ? s.slice(0, CLEANUP_REPORT_INTRO_MAX) : null;
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

export function windowDaysForSchedule(schedule: CleanupReportSchedule): number {
  return schedule === "monthly" ? 30 : 7;
}

/**
 * Pure helper: render the resolved subject + body for the cleanup
 * report email. Extracted so the admin "preview" endpoint can produce
 * exactly the same text the cron will eventually send. No I/O —
 * counts/rowCount must be supplied by the caller.
 */
export interface RenderCleanupReportEmailInput {
  subject: string | null;
  intro: string | null;
  schedule: CleanupReportSchedule;
  from: Date;
  to: Date;
  rowCount: number;
  complianceCounts: {
    transferPricing: number;
    agreementMissing: number;
    zakat: number;
  };
}

export interface RenderedCleanupReportEmail {
  subject: string;
  body: string;
  periodLabel: string;
  from: string;
  to: string;
  complianceAlertCount: number;
}

export function renderCleanupReportEmail(
  input: RenderCleanupReportEmailInput,
): RenderedCleanupReportEmail {
  const effectiveSchedule: CleanupReportSchedule =
    input.schedule === "off" ? "weekly" : input.schedule;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const fromStr = fmt(input.from);
  const toStr = fmt(input.to);
  const periodLabel = effectiveSchedule === "monthly" ? "الشهري" : "الأسبوعي";
  const defaultSubject = `تقرير تنظيف التنبيهات ${periodLabel} (${fromStr} → ${toStr})`;
  const subject = input.subject
    ? input.subject
        .replaceAll("{period}", periodLabel)
        .replaceAll("{from}", fromStr)
        .replaceAll("{to}", toStr)
    : defaultSubject;
  const introLine =
    input.intro ?? `مرفق تقرير تنظيف التنبيهات ${periodLabel}.`;
  const complianceAlertCount =
    input.complianceCounts.transferPricing +
    input.complianceCounts.agreementMissing +
    input.complianceCounts.zakat;
  const body =
    `${introLine}\n\n` +
    `النطاق: ${fromStr} إلى ${toStr}\n` +
    `عدد عمليات التنظيف في هذا النطاق: ${input.rowCount}\n` +
    `تنبيهات الامتثال (تسعير تحويلي / زكاة / اتفاقيات): ${complianceAlertCount}\n` +
    `   • تسعير تحويلي: ${input.complianceCounts.transferPricing}\n` +
    `   • اتفاقيات مفقودة: ${input.complianceCounts.agreementMissing}\n` +
    `   • زكاة: ${input.complianceCounts.zakat}\n\n` +
    `تم إنشاء هذا التقرير تلقائياً من نظام حاسبة.AI.\n`;
  return {
    subject,
    body,
    periodLabel,
    from: fromStr,
    to: toStr,
    complianceAlertCount,
  };
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
  recipientsOverride?: string[];
  triggeredByUserId?: number | null;
  triggeredByUserName?: string | null;
} = {}): Promise<CleanupReportSendResult> {
  const cfg = await loadConfig();
  const isTest = Array.isArray(opts.recipientsOverride);
  const trigger: CleanupReportTrigger = isTest
    ? "test"
    : opts.force
      ? "manual"
      : "cron";
  const triggeredByUserId = opts.triggeredByUserId ?? null;
  const triggeredByUserName = opts.triggeredByUserName ?? null;
  if (!opts.force && !isTest && cfg.schedule === "off") {
    return { sent: false, reason: "schedule_off" };
  }
  const recipients = isTest
    ? opts.recipientsOverride!.map((r) => r.trim()).filter((r) => r.length > 0)
    : cfg.recipients;
  if (recipients.length === 0) {
    await recordSendAttempt({
      trigger,
      triggeredByUserId,
      triggeredByUserName,
      recipients: [],
      rowCount: null,
      status: "failure",
      failureReason: "no_recipients",
    });
    return { sent: false, reason: "no_recipients" };
  }
  if (!isMailerConfigured()) {
    await recordSendAttempt({
      trigger,
      triggeredByUserId,
      triggeredByUserName,
      recipients,
      rowCount: null,
      status: "failure",
      failureReason: "mailer_not_configured",
    });
    return { sent: false, reason: "mailer_not_configured" };
  }

  // For force-mode without an active schedule, default to a weekly window.
  const effectiveSchedule: CleanupReportSchedule =
    cfg.schedule === "off" ? "weekly" : cfg.schedule;
  const days = windowDaysForSchedule(effectiveSchedule);
  const to = new Date();
  const from = new Date(to.getTime() - days * ONE_DAY_MS);

  const compliance = await loadComplianceReportSummary({ from, to });
  const { buffer, filename, rowCount } = await buildAlertsCleanupPdf(
    { from, to },
    { compliance },
  );

  const { subject, body } = renderCleanupReportEmail({
    subject: cfg.subject,
    intro: cfg.intro,
    schedule: effectiveSchedule,
    from,
    to,
    rowCount,
    complianceCounts: compliance.counts,
  });

  const result = await sendMail({
    to: recipients.join(", "),
    subject: isTest ? `[اختبار] ${subject}` : subject,
    body,
    attachments: [
      { filename, content: buffer, contentType: "application/pdf" },
    ],
  });

  if (!result.sent) {
    logger.error(
      { reason: result.reason, recipients: recipients.length, isTest },
      "cleanup report: email send failed",
    );
    await recordSendAttempt({
      trigger,
      triggeredByUserId,
      triggeredByUserName,
      recipients,
      rowCount,
      status: "failure",
      failureReason: result.reason ?? "send_failed",
    });
    return { sent: false, reason: result.reason };
  }
  // Test sends don't bump `lastSentAt` — the schedule cron must still
  // fire on its normal cadence.
  if (!isTest) {
    await persistLastSentAt(to);
  }
  await recordSendAttempt({
    trigger,
    triggeredByUserId,
    triggeredByUserName,
    recipients,
    rowCount,
    status: "success",
    failureReason: null,
  });
  logger.info(
    {
      recipients: recipients.length,
      rowCount,
      schedule: effectiveSchedule,
      isTest,
    },
    "cleanup report: emailed",
  );
  return { sent: true, recipients, rowCount };
}

/**
 * Task #189: send a one-off test email of the cleanup report to a
 * single caller-supplied recipient. Mirrors `sendCleanupReportEmail`
 * exactly (same PDF, same `renderCleanupReportEmail` path, same
 * attachments) so what the admin sees in their own inbox is byte-for-
 * byte what the next scheduled tick will send to the audit list.
 *
 * Differences vs the scheduled / "send now" path:
 *   - Recipient list is the single address passed in (NOT the
 *     configured `recipients` array).
 *   - Subject is prefixed with `[TEST]` so an admin staring at their
 *     inbox can immediately tell the real audit run apart from a
 *     verification ping.
 *   - Does NOT touch `lastSentAt`, so triggering a test never delays
 *     the next scheduled real send.
 *   - Bypasses the schedule cadence and the `recipients.length === 0`
 *     precondition — the whole point is to validate SMTP / formatting
 *     before going live.
 */
export async function sendCleanupReportTestEmail(opts: {
  recipient: string;
}): Promise<CleanupReportSendResult> {
  const recipient = opts.recipient.trim();
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { sent: false, reason: "invalid_recipient" };
  }
  if (!isMailerConfigured()) {
    return { sent: false, reason: "mailer_not_configured" };
  }
  const cfg = await loadConfig();
  const effectiveSchedule: CleanupReportSchedule =
    cfg.schedule === "off" ? "weekly" : cfg.schedule;
  const days = windowDaysForSchedule(effectiveSchedule);
  const to = new Date();
  const from = new Date(to.getTime() - days * ONE_DAY_MS);

  const compliance = await loadComplianceReportSummary({ from, to });
  const { buffer, filename, rowCount } = await buildAlertsCleanupPdf(
    { from, to },
    { compliance },
  );

  const rendered = renderCleanupReportEmail({
    subject: cfg.subject,
    intro: cfg.intro,
    schedule: effectiveSchedule,
    from,
    to,
    rowCount,
    complianceCounts: compliance.counts,
  });

  const result = await sendMail({
    to: recipient,
    subject: `[TEST] ${rendered.subject}`,
    body: rendered.body,
    attachments: [
      { filename, content: buffer, contentType: "application/pdf" },
    ],
  });

  if (!result.sent) {
    logger.error(
      { reason: result.reason, recipient },
      "cleanup report: test email send failed",
    );
    return { sent: false, reason: result.reason };
  }
  logger.info(
    { recipient, rowCount, schedule: effectiveSchedule },
    "cleanup report: test emailed",
  );
  return { sent: true, recipients: [recipient], rowCount };
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
