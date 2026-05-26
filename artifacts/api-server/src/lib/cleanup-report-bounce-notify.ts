/**
 * Task #222 — proactively notify admins the moment a cleanup-report
 * send starts bouncing.
 *
 * Bounce status is already visible inside the admin panel, but admins
 * only see it if they happen to open the cleanup-report tab. When a
 * recipient hard-bounces (e.g. the auditor's address was deactivated)
 * we should fire a one-shot notification so the admin team finds out
 * within minutes instead of on the next monthly audit.
 *
 * Notification fan-out:
 *   1. In-app alert in `alerts` (companyId=null so it surfaces in the
 *      cross-tenant operations view alongside the other worker alerts)
 *   2. Email to `cleanupReport.adminNotificationEmail` when that
 *      setting is populated AND SMTP is configured. Failures here are
 *      logged but do NOT roll back the in-app alert.
 *
 * Dedup is enforced at the storage layer: we atomically claim the
 * recipient row by stamping `bounce_notified_at` inside the same
 * UPDATE that asserts `status='bounced' AND bounce_notified_at IS NULL`
 * and only proceed when the UPDATE actually wins the row. This makes
 * the notifier safe to call from N concurrent code paths (provider
 * webhook + stuck-pending sweep + any future late binder) without
 * extra locking — only one caller per (sendId, email) ever gets to
 * dispatch.
 */
import { sql } from "drizzle-orm";
import {
  db,
  alertsTable,
  cleanupReportSendRecipientsTable as recTable,
  cleanupReportSendsTable as sendsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sendMail, isMailerConfigured } from "./mailer";
import { resolveAppBaseUrl } from "./intercompany-imbalance-digest";
import {
  readCleanupReportConfig,
  type CleanupReportSuppression,
} from "./alerts-cleanup-report-email";
import { pool } from "@workspace/db";

export interface BounceNotificationContext {
  sendId: number;
  bouncedEmail: string;
  reason: string | null;
  windowFrom: Date | null;
  windowTo: Date | null;
  originalRecipients: string[];
  deepLink: string;
}

/** Build the deep link into the admin panel send-history row. */
export function buildBounceDeepLink(sendId: number): string {
  const base = resolveAppBaseUrl();
  const path = `/admin?tab=overview&cleanupReportSendId=${sendId}#cleanup-report-send-${sendId}`;
  return base ? `${base}${path}` : path;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

export function renderBounceNotification(
  ctx: BounceNotificationContext,
): { subject: string; body: string; alertTitle: string; alertMessage: string } {
  const reasonStr = ctx.reason ? ctx.reason : "غير محدد";
  const windowStr =
    ctx.windowFrom || ctx.windowTo
      ? `${fmtDate(ctx.windowFrom)} → ${fmtDate(ctx.windowTo)}`
      : "غير محدد";
  const recipientsStr =
    ctx.originalRecipients.length > 0
      ? ctx.originalRecipients.join("، ")
      : "—";
  const subject = `[تنبيه] ارتداد بريد تقرير التنظيف إلى ${ctx.bouncedEmail}`;
  const body =
    `تم اكتشاف ارتداد (bounce) في إرسال تقرير تنظيف التنبيهات.\n\n` +
    `العنوان المرتد: ${ctx.bouncedEmail}\n` +
    `السبب: ${reasonStr}\n` +
    `نطاق التقرير: ${windowStr}\n` +
    `قائمة المستلمين الأصلية: ${recipientsStr}\n\n` +
    `افتح سجل الإرسال في لوحة الإدارة:\n${ctx.deepLink}\n\n` +
    `تم إرسال هذا التنبيه تلقائياً من نظام حاسبة.AI — لن يتكرر لنفس ` +
    `الإرسال والعنوان.\n`;
  const alertTitle = `ارتداد بريد تقرير التنظيف: ${ctx.bouncedEmail}`;
  const alertMessage =
    `فشل تسليم تقرير تنظيف التنبيهات إلى ${ctx.bouncedEmail} ` +
    `(السبب: ${reasonStr}). افتح سجل الإرسال #${ctx.sendId} في ` +
    `لوحة الإدارة للمراجعة.`;
  return { subject, body, alertTitle, alertMessage };
}

/**
 * Task #226 — deep link to the cleanup-report cleanup / suppression
 * section of the admin panel. Distinct from the per-send bounce deep
 * link (which targets a specific send-history row) — the suppressions
 * list is a separate panel, so we scroll to its anchor instead.
 */
export function buildSuppressionsDeepLink(): string {
  const base = resolveAppBaseUrl();
  const path = `/admin?tab=overview#cleanup-report-suppressions`;
  return base ? `${base}${path}` : path;
}

/**
 * Task #226 — render the "addresses were auto-quarantined" digest
 * email. One email lists every address suppressed by a single call
 * to `evaluateAndSuppressBouncedRecipients`, so a multi-bounce batch
 * never fans out into a recipient-per-email storm.
 */
export function renderSuppressionsNotification(
  suppressions: CleanupReportSuppression[],
  deepLink: string,
): { subject: string; body: string } {
  const lines = suppressions.map((s) => {
    const reason = s.lastReason ? s.lastReason : "غير محدد";
    return `   • ${s.email} — ${s.bounceCount} ارتداد متتالي (آخر سبب: ${reason})`;
  });
  const subjectAddr =
    suppressions.length === 1
      ? suppressions[0]!.email
      : `${suppressions.length} عناوين`;
  const subject = `[تنبيه] تم إيقاف إرسال تقرير التنظيف إلى ${subjectAddr}`;
  const intro =
    suppressions.length === 1
      ? `تم إيقاف إرسال تقرير تنظيف التنبيهات تلقائياً إلى العنوان التالي بعد تكرار الارتداد:`
      : `تم إيقاف إرسال تقرير تنظيف التنبيهات تلقائياً إلى العناوين التالية بعد تكرار الارتداد:`;
  const body =
    `${intro}\n\n` +
    `${lines.join("\n")}\n\n` +
    `راجع القائمة وارفع الإيقاف يدوياً من لوحة الإدارة عند الحاجة:\n` +
    `${deepLink}\n\n` +
    `تم إرسال هذا التنبيه تلقائياً من نظام حاسبة.AI.\n`;
  return { subject, body };
}

/**
 * Task #226 — email admins the list of addresses that were just
 * auto-quarantined.
 *
 * Debounce strategy: callers batch all bounce candidates from a single
 * send (or sweep tick) into one `evaluateAndSuppressBouncedRecipients`
 * call, which in turn calls this helper exactly once with the
 * newly-suppressed subset. A multi-recipient bounce therefore produces
 * exactly one digest email, not one per address.
 *
 * Best-effort: no-ops silently when no admin email is configured, when
 * SMTP isn't configured, or when the list is empty. Failures are logged
 * but never thrown — suppression bookkeeping must not regress because
 * the notification path is flaky.
 */
export async function notifyAdminsOfCleanupReportSuppressions(
  suppressions: CleanupReportSuppression[],
): Promise<boolean> {
  if (suppressions.length === 0) return false;
  try {
    const adminEmail = await loadAdminNotificationEmail();
    if (!adminEmail) return false;
    if (!isMailerConfigured()) return false;
    const deepLink = buildSuppressionsDeepLink();
    const { subject, body } = renderSuppressionsNotification(
      suppressions,
      deepLink,
    );
    const result = await sendMail({ to: adminEmail, subject, body });
    if (!result.sent) {
      logger.warn(
        { reason: result.reason, adminEmail, count: suppressions.length },
        "cleanup-report suppression-notify: admin email send failed",
      );
      return false;
    }
    logger.info(
      {
        adminEmail,
        count: suppressions.length,
        emails: suppressions.map((s) => s.email),
      },
      "cleanup-report suppression-notify: dispatched",
    );
    return true;
  } catch (err) {
    logger.error(
      { err, count: suppressions.length },
      "cleanup-report suppression-notify: dispatch failed",
    );
    return false;
  }
}

/**
 * Task #230 — render the "stale suppressions auto-expired" digest.
 * One message lists every address the daily sweeper just removed so
 * an expiry sweep that touches many addresses still produces a single
 * combined notification, not one per address.
 */
export function renderExpiredSuppressionsNotification(
  expired: CleanupReportSuppression[],
  deepLink: string,
  maxAgeDays: number,
): { subject: string; body: string; alertTitle: string; alertMessage: string } {
  const lines = expired.map((s) => {
    const reason = s.lastReason ? s.lastReason : "غير محدد";
    const suppressedAt = s.suppressedAt.slice(0, 10);
    return `   • ${s.email} — مُوقف منذ ${suppressedAt} (آخر سبب: ${reason})`;
  });
  const subjectAddr =
    expired.length === 1
      ? expired[0]!.email
      : `${expired.length} عناوين`;
  const subject = `[إشعار] انتهاء إيقاف إرسال تقرير التنظيف لـ ${subjectAddr}`;
  const intro =
    expired.length === 1
      ? `تم رفع الإيقاف التلقائي عن العنوان التالي بعد مرور أكثر من ${maxAgeDays} يوماً على إيقافه، وسيعود ضمن مستلمي تقرير تنظيف التنبيهات:`
      : `تم رفع الإيقاف التلقائي عن العناوين التالية بعد مرور أكثر من ${maxAgeDays} يوماً على إيقافها، وستعود ضمن مستلمي تقرير تنظيف التنبيهات:`;
  const body =
    `${intro}\n\n` +
    `${lines.join("\n")}\n\n` +
    `راجع القائمة من لوحة الإدارة وأعد الإيقاف يدوياً إن لزم:\n` +
    `${deepLink}\n\n` +
    `تم إرسال هذا التنبيه تلقائياً من نظام حاسبة.AI.\n`;
  const alertTitle =
    expired.length === 1
      ? `انتهاء إيقاف إرسال تقرير التنظيف: ${expired[0]!.email}`
      : `انتهاء إيقاف إرسال تقرير التنظيف لـ ${expired.length} عناوين`;
  // The in-app fallback must list the actual addresses so an admin
  // who only ever sees the alert (no admin email configured, or SMTP
  // down) still knows which auditors will start receiving the report
  // again. Long batches are truncated with a "+N more" tail to keep
  // the alert message readable in the UI.
  const ALERT_EMAIL_CAP = 10;
  const shownEmails = expired.slice(0, ALERT_EMAIL_CAP).map((s) => s.email);
  const overflow = expired.length - shownEmails.length;
  const emailList =
    overflow > 0
      ? `${shownEmails.join("، ")} (+${overflow} إضافي)`
      : shownEmails.join("، ");
  const alertMessage =
    `تمت إعادة ${expired.length === 1 ? "العنوان" : `${expired.length} عناوين`} ` +
    `إلى قائمة مستلمي تقرير تنظيف التنبيهات بعد انتهاء فترة الإيقاف ` +
    `(${maxAgeDays} يوماً): ${emailList}. ` +
    `افتح قائمة الإيقاف في لوحة الإدارة للمراجعة.`;
  return { subject, body, alertTitle, alertMessage };
}

/**
 * Task #230 — notify admins that one or more stale suppression entries
 * just auto-expired. Sends a single combined email to
 * `cleanupReport.adminNotificationEmail` when configured (and SMTP is
 * up); otherwise falls back to a single in-app alert so admins always
 * find out without having to re-open the suppressions list.
 *
 * Best-effort: never throws — the suppression sweep itself must not
 * regress when alerts/SMTP are flaky.
 */
export async function notifyAdminsOfExpiredCleanupReportSuppressions(
  expired: CleanupReportSuppression[],
  maxAgeDays: number,
): Promise<boolean> {
  if (expired.length === 0) return false;
  try {
    const deepLink = buildSuppressionsDeepLink();
    const rendered = renderExpiredSuppressionsNotification(
      expired,
      deepLink,
      maxAgeDays,
    );
    const adminEmail = await loadAdminNotificationEmail();
    if (adminEmail && isMailerConfigured()) {
      const result = await sendMail({
        to: adminEmail,
        subject: rendered.subject,
        body: rendered.body,
      });
      if (result.sent) {
        logger.info(
          {
            adminEmail,
            count: expired.length,
            emails: expired.map((s) => s.email),
          },
          "cleanup-report expiry-notify: dispatched via email",
        );
        return true;
      }
      logger.warn(
        { reason: result.reason, adminEmail, count: expired.length },
        "cleanup-report expiry-notify: admin email send failed, falling back to in-app alert",
      );
    }
    // Fallback (or primary, when no admin email is configured):
    // single in-app alert listing every expired address.
    try {
      await db.insert(alertsTable).values({
        companyId: null,
        type: "cleanup_report_suppression_expired",
        title: rendered.alertTitle,
        message: `${rendered.alertMessage} ${deepLink}`,
      });
      logger.info(
        {
          count: expired.length,
          emails: expired.map((s) => s.email),
        },
        "cleanup-report expiry-notify: dispatched via in-app alert",
      );
      return true;
    } catch (err) {
      logger.error(
        { err, count: expired.length },
        "cleanup-report expiry-notify: alert insert failed",
      );
      return false;
    }
  } catch (err) {
    logger.error(
      { err, count: expired.length },
      "cleanup-report expiry-notify: dispatch failed",
    );
    return false;
  }
}

async function loadAdminNotificationEmail(): Promise<string | null> {
  try {
    const r = await pool.query<{ system: unknown }>(
      `SELECT system FROM app_settings WHERE id = 1`,
    );
    return readCleanupReportConfig(r.rows[0]?.system).adminNotificationEmail;
  } catch (err) {
    logger.warn(
      { err },
      "cleanup-report bounce-notify: failed to load admin notification email",
    );
    return null;
  }
}

/**
 * Claim + dispatch. Returns `true` when THIS call won the dedup race
 * and dispatched the notification; `false` when the row was already
 * claimed (or not in `bounced` state) and nothing was sent.
 *
 * Never throws — the bounce-tracking path is best-effort and should
 * not break the email webhook handler when alerts/SMTP are flaky.
 */
export async function notifyAdminsOfCleanupReportBounce(opts: {
  recipientId: number;
}): Promise<boolean> {
  try {
    // Atomic claim: only one concurrent caller can flip
    // bounce_notified_at from NULL → now() while status='bounced'.
    const claimed = await db.execute(sql`
      UPDATE cleanup_report_send_recipients
         SET bounce_notified_at = now()
       WHERE id = ${opts.recipientId}
         AND status = 'bounced'
         AND bounce_notified_at IS NULL
       RETURNING id, send_id, email, reason;
    `);
    const claimedRows =
      (claimed as unknown as {
        rows?: Array<{
          id: number;
          send_id: number;
          email: string;
          reason: string | null;
        }>;
      }).rows ??
      (claimed as unknown as Array<{
        id: number;
        send_id: number;
        email: string;
        reason: string | null;
      }>);
    const claim = claimedRows?.[0];
    if (!claim) return false;

    // Load parent send context (recipients list + window) for the
    // notification payload. Failures degrade gracefully — we still
    // emit the alert with whatever context we have.
    let windowFrom: Date | null = null;
    let windowTo: Date | null = null;
    let originalRecipients: string[] = [];
    try {
      const [s] = await db
        .select({
          windowFrom: sendsTable.windowFrom,
          windowTo: sendsTable.windowTo,
          recipients: sendsTable.recipients,
        })
        .from(sendsTable)
        .where(sql`${sendsTable.id} = ${claim.send_id}`)
        .limit(1);
      if (s) {
        windowFrom = s.windowFrom ?? null;
        windowTo = s.windowTo ?? null;
        originalRecipients = (s.recipients ?? "")
          .split(",")
          .map((r) => r.trim())
          .filter((r) => r.length > 0);
      }
    } catch (err) {
      logger.warn(
        { err, sendId: claim.send_id },
        "cleanup-report bounce-notify: failed to load parent send context",
      );
    }

    const deepLink = buildBounceDeepLink(claim.send_id);
    const ctx: BounceNotificationContext = {
      sendId: claim.send_id,
      bouncedEmail: claim.email,
      reason: claim.reason,
      windowFrom,
      windowTo,
      originalRecipients,
      deepLink,
    };
    const rendered = renderBounceNotification(ctx);

    // 1) In-app alert. companyId=null because cleanup-report sends
    //    are cross-tenant (the cron has no request context).
    try {
      await db.insert(alertsTable).values({
        companyId: null,
        type: "cleanup_report_bounce",
        title: rendered.alertTitle,
        message: `${rendered.alertMessage} ${deepLink}`,
      });
    } catch (err) {
      logger.error(
        { err, recipientId: claim.id },
        "cleanup-report bounce-notify: alert insert failed",
      );
    }

    // 2) Email to the configured admin address (best-effort).
    const adminEmail = await loadAdminNotificationEmail();
    if (adminEmail && isMailerConfigured()) {
      const result = await sendMail({
        to: adminEmail,
        subject: rendered.subject,
        body: rendered.body,
      });
      if (!result.sent) {
        logger.warn(
          { reason: result.reason, adminEmail },
          "cleanup-report bounce-notify: admin email send failed",
        );
      }
    }

    logger.info(
      {
        recipientId: claim.id,
        sendId: claim.send_id,
        bouncedEmail: claim.email,
        notifiedAdminEmail: Boolean(adminEmail),
      },
      "cleanup-report bounce-notify: dispatched",
    );
    return true;
  } catch (err) {
    logger.error(
      { err, recipientId: opts.recipientId },
      "cleanup-report bounce-notify: dispatch failed",
    );
    return false;
  }
}
