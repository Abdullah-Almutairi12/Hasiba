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
  userCompaniesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { sendMail, isMailerConfigured } from "./mailer";

const FINANCE_ROLES = ["owner", "manager", "accountant"];
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

/**
 * Render the Arabic plain-text digest email. Pure function so it can
 * be unit-tested without DB or SMTP.
 */
export function buildDigestEmail(input: {
  companyNames: string[];
  newRows: OpenImbalanceSnapshot[];
  stillOpenCount: number;
  companyNameById: Map<number, string>;
  baseUrl: string;
}): DigestEmail {
  const { companyNames, newRows, stillOpenCount, companyNameById, baseUrl } =
    input;
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
    }
    if (newRows.length > shown.length) {
      lines.push(`  • … و${newRows.length - shown.length} اختلال إضافي`);
    }
    lines.push("");
  }

  lines.push(`لفتح قائمة المراجعة: ${link}`);
  lines.push("");
  lines.push("— نظام حاسبة.AI");

  return { subject, body: lines.join("\n") };
}

/**
 * Fetch the de-duplicated finance recipients for `group`. A user is
 * included if they hold owner / manager / accountant on at least one
 * company in the group AND their account is active AND they have a
 * non-empty email.
 */
export async function loadFinanceRecipients(
  group: number[],
): Promise<string[]> {
  if (group.length === 0) return [];
  const rows = await db
    .selectDistinct({ email: usersTable.email })
    .from(userCompaniesTable)
    .innerJoin(usersTable, eq(usersTable.id, userCompaniesTable.userId))
    .where(
      and(
        inArray(userCompaniesTable.companyId, group),
        inArray(userCompaniesTable.role, FINANCE_ROLES),
        eq(usersTable.isActive, true),
      ),
    );
  const out = new Set<string>();
  for (const r of rows) {
    const email = r.email?.trim();
    if (email) out.add(email.toLowerCase());
  }
  return Array.from(out).sort();
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
}): Promise<{ skipped: true; reason: string } | { skipped: false; recipients: number; newCount: number }> {
  const { group, before, after } = input;
  try {
    if (after.length === 0) {
      return { skipped: true, reason: "no_open_imbalances" };
    }
    const beforeIds = new Set(before.map((r) => r.id));
    const newRows = after.filter((r) => !beforeIds.has(r.id));
    const stillOpenCount = after.length - newRows.length;
    // Spec: "Empty groups (no findings) skip the email so it doesn't
    // become noise." A group with carried-over open rows is NOT empty
    // — finance still needs the daily reminder. We only skip when the
    // whole open queue is empty (covered by the `after.length === 0`
    // check above).
    if (!isMailerConfigured()) {
      logger.info(
        { group, newCount: newRows.length },
        "intercompany_digest.skipped_mailer_unconfigured",
      );
      return { skipped: true, reason: "mailer_unconfigured" };
    }
    const recipients = await loadFinanceRecipients(group);
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
    const { subject, body } = buildDigestEmail({
      companyNames,
      newRows,
      stillOpenCount,
      companyNameById,
      baseUrl: resolveAppBaseUrl(),
    });
    const result = await sendMail({
      to: recipients.join(", "),
      subject,
      body,
    });
    if (!result.sent) {
      logger.warn(
        { group, reason: result.reason },
        "intercompany_digest.send_failed",
      );
      return { skipped: true, reason: `send_failed:${result.reason}` };
    }
    logger.info(
      { group, recipients: recipients.length, newCount: newRows.length, stillOpenCount },
      "intercompany_digest.sent",
    );
    return {
      skipped: false,
      recipients: recipients.length,
      newCount: newRows.length,
    };
  } catch (err) {
    logger.error({ err, group }, "intercompany_digest.unexpected_error");
    return { skipped: true, reason: "exception" };
  }
}
