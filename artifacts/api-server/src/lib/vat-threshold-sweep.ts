/**
 * VAT threshold sweep worker.
 *
 * Runs once per day (with a 90s warm-up after boot) and evaluates the
 * rolling-12-month sales of every tenant whose registration status is
 * `not_registered`. When a tenant first crosses 80% of the mandatory
 * line — or first crosses the mandatory line itself — the sweep emits
 * a single in-app alert AND sends an email to the tenant's owners /
 * managers / accountants (the people who can actually act on it).
 *
 * The crossing is debounced via `companies.vatThreshold{80,100}AlertedAt`
 * so neither in-app banners nor emails ever fire twice for the same
 * threshold. A mandatory crossing also stamps the 80 column so a later
 * dip back to the 80-99% band cannot trigger a downgraded warning.
 */

import {
  db,
  companiesTable,
  userCompaniesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { sendMail, isMailerConfigured } from "./mailer";
import {
  getVatThresholdSnapshot,
  VAT_MANDATORY_THRESHOLD_SAR,
  type VatThresholdSnapshot,
} from "./vat-threshold";
import { alertsTable } from "@workspace/db";

export type ThresholdAlertKind = "near80" | "mandatory";

/**
 * Look up the email recipients for a VAT threshold notification:
 * active users who hold owner/manager/accountant on the company.
 */
async function getRecipientsForCompany(companyId: number): Promise<string[]> {
  const rows = await db
    .select({ email: usersTable.email })
    .from(userCompaniesTable)
    .innerJoin(usersTable, eq(usersTable.id, userCompaniesTable.userId))
    .where(
      and(
        eq(userCompaniesTable.companyId, companyId),
        eq(usersTable.isActive, true),
        inArray(userCompaniesTable.role, ["owner", "manager", "accountant"]),
      ),
    );
  const unique = new Set<string>();
  for (const r of rows) if (r.email) unique.add(r.email);
  return [...unique];
}

function alertCopy(
  kind: ThresholdAlertKind,
  snap: VatThresholdSnapshot,
): { title: string; message: string } {
  if (kind === "mandatory") {
    return {
      title: "تجاوزت حد التسجيل الإلزامي في ضريبة القيمة المضافة",
      message: `وصلت مبيعاتك خلال آخر 12 شهرًا إلى ${snap.rolling12mSales.toLocaleString("ar-SA")} ر.س — يجب التسجيل في ZATCA خلال 30 يومًا.`,
    };
  }
  return {
    title: "اقتربت من حد التسجيل الإلزامي في ضريبة القيمة المضافة",
    message: `وصلت إلى ${snap.percentOfMandatory.toFixed(1)}٪ من الحد الإلزامي (${VAT_MANDATORY_THRESHOLD_SAR.toLocaleString("ar-SA")} ر.س). يُنصح بالاستعداد للتسجيل.`,
  };
}

/**
 * Evaluate one tenant. Inserts at most one alert + sends at most one
 * email; debounces via the timestamps on `companies`. Returns the
 * emitted kind (or null) for instrumentation and tests.
 *
 * Exported so the manual `POST /vat/threshold/check` route and the
 * background sweep share the exact same emission semantics.
 */
export async function evaluateAndEmit(
  companyId: number,
): Promise<{ snapshot: VatThresholdSnapshot; alertEmitted: ThresholdAlertKind | null }> {
  const snap = await getVatThresholdSnapshot(companyId);
  if (snap.status !== "not_registered") {
    return { snapshot: snap, alertEmitted: null };
  }

  const [company] = await db
    .select({
      a80: companiesTable.vatThreshold80AlertedAt,
      a100: companiesTable.vatThreshold100AlertedAt,
      name: companiesTable.name,
    })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) return { snapshot: snap, alertEmitted: null };

  let kind: ThresholdAlertKind | null = null;
  if (snap.crossedMandatory && !company.a100) kind = "mandatory";
  else if (snap.near80 && !snap.crossedMandatory && !company.a80) kind = "near80";

  if (!kind) return { snapshot: snap, alertEmitted: null };

  const copy = alertCopy(kind, snap);
  await db.transaction(async (tx) => {
    await tx.insert(alertsTable).values({
      companyId,
      type: kind === "mandatory" ? "danger" : "warning",
      title: copy.title,
      message: copy.message,
    });
    const now = new Date();
    if (kind === "mandatory") {
      // Stamp both columns: crossing mandatory subsumes near-80 so a
      // dip back to the 80-99% band cannot regress to a downgraded
      // warning later.
      await tx
        .update(companiesTable)
        .set({
          vatThreshold100AlertedAt: now,
          vatThreshold80AlertedAt: company.a80 ?? now,
        })
        .where(eq(companiesTable.id, companyId));
    } else {
      await tx
        .update(companiesTable)
        .set({ vatThreshold80AlertedAt: now })
        .where(eq(companiesTable.id, companyId));
    }
  });

  // Email is best-effort: a delivery failure must NOT roll back the
  // in-app alert insert (else we'd re-emit on every sweep).
  if (isMailerConfigured()) {
    const recipients = await getRecipientsForCompany(companyId);
    if (recipients.length > 0) {
      const result = await sendMail({
        to: recipients.join(", "),
        subject: `[${company.name}] ${copy.title}`,
        body: copy.message,
      });
      if (!result.sent) {
        logger.warn(
          { companyId, kind, reason: result.reason },
          "VAT threshold email not delivered",
        );
      }
    }
  } else {
    logger.info(
      { companyId, kind },
      "VAT threshold crossing: mailer not configured, skipping email",
    );
  }

  return { snapshot: snap, alertEmitted: kind };
}

/**
 * Sweep every not-registered tenant. Called by the daily worker; safe
 * to invoke ad-hoc.
 */
export async function runVatThresholdSweep(): Promise<void> {
  const tenants = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.vatRegistrationStatus, "not_registered"));
  for (const t of tenants) {
    try {
      await evaluateAndEmit(t.id);
    } catch (err) {
      logger.error({ err, companyId: t.id }, "VAT threshold sweep tenant failed");
    }
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Boot the background sweep. Idempotent — only one timer per process.
 * First tick fires 90s after boot to let init scripts finish first.
 */
let started = false;
export function startVatThresholdWorker(intervalMs = ONE_DAY_MS): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    void runVatThresholdSweep().catch((err) =>
      logger.error({ err }, "initial VAT threshold sweep failed"),
    );
    const handle = setInterval(() => {
      void runVatThresholdSweep().catch((err) =>
        logger.error({ err }, "scheduled VAT threshold sweep failed"),
      );
    }, intervalMs);
    handle.unref();
  }, 90_000).unref();
}
