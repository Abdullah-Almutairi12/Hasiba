/**
 * Morning email digest of intercompany imbalances.
 *
 * Called once per group from `runNightlyImbalanceScan` after the scan
 * has refreshed the persisted queue. Compares the set of open imbalance
 * ids that existed *before* the scan against the set that exists *after*
 * to classify each open row as either "new" (detected overnight) or
 * "still open" (carried over from a previous run).
 *
 * Recipients are the finance contacts of every company in the group —
 * active users who hold owner / manager / accountant on at least one
 * company in the group, via `user_companies`. The same user is only
 * emailed once per group even if they have access to multiple sibling
 * companies in it.
 *
 * Empty groups (zero open rows) are skipped — the whole point of the
 * digest is to be proactive without becoming noise.
 */

import {
  db,
  intercompanyImbalancesTable,
  companiesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { sendMail, isMailerConfigured } from "./mailer";
import { mintEmailActionToken } from "./intercompany-email-action";
import {
  loadGroupPrefs,
  loadOptedInRecipients,
  markGroupSent,
  type GroupPrefsView,
} from "./intercompany-digest-prefs";

const MAX_LIST_ITEMS = 10;

export interface OpenImbalanceSnapshot {
  id: number;
  basis: string;
  sourceCompanyId: number;
  sourceRef: string;
  targetCompanyId: number;
  targetRef: string;
  difference: string;
}

/** Snapshot every currently-open imbalance whose source is in the group. */
export async function snapshotOpenImbalances(
  group: number[],
): Promise<OpenImbalanceSnapshot[]> {
  if (group.length === 0) return [];
  const rows = await db
    .select({
      id: intercompanyImbalancesTable.id,
      basis: intercompanyImbalancesTable.basis,
      sourceCompanyId: intercompanyImbalancesTable.sourceCompanyId,
      sourceRef: intercompanyImbalancesTable.sourceRef,
      targetCompanyId: intercompanyImbalancesTable.targetCompanyId,
      targetRef: intercompanyImbalancesTable.targetRef,
      difference: intercompanyImbalancesTable.difference,
    })
    .from(intercompanyImbalancesTable)
    .where(
      and(
        eq(intercompanyImbalancesTable.status, "open"),
        inArray(intercompanyImbalancesTable.sourceCompanyId, group),
      ),
    );
  return rows;
}

/** Resolve the absolute base URL for deep links in the email body. */
export function resolveAppBaseUrl(): string {
  const explicit = (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (explicit) return explicit;
  const host = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (host) return `https://${host}`;
  return "";
}

export interface DigestEmail {
  subject: string;
  body: string;
}

export interface RowActionLinks {
  /** Imbalance row id this pair of action URLs is bound to. */
  imbalanceId: number;
  /** Single-use signed URL → opens confirm modal then resyncs the mirror. */
  resyncUrl: string;
  /** Single-use signed URL → opens confirm modal then marks the row ignored. */
  ignoreUrl: string;
}

/**
 * Render the Arabic plain-text digest email. Pure function so it can
 * be unit-tested without DB or SMTP.
 *
 * `actionLinksByImbalanceId` is the Task-150 per-recipient signed
 * action map. When present and the row has an entry, the email lists
 * a one-click "إعادة المزامنة" + "تجاهل" pair under each new row so
 * finance can act straight from the inbox; otherwise only the deep
 * link into the queue is included (legacy behaviour, preserved so
 * downgrades or token-mint failures still produce a usable email).
 */
export function buildDigestEmail(input: {
  companyNames: string[];
  newRows: OpenImbalanceSnapshot[];
  stillOpenCount: number;
  companyNameById: Map<number, string>;
  baseUrl: string;
  actionLinksByImbalanceId?: Map<number, RowActionLinks>;
  unsubscribeUrl?: string | null;
}): DigestEmail {
  const {
    companyNames,
    newRows,
    stillOpenCount,
    companyNameById,
    baseUrl,
    actionLinksByImbalanceId,
    unsubscribeUrl,
  } = input;
  const groupLabel = companyNames.join("، ");
  const subjectHead =
    newRows.length > 0
      ? `${newRows.length} اختلال جديد بين الشركات الشقيقة`
      : `${stillOpenCount} اختلال مفتوح بانتظار المراجعة`;
  const subject =
    `[حاسبة.AI] ${subjectHead}` +
    (companyNames.length > 0 ? ` — ${groupLabel}` : "");

  // Deep-link target is the "imbalances" tab — the page defaults to
  // the "links" tab unless the URL hash explicitly picks one (see
  // readTabFromHash() in artifacts/erp-system/src/pages/intercompany.tsx).
  const path = "/intercompany#tab=imbalances";
  const link = baseUrl ? `${baseUrl}${path}` : path;
  const lines: string[] = [];
  lines.push("صباح الخير،");
  lines.push("");
  if (newRows.length > 0) {
    lines.push(
      `كشف الفحص الليلي عن ${newRows.length} اختلال جديد` +
        ` ضمن مجموعة الشركات: ${groupLabel}.`,
    );
    if (stillOpenCount > 0) {
      lines.push(
        `كما لا يزال هناك ${stillOpenCount} اختلال مفتوح من جلسات سابقة بانتظار المعالجة.`,
      );
    }
  } else {
    lines.push(
      `لم يُكتشف أي اختلال جديد الليلة ضمن مجموعة الشركات: ${groupLabel}،` +
        ` لكن لا يزال هناك ${stillOpenCount} اختلال مفتوح من جلسات سابقة بانتظار المعالجة.`,
    );
  }
  lines.push("");

  if (newRows.length > 0) {
    lines.push("الاختلالات الجديدة:");
    const shown = newRows.slice(0, MAX_LIST_ITEMS);
    for (const r of shown) {
      const src =
        companyNameById.get(r.sourceCompanyId) ?? `#${r.sourceCompanyId}`;
      const tgt =
        companyNameById.get(r.targetCompanyId) ?? `#${r.targetCompanyId}`;
      const basisAr = r.basis === "open" ? "رصيد" : "إجمالي";
      lines.push(
        `  • [${basisAr}] ${src} (${r.sourceRef}) ↔ ${tgt} (${r.targetRef})` +
          ` — فرق: ${r.difference}`,
      );
      const links = actionLinksByImbalanceId?.get(r.id);
      if (links) {
        lines.push(`     ↻ إعادة المزامنة: ${links.resyncUrl}`);
        lines.push(`     ✕ تجاهل الفرق:   ${links.ignoreUrl}`);
      }
    }
    if (newRows.length > shown.length) {
      lines.push(`  • … و${newRows.length - shown.length} اختلال إضافي`);
    }
    lines.push("");
  }

  lines.push(`لفتح قائمة المراجعة: ${link}`);
  lines.push("");
  lines.push("— نظام حاسبة.AI");
  if (unsubscribeUrl) {
    lines.push("");
    lines.push(
      `لإلغاء اشتراكك في هذا الموجز اضغط هنا: ${unsubscribeUrl}`,
    );
    lines.push(
      "يمكنك أيضاً ضبط وقت الإرسال وأيام الإجازة من صفحة المعاملات بين الشركات ← تبويب \"تفضيلات الموجز\".",
    );
  }

  return { subject, body: lines.join("\n") };
}

export function buildUnsubscribeUrl(baseUrl: string, token: string): string {
  const path = `/api/intercompany/digest/unsubscribe?token=${encodeURIComponent(token)}`;
  return baseUrl ? `${baseUrl}${path}` : path;
}

/**
 * Send the morning digest for one group. Returns the dispatch outcome
 * so the caller can roll it into the cron summary. Always non-throwing
 * — a digest failure must never break the scan loop.
 */
export async function sendImbalanceDigestForGroup(input: {
  group: number[];
  before: OpenImbalanceSnapshot[];
  after: OpenImbalanceSnapshot[];
  prefs?: GroupPrefsView;
}): Promise<
  | { skipped: true; reason: string }
  | { skipped: false; recipients: number; newCount: number }
> {
  const { group, before, after } = input;
  try {
    if (after.length === 0) {
      return { skipped: true, reason: "no_open_imbalances" };
    }
    const beforeIds = new Set(before.map((r) => r.id));
    const newRows = after.filter((r) => !beforeIds.has(r.id));
    const stillOpenCount = after.length - newRows.length;
    if (!isMailerConfigured()) {
      logger.info(
        { group, newCount: newRows.length },
        "intercompany_digest.skipped_mailer_unconfigured",
      );
      return { skipped: true, reason: "mailer_unconfigured" };
    }
    const anchor = group[0]!;
    const prefs = input.prefs ?? (await loadGroupPrefs(anchor));
    const recipients = await loadOptedInRecipients(group);
    if (recipients.length === 0) {
      logger.info(
        { group, newCount: newRows.length },
        "intercompany_digest.skipped_no_recipients",
      );
      return { skipped: true, reason: "no_recipients" };
    }
    const companies = await db
      .select({ id: companiesTable.id, name: companiesTable.name })
      .from(companiesTable)
      .where(inArray(companiesTable.id, group));
    const companyNameById = new Map<number, string>();
    for (const c of companies) companyNameById.set(c.id, c.name);
    const companyNames = group.map(
      (id) => companyNameById.get(id) ?? `#${id}`,
    );
    const baseUrl = resolveAppBaseUrl();

    // Per-recipient envelope so each finance user gets:
    //   1. Task 150 — their own single-use, audit-bound action tokens
    //      for the new-row entries (resync/ignore in one click). A
    //      failure to mint a token for one row just omits that pair of
    //      action links; the row still appears with the deep link.
    //   2. Task #151 — a personalised unsubscribe footer.
    // cc/bcc from group prefs is shared across recipients — those are
    // admin-configured visibility lists, not self-service.
    let sentCount = 0;
    let lastFailReason: string | null = null;
    for (const recipient of recipients) {
      const actionLinksByImbalanceId = new Map<number, RowActionLinks>();
      // Only mint for the rows the email actually lists (top
      // MAX_LIST_ITEMS); the overflow tail is summarised, not linked.
      const linkable = newRows.slice(0, MAX_LIST_ITEMS);
      for (const r of linkable) {
        try {
          const [resync, ignoreLink] = await Promise.all([
            mintEmailActionToken({
              imbalanceId: r.id,
              userId: recipient.userId,
              email: recipient.email,
              action: "resync",
              baseUrl,
            }),
            mintEmailActionToken({
              imbalanceId: r.id,
              userId: recipient.userId,
              email: recipient.email,
              action: "ignore",
              baseUrl,
            }),
          ]);
          actionLinksByImbalanceId.set(r.id, {
            imbalanceId: r.id,
            resyncUrl: resync.url,
            ignoreUrl: ignoreLink.url,
          });
        } catch (err) {
          logger.warn(
            { err, imbalanceId: r.id, userId: recipient.userId },
            "intercompany_digest.mint_token_failed",
          );
        }
      }
      const { subject, body } = buildDigestEmail({
        companyNames,
        newRows,
        stillOpenCount,
        companyNameById,
        baseUrl,
        actionLinksByImbalanceId,
        unsubscribeUrl: buildUnsubscribeUrl(baseUrl, recipient.unsubscribeToken),
      });
      const result = await sendMail({
        to: recipient.email,
        cc: prefs.ccEmails.length > 0 ? prefs.ccEmails.join(", ") : undefined,
        bcc: prefs.bccEmails.length > 0 ? prefs.bccEmails.join(", ") : undefined,
        subject,
        body,
      });
      if (result.sent) {
        sentCount += 1;
      } else {
        lastFailReason = result.reason ?? "unknown";
        logger.warn(
          { group, recipient: recipient.email, reason: result.reason },
          "intercompany_digest.send_failed",
        );
      }
    }
    if (sentCount === 0) {
      return { skipped: true, reason: `send_failed:${lastFailReason ?? "unknown"}` };
    }
    await markGroupSent(anchor, new Date()).catch((err) => {
      logger.warn({ err, anchor }, "intercompany_digest.mark_sent_failed");
    });
    logger.info(
      {
        group,
        recipients: sentCount,
        newCount: newRows.length,
        stillOpenCount,
        cc: prefs.ccEmails.length,
        bcc: prefs.bccEmails.length,
      },
      "intercompany_digest.sent",
    );
    return {
      skipped: false,
      recipients: sentCount,
      newCount: newRows.length,
    };
  } catch (err) {
    logger.error({ err, group }, "intercompany_digest.unexpected_error");
    return { skipped: true, reason: "exception" };
  }
}
