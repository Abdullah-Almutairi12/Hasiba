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

import {
  pool,
  db,
  cleanupReportSendsTable,
  cleanupReportSendRecipientsTable,
} from "@workspace/db";
import { and, lt, eq, sql, desc } from "drizzle-orm";
import { logger } from "./logger";
import {
  sendMail,
  isMailerConfigured,
  recipientStatusesFromDispatch,
  type MailDispatchResult,
} from "./mailer";
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
  windowFrom: Date | null;
  windowTo: Date | null;
  messageId?: string | null;
  /**
   * Task #204 / #208 — full dispatch result from `sendMail`. Per-
   * recipient delivery rows are derived via the shared
   * `recipientStatusesFromDispatch` helper so cleanup-report,
   * sales-invoice and procurement-PO sends all agree on what
   * "delivered" / "bounced" / "pending" means.
   */
  dispatch?: MailDispatchResult | null;
}): Promise<void> {
  try {
    const [inserted] = await db
      .insert(cleanupReportSendsTable)
      .values({
        trigger: row.trigger,
        triggeredByUserId: row.triggeredByUserId,
        triggeredByUserName: row.triggeredByUserName,
        recipientCount: row.recipients.length,
        recipients: row.recipients.join(", "),
        rowCount: row.rowCount,
        status: row.status,
        failureReason: row.failureReason,
        windowFrom: row.windowFrom,
        windowTo: row.windowTo,
        messageId: row.messageId ?? null,
      })
      .returning({ id: cleanupReportSendsTable.id });
    if (!inserted || row.recipients.length === 0) return;
    // Build a synthetic failure dispatch when no real one is available
    // (e.g. mailer not configured / no recipients pre-check) so the
    // shared helper still produces the right "bounced" rows.
    const dispatch: MailDispatchResult =
      row.dispatch ??
      (row.status === "failure"
        ? { sent: false, reason: row.failureReason ?? "send_failed" }
        : {
            sent: true,
            provider: "smtp",
            messageId: row.messageId ?? "",
            accepted: [],
            rejected: [],
            pending: [],
          });
    const statuses = recipientStatusesFromDispatch(dispatch, row.recipients);
    const now = new Date();
    await db.insert(cleanupReportSendRecipientsTable).values(
      statuses.map((s) => ({
        sendId: inserted.id,
        email: s.email,
        status: s.status,
        reason: s.reason,
        deliveredAt: s.deliveredAt,
        updatedAt: now,
      })),
    );
    // Task #223 — re-evaluate suppression for every recipient whose
    // row we just wrote. Cheap (one tiny query per address) and the
    // helper is idempotent, so it's safe to run on success rows too
    // (they'll never trip the all-bounced check).
    const bouncedEmails = statuses
      .filter((s) => s.status === "bounced")
      .map((s) => s.email);
    if (bouncedEmails.length > 0) {
      await evaluateAndSuppressBouncedRecipients(bouncedEmails);
    }
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

/**
 * Task #223 — auto-suppression of persistently bouncing addresses.
 *
 * When an address has bounced this many times IN A ROW (no successful
 * delivery in between) across cleanup-report sends, we add it to the
 * suppression list stored on `app_settings.system.cleanupReport.suppressions`.
 * Subsequent scheduled / "send now" sends skip suppressed addresses so
 * we stop wasting deliverability budget and stop generating false-
 * failure noise in the history.
 *
 * Admins can lift the suppression manually from the UI (which calls
 * `unsuppressCleanupReportRecipient`).
 */
export const CLEANUP_REPORT_SUPPRESSION_THRESHOLD = Math.max(
  2,
  Number(process.env.CLEANUP_REPORT_SUPPRESSION_THRESHOLD ?? 3),
);

/**
 * Task #227 — auto-expire stale suppressions so addresses that have
 * since recovered (mailbox-full cleared, auto-responder ended, server
 * outage fixed) can start receiving the cleanup report again without
 * an admin having to manually lift the suppression.
 *
 * Configurable via `CLEANUP_REPORT_SUPPRESSION_MAX_AGE_DAYS`; defaults
 * to 30 days. A value of `0` disables auto-expiry entirely (admin
 * must lift every suppression by hand).
 */
export const CLEANUP_REPORT_SUPPRESSION_MAX_AGE_DAYS = Math.max(
  0,
  Math.trunc(
    Number(process.env.CLEANUP_REPORT_SUPPRESSION_MAX_AGE_DAYS ?? 30),
  ) || 0,
);

export interface CleanupReportSuppression {
  /** Normalised (lowercased, trimmed) email address. */
  email: string;
  /** ISO timestamp of when the address was auto-suppressed. */
  suppressedAt: string;
  /**
   * Number of consecutive bounces observed at the moment of
   * suppression. Always >= `CLEANUP_REPORT_SUPPRESSION_THRESHOLD`.
   */
  bounceCount: number;
  /**
   * Reason string from the most recent bounce row (e.g.
   * `smtp_rejected`, `no_delivery_confirmation_48h`). Null if the
   * provider didn't give us one.
   */
  lastReason: string | null;
}

export interface CleanupReportConfig {
  schedule: CleanupReportSchedule;
  recipients: string[];
  lastSentAt: string | null;
  subject: string | null;
  intro: string | null;
  /**
   * Task #222 — optional inbox that receives the "send started bouncing"
   * proactive notification (in addition to the in-app alert). Distinct
   * from `recipients` (those are the auditors who get the PDF). When
   * unset, only the in-app alert is dispatched.
   */
  adminNotificationEmail: string | null;
  /** Task #223 — addresses auto-quarantined for repeated hard bounces. */
  suppressions: CleanupReportSuppression[];
}

export function defaultCleanupReportConfig(): CleanupReportConfig {
  return {
    schedule: "off",
    recipients: [],
    lastSentAt: null,
    subject: null,
    intro: null,
    adminNotificationEmail: null,
    suppressions: [],
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
  if (typeof o.adminNotificationEmail === "string") {
    const s = o.adminNotificationEmail.trim();
    out.adminNotificationEmail =
      s.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
  }
  if (Array.isArray(o.suppressions)) {
    const seen = new Set<string>();
    for (const raw of o.suppressions) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const email =
        typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.suppressions.push({
        email,
        suppressedAt:
          typeof r.suppressedAt === "string"
            ? r.suppressedAt
            : new Date(0).toISOString(),
        bounceCount:
          typeof r.bounceCount === "number" && Number.isFinite(r.bounceCount)
            ? Math.max(0, Math.trunc(r.bounceCount))
            : 0,
        lastReason:
          typeof r.lastReason === "string" && r.lastReason.length > 0
            ? r.lastReason.slice(0, 200)
            : null,
      });
    }
  }
  return out;
}

export function isCleanupReportSuppressed(
  cfg: CleanupReportConfig,
  email: string,
): boolean {
  const e = email.trim().toLowerCase();
  return cfg.suppressions.some((s) => s.email === e);
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

/**
 * Task #223 — overwrite the suppressions array on
 * `app_settings.system.cleanupReport.suppressions` in place. The
 * jsonb merge mirrors `persistLastSentAt` so we never clobber the
 * sibling fields (schedule / recipients / lastSentAt / subject /
 * intro).
 */
async function persistSuppressions(
  suppressions: CleanupReportSuppression[],
): Promise<void> {
  try {
    const payload = JSON.stringify(suppressions);
    await pool.query(
      `
      INSERT INTO app_settings (id, system, updated_at)
      VALUES (
        1,
        jsonb_build_object(
          'cleanupReport',
          jsonb_build_object('suppressions', $1::jsonb)
        ),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
        SET system = COALESCE(app_settings.system, '{}'::jsonb)
                     || jsonb_build_object(
                          'cleanupReport',
                          COALESCE(app_settings.system->'cleanupReport', '{}'::jsonb)
                            || jsonb_build_object('suppressions', $1::jsonb)
                        ),
            updated_at = NOW()
      `,
      [payload],
    );
  } catch (err) {
    logger.warn({ err }, "cleanup report: failed to persist suppressions");
  }
}

/**
 * Task #223 — for each candidate email, inspect the most recent
 * `CLEANUP_REPORT_SUPPRESSION_THRESHOLD` per-recipient delivery rows
 * across all historical sends. If every one of them is `bounced` (i.e.
 * no successful delivery has interrupted the streak), add the address
 * to the suppression list.
 *
 * Returns the list of newly-suppressed addresses so callers can log /
 * audit them.
 *
 * Idempotent: addresses already in the suppression list are skipped.
 */
export async function evaluateAndSuppressBouncedRecipients(
  emails: string[],
): Promise<CleanupReportSuppression[]> {
  const candidates = Array.from(
    new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  );
  if (candidates.length === 0) return [];
  const cfg = await loadConfig();
  const already = new Set(cfg.suppressions.map((s) => s.email));
  const fresh = candidates.filter((e) => !already.has(e));
  if (fresh.length === 0) return [];
  const threshold = CLEANUP_REPORT_SUPPRESSION_THRESHOLD;
  const newSuppressions: CleanupReportSuppression[] = [];
  for (const email of fresh) {
    try {
      const rows = await db
        .select({
          status: cleanupReportSendRecipientsTable.status,
          reason: cleanupReportSendRecipientsTable.reason,
          updatedAt: cleanupReportSendRecipientsTable.updatedAt,
        })
        .from(cleanupReportSendRecipientsTable)
        .where(
          sql`lower(${cleanupReportSendRecipientsTable.email}) = ${email}`,
        )
        .orderBy(desc(cleanupReportSendRecipientsTable.updatedAt))
        .limit(threshold);
      if (rows.length < threshold) continue;
      if (!rows.every((r) => r.status === "bounced")) continue;
      newSuppressions.push({
        email,
        suppressedAt: new Date().toISOString(),
        bounceCount: rows.length,
        lastReason: rows[0]?.reason ?? null,
      });
    } catch (err) {
      logger.warn(
        { err, email },
        "cleanup report: failed to evaluate suppression for recipient",
      );
    }
  }
  if (newSuppressions.length === 0) return [];
  await persistSuppressions([...cfg.suppressions, ...newSuppressions]);
  logger.info(
    {
      count: newSuppressions.length,
      emails: newSuppressions.map((s) => s.email),
      threshold,
    },
    "cleanup report: auto-suppressed persistently bouncing recipients",
  );
  // Task #226 — proactively email admins the moment new addresses are
  // quarantined. One call → one digest email listing every fresh
  // suppression, so a multi-bounce batch (e.g. a single send that
  // tripped the threshold for several recipients at once) never fans
  // out into a recipient-per-email storm. Lazy import to avoid the
  // module cycle with `cleanup-report-bounce-notify.ts`, which itself
  // imports `readCleanupReportConfig` from this module.
  try {
    const { notifyAdminsOfCleanupReportSuppressions } = await import(
      "./cleanup-report-bounce-notify"
    );
    await notifyAdminsOfCleanupReportSuppressions(newSuppressions);
  } catch (err) {
    logger.warn(
      { err },
      "cleanup report: suppression admin-email dispatch failed",
    );
  }
  return newSuppressions;
}

/**
 * Task #223 — lift an auto-suppression manually (admin action). Returns
 * true if a row was removed, false if the address wasn't suppressed in
 * the first place. Always normalises the email before comparing.
 */
export async function unsuppressCleanupReportRecipient(
  email: string,
): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const cfg = await loadConfig();
  const next = cfg.suppressions.filter((s) => s.email !== e);
  if (next.length === cfg.suppressions.length) return false;
  await persistSuppressions(next);
  logger.info({ email: e }, "cleanup report: suppression manually lifted");
  return true;
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
  /**
   * Treat an override-recipients send as a real send (trigger="manual",
   * no `[اختبار]` subject prefix). Defaults to `true` (test) for
   * backwards compatibility with task #184. Set to `false` for the
   * task #196 "re-send from history" flow.
   */
  asTest?: boolean;
  /**
   * Task #196 — explicit historical from/to window. When provided,
   * the PDF is regenerated for EXACTLY this window instead of the
   * usual `now - N days` cadence window. Used by the "re-send a past
   * send" flow so the recipient receives the same period the
   * original email covered.
   */
  windowOverride?: { from: Date; to: Date };
  triggeredByUserId?: number | null;
  triggeredByUserName?: string | null;
} = {}): Promise<CleanupReportSendResult> {
  const cfg = await loadConfig();
  const hasOverride = Array.isArray(opts.recipientsOverride);
  const isTest = hasOverride && (opts.asTest ?? true);
  const trigger: CleanupReportTrigger = isTest
    ? "test"
    : opts.force || hasOverride
      ? "manual"
      : "cron";
  const triggeredByUserId = opts.triggeredByUserId ?? null;
  const triggeredByUserName = opts.triggeredByUserName ?? null;
  if (!opts.force && !hasOverride && cfg.schedule === "off") {
    return { sent: false, reason: "schedule_off" };
  }
  // Task #223 — for scheduled / "send now" runs that use the saved
  // recipients list, transparently drop any address that's currently
  // on the auto-suppression list. Override sends (manual test, "re-
  // send to bounced", admin-supplied subset) are NEVER filtered here:
  // the admin is consciously choosing the recipient set and should be
  // able to deliberately retry a previously-suppressed address.
  const suppressedSet = new Set(cfg.suppressions.map((s) => s.email));
  const rawRecipients = hasOverride
    ? opts.recipientsOverride!.map((r) => r.trim()).filter((r) => r.length > 0)
    : cfg.recipients;
  const skippedSuppressed = hasOverride
    ? []
    : rawRecipients.filter((r) => suppressedSet.has(r.toLowerCase()));
  const recipients = hasOverride
    ? rawRecipients
    : rawRecipients.filter((r) => !suppressedSet.has(r.toLowerCase()));
  if (skippedSuppressed.length > 0) {
    logger.info(
      { skipped: skippedSuppressed, count: skippedSuppressed.length },
      "cleanup report: skipping suppressed recipients",
    );
  }
  if (recipients.length === 0) {
    await recordSendAttempt({
      trigger,
      triggeredByUserId,
      triggeredByUserName,
      recipients: [],
      rowCount: null,
      status: "failure",
      failureReason: "no_recipients",
      windowFrom: opts.windowOverride?.from ?? null,
      windowTo: opts.windowOverride?.to ?? null,
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
      windowFrom: opts.windowOverride?.from ?? null,
      windowTo: opts.windowOverride?.to ?? null,
    });
    return { sent: false, reason: "mailer_not_configured" };
  }

  // For force-mode without an active schedule, default to a weekly window.
  const effectiveSchedule: CleanupReportSchedule =
    cfg.schedule === "off" ? "weekly" : cfg.schedule;
  const days = windowDaysForSchedule(effectiveSchedule);
  const to = opts.windowOverride?.to ?? new Date();
  const from =
    opts.windowOverride?.from ?? new Date(to.getTime() - days * ONE_DAY_MS);

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
      windowFrom: from,
      windowTo: to,
    });
    return { sent: false, reason: result.reason };
  }
  // Test sends and targeted re-sends (task #196) don't bump
  // `lastSentAt` — the schedule cron must still fire on its normal
  // cadence. Only a full cron tick or a manual "send now" to the
  // configured recipient list counts.
  if (!hasOverride) {
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
    windowFrom: from,
    windowTo: to,
    messageId: result.messageId,
    dispatch: result,
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

/**
 * Task #207: how long a per-recipient row can sit at `pending` before
 * we assume the relay silently dropped it (no DSN, no webhook event,
 * no delivery confirmation). Configurable for tests; defaults to 48h.
 */
export const STUCK_PENDING_THRESHOLD_MS = Number(
  process.env.CLEANUP_REPORT_STUCK_PENDING_MS ?? 48 * 60 * 60 * 1000,
);

/**
 * Task #207: reason string stamped on `cleanup_report_send_recipients`
 * rows that we auto-bounce after the stuck-pending threshold. Kept as
 * a named export so tests / downstream code can assert against it
 * instead of duplicating the literal.
 */
export const STUCK_PENDING_BOUNCE_REASON = "no_delivery_confirmation_48h";

/**
 * Task #207: sweep `cleanup_report_send_recipients` rows that have
 * been sitting at `status='pending'` for longer than
 * `STUCK_PENDING_THRESHOLD_MS` and flip them to `bounced` with the
 * `no_delivery_confirmation_48h` reason. Returns the number of rows
 * touched so the caller can log / assert.
 *
 * Idempotent: only ever transitions `pending → bounced`, never
 * overwrites a row the provider webhook later resolved.
 */
export async function sweepStuckPendingRecipients(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_PENDING_THRESHOLD_MS);
  try {
    const updated = await db
      .update(cleanupReportSendRecipientsTable)
      .set({
        status: "bounced",
        reason: STUCK_PENDING_BOUNCE_REASON,
        updatedAt: now,
      })
      .where(
        and(
          eq(cleanupReportSendRecipientsTable.status, "pending"),
          lt(cleanupReportSendRecipientsTable.updatedAt, cutoff),
        ),
      )
      .returning({
        id: cleanupReportSendRecipientsTable.id,
        email: cleanupReportSendRecipientsTable.email,
      });
    if (updated.length > 0) {
      logger.info(
        { count: updated.length, cutoff: cutoff.toISOString() },
        "cleanup report: auto-bounced stuck pending recipients",
      );
      // Task #222: fan out one admin notification per newly-bounced row.
      // The notifier dedups via `bounce_notified_at`, so even if this
      // sweep races with the provider webhook only one notice goes out.
      const { notifyAdminsOfCleanupReportBounce } = await import(
        "./cleanup-report-bounce-notify"
      );
      for (const row of updated) {
        await notifyAdminsOfCleanupReportBounce({ recipientId: row.id });
      }
      // Task #223 — newly-flipped bounces may have just completed a
      // consecutive-bounce streak. Evaluate suppression for the
      // affected addresses.
      await evaluateAndSuppressBouncedRecipients(updated.map((r) => r.email));
    }
    return updated.length;
  } catch (err) {
    logger.error({ err }, "cleanup report: stuck-pending sweep failed");
    return 0;
  }
}

/**
 * Task #227 — remove suppression entries that have been sitting on the
 * quarantine list for longer than `CLEANUP_REPORT_SUPPRESSION_MAX_AGE_DAYS`.
 * Most real-world bounce causes (mailbox full, on-leave auto-responder,
 * transient outage) resolve themselves within weeks; without an expiry
 * the suppression list would grow monotonically and addresses that have
 * since recovered would keep getting silently skipped.
 *
 * Returns the list of emails that were auto-expired so the caller can
 * log / audit them. No-op when auto-expiry is disabled (max-age = 0)
 * or there are no suppressions on file.
 */
export async function sweepExpiredCleanupReportSuppressions(
  now: Date = new Date(),
): Promise<string[]> {
  if (CLEANUP_REPORT_SUPPRESSION_MAX_AGE_DAYS <= 0) return [];
  const cfg = await loadConfig();
  if (cfg.suppressions.length === 0) return [];
  const cutoffMs =
    now.getTime() - CLEANUP_REPORT_SUPPRESSION_MAX_AGE_DAYS * ONE_DAY_MS;
  const expired: string[] = [];
  const kept: CleanupReportSuppression[] = [];
  for (const s of cfg.suppressions) {
    const at = Date.parse(s.suppressedAt);
    if (Number.isFinite(at) && at <= cutoffMs) {
      expired.push(s.email);
    } else {
      kept.push(s);
    }
  }
  if (expired.length === 0) return [];
  await persistSuppressions(kept);
  logger.info(
    {
      count: expired.length,
      emails: expired,
      maxAgeDays: CLEANUP_REPORT_SUPPRESSION_MAX_AGE_DAYS,
    },
    "cleanup report: auto-expired stale suppressions",
  );
  return expired;
}

async function tick(): Promise<void> {
  try {
    await sweepStuckPendingRecipients();
  } catch (err) {
    logger.error({ err }, "cleanup report: stuck-pending sweep tick failed");
  }
  try {
    await sweepExpiredCleanupReportSuppressions();
  } catch (err) {
    logger.error(
      { err },
      "cleanup report: stale-suppression sweep tick failed",
    );
  }
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
