import {
  db,
  reportDefinitionsTable,
  reportSubscriptionsTable,
  kpiAlertsTable,
  kpiAlertHistoryTable,
  alertsTable,
} from "@workspace/db";
import { eq, lte, isNotNull, and } from "drizzle-orm";
import { runReport, type ReportConfig } from "./query-builder";
import { sendMail, isMailerConfigured } from "./mailer";
import { logger } from "./logger";

function nextRunFor(cadence: string, from: Date = new Date()): Date {
  const next = new Date(from);
  if (cadence === "daily") next.setDate(next.getDate() + 1);
  else if (cadence === "monthly") next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + 7);
  return next;
}

async function runDueSubscriptions(): Promise<void> {
  const now = new Date();
  const due = await db
    .select()
    .from(reportSubscriptionsTable)
    .where(and(eq(reportSubscriptionsTable.isActive, true), lte(reportSubscriptionsTable.nextRunAt, now)));

  for (const sub of due) {
    try {
      const [def] = await db
        .select()
        .from(reportDefinitionsTable)
        .where(eq(reportDefinitionsTable.id, sub.reportId));
      if (!def) continue;
      const result = await runReport(def.dataSource, def.config as ReportConfig);
      const summary =
        `تقرير: ${def.name}\n` +
        `عدد الصفوف: ${result.rowCount}\n` +
        `الأعمدة: ${result.outputColumns.map((c) => c.label).join(", ")}\n\n` +
        `أول 5 صفوف:\n` +
        result.rows.slice(0, 5)
          .map((r) => result.outputColumns.map((c) => `${c.label}: ${r[c.key] ?? ""}`).join(" | "))
          .join("\n");

      const recipients = (sub.recipients as string[]) ?? [];
      if (isMailerConfigured()) {
        for (const to of recipients) {
          await sendMail({
            to,
            subject: `[حاسبة.AI] التقرير المجدول: ${def.name}`,
            body: summary,
          });
        }
      } else {
        logger.warn(
          { subId: sub.id, recipients },
          "Subscription due but mailer not configured — recording in audit only",
        );
      }

      await db
        .update(reportSubscriptionsTable)
        .set({ lastRunAt: now, nextRunAt: nextRunFor(sub.cadence, now) })
        .where(eq(reportSubscriptionsTable.id, sub.id));
    } catch (err) {
      logger.error({ err, subId: sub.id }, "Subscription run failed");
    }
  }
}

async function evaluateKpiAlerts(): Promise<void> {
  const alerts = await db
    .select()
    .from(kpiAlertsTable)
    .where(and(eq(kpiAlertsTable.isActive, true), isNotNull(kpiAlertsTable.reportId)));

  for (const a of alerts) {
    if (a.reportId == null) continue;
    try {
      const [def] = await db
        .select()
        .from(reportDefinitionsTable)
        .where(eq(reportDefinitionsTable.id, a.reportId));
      if (!def) continue;
      const result = await runReport(def.dataSource, def.config as ReportConfig);
      const colKey = a.metricColumn;
      let observed = 0;
      for (const row of result.rows) {
        const v = Number(row[colKey] ?? 0);
        if (!Number.isNaN(v)) observed += v;
      }
      const threshold = Number(a.threshold);
      const prev = a.lastValue == null ? null : Number(a.lastValue);

      let triggered = false;
      let message = "";
      if (a.operator === "above" && observed > threshold) {
        triggered = true;
        message = `${a.name}: القيمة ${observed.toFixed(2)} تجاوزت الحد ${threshold}`;
      } else if (a.operator === "below" && observed < threshold) {
        triggered = true;
        message = `${a.name}: القيمة ${observed.toFixed(2)} أقل من الحد ${threshold}`;
      } else if (a.operator === "changed_by" && prev != null) {
        const diff = Math.abs(observed - prev);
        if (diff >= threshold) {
          triggered = true;
          message = `${a.name}: تغيّرت القيمة من ${prev} إلى ${observed} (تغير ${diff.toFixed(2)})`;
        }
      }

      if (triggered) {
        await db.insert(kpiAlertHistoryTable).values({
          alertId: a.id,
          observedValue: String(observed),
          threshold: String(threshold),
          message,
        });
        // KPI alert definitions aren't tenant-scoped (reporting tables
        // are still cross-tenant in Phase-2); the resulting alert row is
        // logged with companyId=null so it remains visible in the
        // operations view without leaking into a single tenant's feed.
        await db.insert(alertsTable).values({
          companyId: null,
          type: "warning",
          title: `تنبيه KPI: ${a.name}`,
          message,
        });
      }

      await db
        .update(kpiAlertsTable)
        .set({ lastValue: String(observed), lastEvaluatedAt: new Date() })
        .where(eq(kpiAlertsTable.id, a.id));
    } catch (err) {
      logger.error({ err, alertId: a.id }, "KPI evaluation failed");
    }
  }
}

export function startReportingWorkers(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  const tick = async () => {
    try {
      await runDueSubscriptions();
      await evaluateKpiAlerts();
    } catch (err) {
      logger.error({ err }, "Reporting worker tick failed");
    }
  };
  // Kick a tick a few seconds after boot so first-run subscriptions can fire.
  setTimeout(() => void tick(), 30_000).unref();
  const handle = setInterval(() => void tick(), intervalMs);
  handle.unref();
  return handle;
}
