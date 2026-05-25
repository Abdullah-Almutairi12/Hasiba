import { Router } from "express";
import os from "os";
import {
  db,
  supportTicketsTable,
  announcementsTable,
  featureFlagsTable,
  permissionOverridesTable,
  usersTable,
  companySettingsTable,
  alertsTable,
  appSettingsTable,
  alertsCleanupRunsTable,
} from "@workspace/db";
import { uploadBufferToPrivateObject } from "./storage";
import { eq, sql, desc, and, gt, gte, lte, or, isNull } from "drizzle-orm";
import { recordAudit } from "../lib/audit";
import {
  getPermissionMatrixPayload,
  refreshPermissionOverridesCache,
} from "../lib/permission-overrides";
import { z } from "zod";
import { adminGuard } from "../middlewares/require-role";
import { runAlertsCleanup } from "../lib/alerts-cleanup-cron";
import { buildAlertsCleanupPdf } from "../lib/alerts-cleanup-pdf";
import {
  sendCleanupReportEmail,
  readCleanupReportConfig,
  renderCleanupReportEmail,
  windowDaysForSchedule,
  CLEANUP_REPORT_SUBJECT_MAX,
  CLEANUP_REPORT_INTRO_MAX,
  CLEANUP_REPORT_SCHEDULES,
  type CleanupReportSchedule,
} from "../lib/alerts-cleanup-report-email";
import { loadComplianceReportSummary } from "../lib/compliance/report-section";

const router = Router();

const adminOnly = adminGuard;

const APP_VERSION = process.env["APP_VERSION"] ?? "1.0.0";
const APP_STARTED_AT = new Date();

// ============== Stats ==============
router.get("/admin/stats", adminOnly, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [tStats] = await db
      .select({
        openTickets: sql<number>`count(*) filter (where ${supportTicketsTable.status} in ('open', 'in_progress'))`,
        criticalTickets: sql<number>`count(*) filter (where ${supportTicketsTable.priority} = 'critical' and ${supportTicketsTable.status} != 'resolved')`,
        resolvedToday: sql<number>`count(*) filter (where ${supportTicketsTable.resolvedAt} >= ${today.toISOString()})`,
      })
      .from(supportTicketsTable);

    const [uStats] = await db
      .select({
        activeUsers: sql<number>`count(*) filter (where ${usersTable.isActive} = true)`,
        totalUsers: sql<number>`count(*)`,
      })
      .from(usersTable);

    const [aStats] = await db
      .select({
        activeAnnouncements: sql<number>`count(*) filter (where ${announcementsTable.isActive} = true)`,
      })
      .from(announcementsTable);

    const [fStats] = await db
      .select({
        enabledFeatures: sql<number>`count(*) filter (where ${featureFlagsTable.isEnabled} = true)`,
        totalFeatures: sql<number>`count(*)`,
      })
      .from(featureFlagsTable);

    const [iStats] = await db
      .select({
        failedInvoiceSends: sql<number>`count(*) filter (where ${alertsTable.type} = 'invoice_send_failed' and ${alertsTable.isRead} = false)`,
      })
      .from(alertsTable);

    res.json({
      openTickets: Number(tStats.openTickets),
      criticalTickets: Number(tStats.criticalTickets),
      resolvedToday: Number(tStats.resolvedToday),
      activeUsers: Number(uStats.activeUsers),
      totalUsers: Number(uStats.totalUsers),
      activeAnnouncements: Number(aStats.activeAnnouncements),
      enabledFeatures: Number(fStats.enabledFeatures),
      totalFeatures: Number(fStats.totalFeatures),
      failedInvoiceSends: Number(iStats.failedInvoiceSends),
    });
  } catch (err) {
    req.log.error({ err }, "Admin stats failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Invoice Send Failures ==============
// The background invoice retry worker (lib/invoice-email-retry-worker.ts)
// inserts an alert of type 'invoice_send_failed' once a sales_email_outbox
// row exhausts its MAX_ATTEMPTS budget. Each alert message carries a
// stable `[outbox#<id>]` token so we can resolve back to the original
// failed outbox row and enrich the UI with recipient/reference/error.
const OUTBOX_TOKEN_RE = /\[outbox#(\d+)\]/;

router.get("/admin/invoice-send-failures", adminOnly, async (req, res) => {
  try {
    const alerts = await db
      .select()
      .from(alertsTable)
      .where(and(eq(alertsTable.type, "invoice_send_failed"), eq(alertsTable.isRead, false)))
      .orderBy(desc(alertsTable.createdAt))
      .limit(50);

    const outboxIds = alerts
      .map((a) => {
        const m = OUTBOX_TOKEN_RE.exec(a.message);
        return m ? Number(m[1]) : null;
      })
      .filter((n): n is number => n !== null && Number.isFinite(n));

    type OutboxRow = {
      id: number;
      refId: number;
      reference: string;
      recipient: string;
      status: string;
      error: string | null;
      attempts: number;
    };
    const outboxMap = new Map<number, OutboxRow>();
    if (outboxIds.length > 0) {
      const result = await db.execute(sql`
        SELECT id,
               ref_id AS "refId",
               reference,
               recipient,
               status,
               error,
               attempts
          FROM sales_email_outbox
         WHERE id = ANY(${outboxIds}::int[])
      `);
      const rows = (result as unknown as { rows?: OutboxRow[] }).rows
        ?? (result as unknown as OutboxRow[]);
      for (const r of rows ?? []) outboxMap.set(r.id, r);
    }

    const items = alerts.map((a) => {
      const m = OUTBOX_TOKEN_RE.exec(a.message);
      const outboxId = m ? Number(m[1]) : null;
      const ob = outboxId != null ? outboxMap.get(outboxId) : undefined;
      return {
        alertId: a.id,
        outboxId: outboxId ?? null,
        invoiceId: ob?.refId ?? null,
        invoiceReference: ob?.reference ?? null,
        recipient: ob?.recipient ?? null,
        lastError: ob?.error ?? null,
        attempts: ob?.attempts ?? null,
        createdAt: a.createdAt.toISOString(),
        title: a.title,
        message: a.message,
        retriable: !!ob && ob.status === "failed",
      };
    });
    res.json(items);
  } catch (err) {
    req.log.error({ err }, "List invoice send failures failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/admin/invoice-send-failures/:alertId/retry",
  adminOnly,
  async (req, res) => {
    try {
      const alertId = Number(req.params.alertId);
      if (!Number.isFinite(alertId)) {
        return res.status(400).json({ error: "Bad id" });
      }
      const [alert] = await db
        .select()
        .from(alertsTable)
        .where(eq(alertsTable.id, alertId))
        .limit(1);
      if (!alert || alert.type !== "invoice_send_failed") {
        return res.status(404).json({ error: "التنبيه غير موجود" });
      }
      const m = OUTBOX_TOKEN_RE.exec(alert.message);
      const outboxId = m ? Number(m[1]) : null;
      if (!outboxId || !Number.isFinite(outboxId)) {
        return res
          .status(404)
          .json({ error: "تعذّر تحديد سجل البريد الأصلي" });
      }
      // Reset attempts so the retry worker's WHERE attempts<MAX_ATTEMPTS
      // filter matches, and clear next_retry_at so the very next sweep
      // picks it up instead of waiting for the previous backoff window.
      const upd = await db.execute(sql`
        UPDATE sales_email_outbox
           SET attempts = 0,
               next_retry_at = null,
               error = null
         WHERE id = ${outboxId}
           AND kind = 'invoice'
           AND retry_of IS NULL
           AND status = 'failed'
         RETURNING id;
      `);
      const updRows = (upd as unknown as { rows?: Array<{ id: number }> }).rows
        ?? (upd as unknown as Array<{ id: number }>);
      if (!updRows || updRows.length === 0) {
        return res
          .status(409)
          .json({ error: "هذا السجل لم يعد قابلاً للإرسال" });
      }
      await db
        .update(alertsTable)
        .set({ isRead: true })
        .where(eq(alertsTable.id, alertId));
      req.log.info(
        { alertId, outboxId, userId: req.session?.userId },
        "admin.invoice_send_failure.retry_requeued",
      );
      return res.json({ ok: true, outboxId });
    } catch (err) {
      req.log.error({ err }, "Retry invoice send failure failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ============== System Health ==============
router.get("/admin/system", adminOnly, async (req, res) => {
  try {
    const t0 = Date.now();
    let dbOk = false;
    let dbLatency = 0;
    try {
      await db.execute(sql`select 1`);
      dbLatency = Date.now() - t0;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    const mem = process.memoryUsage();
    const totalMem = os.totalmem();

    res.json({
      databaseOk: dbOk,
      databaseLatencyMs: dbLatency,
      uptimeSeconds: Math.round(process.uptime()),
      memoryUsedMb: Math.round(mem.rss / 1024 / 1024),
      memoryTotalMb: Math.round(totalMem / 1024 / 1024),
      nodeVersion: process.version,
      appVersion: APP_VERSION,
      environment: process.env["NODE_ENV"] ?? "development",
      startedAt: APP_STARTED_AT.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "System health failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Alerts Cleanup (task #162) ==============
// Surfaces the most recent run of the nightly alerts retention sweep
// (task #158) so managers can see how much noise is being trimmed
// and that the self-maintenance is actually running.
router.get("/admin/alerts-cleanup/last", adminOnly, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(alertsCleanupRunsTable)
      .orderBy(desc(alertsCleanupRunsTable.ranAt))
      .limit(1);
    if (!row) {
      const { resolveRetention } = await import("../lib/alerts-cleanup-cron");
      const { retentionDays } = await resolveRetention();
      return res.json({
        lastRunAt: null,
        rowsDeleted: null,
        retentionDays,
      });
    }
    return res.json({
      lastRunAt: row.ranAt.toISOString(),
      rowsDeleted: row.rowsDeleted,
      retentionDays: row.retentionDays,
    });
  } catch (err) {
    req.log.error({ err }, "Alerts cleanup last run lookup failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Task #172: full kept history exported as CSV for offline review /
// compliance audits. Streams every retained row (admin-tunable cap)
// with a BOM + UTF-8 encoding so Excel renders Arabic correctly.
router.get(
  "/admin/system-settings/alerts-cleanup-runs.csv",
  adminOnly,
  async (req, res) => {
    try {
      // Task #174: optional `from` / `to` ISO date filters so admins can
      // export a specific window (e.g. a quarter) instead of all kept rows.
      const parseBoundary = (raw: unknown): Date | null => {
        if (typeof raw !== "string" || raw.trim() === "") return null;
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const from = parseBoundary(req.query.from);
      const to = parseBoundary(req.query.to);
      if ((req.query.from && !from) || (req.query.to && !to)) {
        return res
          .status(400)
          .json({ error: "Invalid 'from' or 'to' date" });
      }
      const conds = [] as Array<ReturnType<typeof gte>>;
      if (from) conds.push(gte(alertsCleanupRunsTable.ranAt, from));
      if (to) conds.push(lte(alertsCleanupRunsTable.ranAt, to));
      const rows = await db
        .select()
        .from(alertsCleanupRunsTable)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(alertsCleanupRunsTable.ranAt));
      const escape = (v: unknown) => {
        if (v == null) return "";
        const s = String(v);
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const headers = ["ran_at", "rows_deleted", "retention_days"];
      const lines = [headers.join(",")];
      for (const r of rows) {
        lines.push(
          [
            escape(r.ranAt.toISOString()),
            escape(r.rowsDeleted),
            escape(r.retentionDays),
          ].join(","),
        );
      }
      const csv = "\uFEFF" + lines.join("\n");
      const filename = `alerts-cleanup-runs-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      return res.send(csv);
    } catch (err) {
      req.log.error({ err }, "Alerts cleanup history CSV export failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Task #176: PDF export of the same kept history. Mirrors the CSV
// endpoint's from/to parsing so the Admin Panel's existing date inputs
// and count preview drive both downloads. Uses the shared Amiri-based
// Arabic font + branded header / footer helpers, and adds "Page X of Y"
// in the footer via pdfkit's bufferPages so auditors get a print-ready
// document.
router.get(
  "/admin/system-settings/alerts-cleanup-runs.pdf",
  adminOnly,
  async (req, res) => {
    try {
      const parseBoundary = (raw: unknown): Date | null => {
        if (typeof raw !== "string" || raw.trim() === "") return null;
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const from = parseBoundary(req.query.from);
      const to = parseBoundary(req.query.to);
      if ((req.query.from && !from) || (req.query.to && !to)) {
        return res
          .status(400)
          .json({ error: "Invalid 'from' or 'to' date" });
      }
      const { buffer, filename } = await buildAlertsCleanupPdf({ from, to });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      return res.send(buffer);
    } catch (err) {
      req.log.error({ err }, "Alerts cleanup history PDF export failed");
      if (!res.headersSent) {
        return res.status(500).json({ error: "Internal server error" });
      }
      try {
        res.end();
      } catch {
        /* ignore */
      }
      return;
    }
  },
);

// Task #175: lightweight count endpoint mirroring the CSV export's
// from/to parsing so the Admin Panel can preview how many runs the
// chosen window will export before downloading.
router.get(
  "/admin/system-settings/alerts-cleanup-runs/count",
  adminOnly,
  async (req, res) => {
    try {
      const parseBoundary = (raw: unknown): Date | null => {
        if (typeof raw !== "string" || raw.trim() === "") return null;
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const from = parseBoundary(req.query.from);
      const to = parseBoundary(req.query.to);
      if ((req.query.from && !from) || (req.query.to && !to)) {
        return res
          .status(400)
          .json({ error: "Invalid 'from' or 'to' date" });
      }
      const conds = [] as Array<ReturnType<typeof gte>>;
      if (from) conds.push(gte(alertsCleanupRunsTable.ranAt, from));
      if (to) conds.push(lte(alertsCleanupRunsTable.ranAt, to));
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(alertsCleanupRunsTable)
        .where(conds.length ? and(...conds) : undefined);
      return res.json({ count: Number(row?.count ?? 0) });
    } catch (err) {
      req.log.error({ err }, "Alerts cleanup count lookup failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Task #164: surface a short history (~14 most recent runs) so the
// Admin Panel can render a sparkline / bar chart of nightly sweeps.
router.get("/admin/alerts-cleanup/history", adminOnly, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(alertsCleanupRunsTable)
      .orderBy(desc(alertsCleanupRunsTable.ranAt))
      .limit(14);
    return res.json(
      rows.map((r) => ({
        ranAt: r.ranAt.toISOString(),
        rowsDeleted: r.rowsDeleted,
        retentionDays: r.retentionDays,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Alerts cleanup history lookup failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Tickets ==============
function serializeTicket(t: typeof supportTicketsTable.$inferSelect) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
  };
}

router.get("/admin/tickets", adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    const rows = await db
      .select()
      .from(supportTicketsTable)
      .where(status ? eq(supportTicketsTable.status, String(status)) : sql`true`)
      .orderBy(desc(supportTicketsTable.createdAt));
    res.json(rows.map(serializeTicket));
  } catch (err) {
    req.log.error({ err }, "List tickets failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateTicketBody = z.object({
  subject: z.string().min(2).max(200),
  message: z.string().min(2).max(5000),
  customerName: z.string().min(2).max(200),
  customerEmail: z.string().email(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  category: z.string().optional(),
});

router.post("/admin/tickets", adminOnly, async (req, res) => {
  try {
    const body = CreateTicketBody.parse(req.body);
    const [created] = await db
      .insert(supportTicketsTable)
      .values({
        subject: body.subject,
        message: body.message,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        priority: body.priority ?? "medium",
        category: body.category ?? "general",
      })
      .returning();
    res.status(201).json(serializeTicket(created));
  } catch (err) {
    req.log.error({ err }, "Create ticket failed");
    res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

const UpdateTicketBody = z.object({
  status: z.enum(["open", "in_progress", "resolved"]).optional(),
  reply: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

router.patch("/admin/tickets/:id", adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = UpdateTicketBody.parse(req.body);
    const update: Record<string, unknown> = {};
    if (body.status) update.status = body.status;
    if (body.reply !== undefined) update.reply = body.reply;
    if (body.priority) update.priority = body.priority;
    if (body.status === "resolved") update.resolvedAt = new Date();

    const [updated] = await db
      .update(supportTicketsTable)
      .set(update)
      .where(eq(supportTicketsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(serializeTicket(updated));
  } catch (err) {
    req.log.error({ err }, "Update ticket failed");
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

// ============== Announcements ==============
function serializeAnnouncement(a: typeof announcementsTable.$inferSelect) {
  return {
    id: a.id,
    title: a.title,
    message: a.message,
    type: a.type,
    isActive: a.isActive,
    publishedAt: a.publishedAt.toISOString(),
    expiresAt: a.expiresAt?.toISOString() ?? null,
  };
}

router.get("/admin/announcements", adminOnly, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.publishedAt));
    res.json(rows.map(serializeAnnouncement));
  } catch (err) {
    req.log.error({ err }, "List announcements failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/active-announcements", adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(announcementsTable)
      .where(
        and(
          eq(announcementsTable.isActive, true),
          or(isNull(announcementsTable.expiresAt), gt(announcementsTable.expiresAt, now)),
        ),
      )
      .orderBy(desc(announcementsTable.publishedAt))
      .limit(5);
    res.json(rows.map(serializeAnnouncement));
  } catch (err) {
    req.log.error({ err }, "List active announcements failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateAnnouncementBody = z.object({
  title: z.string().min(2).max(200),
  message: z.string().min(2).max(2000),
  type: z.enum(["info", "update", "maintenance", "warning"]),
  expiresAt: z.string().nullish(),
});

router.post("/admin/announcements", adminOnly, async (req, res) => {
  try {
    const body = CreateAnnouncementBody.parse(req.body);
    const [created] = await db
      .insert(announcementsTable)
      .values({
        title: body.title,
        message: body.message,
        type: body.type,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdByUserId: req.session.userId ?? null,
      })
      .returning();
    res.status(201).json(serializeAnnouncement(created));
  } catch (err) {
    req.log.error({ err }, "Create announcement failed");
    res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

router.delete("/admin/announcements/:id", adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await db.delete(announcementsTable).where(eq(announcementsTable.id, id));
    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete announcement failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Feature Flags ==============
function serializeFlag(f: typeof featureFlagsTable.$inferSelect) {
  return {
    id: f.id,
    key: f.key,
    name: f.name,
    description: f.description,
    isEnabled: f.isEnabled,
    category: f.category,
    updatedAt: f.updatedAt.toISOString(),
  };
}

router.get("/admin/feature-flags", adminOnly, async (req, res) => {
  try {
    const rows = await db.select().from(featureFlagsTable).orderBy(featureFlagsTable.category, featureFlagsTable.name);
    res.json(rows.map(serializeFlag));
  } catch (err) {
    req.log.error({ err }, "List feature flags failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const UpdateFlagBody = z.object({ isEnabled: z.boolean() });

router.patch("/admin/feature-flags/:key", adminOnly, async (req, res) => {
  try {
    const key = String(req.params.key);
    const { isEnabled } = UpdateFlagBody.parse(req.body);
    const [updated] = await db
      .update(featureFlagsTable)
      .set({ isEnabled, updatedAt: new Date() })
      .where(eq(featureFlagsTable.key, key))
      .returning();
    if (!updated) return res.status(404).json({ error: "Feature flag not found" });
    return res.json(serializeFlag(updated));
  } catch (err) {
    req.log.error({ err }, "Update feature flag failed");
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

// ============== Permission matrix ==============
router.get("/admin/permissions", adminOnly, async (req, res) => {
  try {
    const payload = await getPermissionMatrixPayload();
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "List permission matrix failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const SetPermissionBody = z.object({
  role: z.string().min(1).max(64),
  permissionKey: z.string().min(1).max(128),
  enabled: z.boolean(),
});

router.put("/admin/permissions", adminOnly, async (req, res) => {
  try {
    const { role, permissionKey, enabled } = SetPermissionBody.parse(req.body);
    // Atomic upsert against the (role, permission_key) unique index so
    // concurrent admin toggles can never insert duplicate rows.
    await db
      .insert(permissionOverridesTable)
      .values({ role, permissionKey, enabled })
      .onConflictDoUpdate({
        target: [permissionOverridesTable.role, permissionOverridesTable.permissionKey],
        set: { enabled, updatedAt: new Date() },
      });
    await refreshPermissionOverridesCache();
    const payload = await getPermissionMatrixPayload();
    return res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Set permission cell failed");
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

// ============== System Settings (task #161) ==============
// Singleton row in `app_settings` carries a `system` jsonb bag with
// admin-tunable knobs that aren't tied to a particular module. Today
// it only holds `alertRetentionDays` (consumed by the nightly alerts
// cleanup cron in lib/alerts-cleanup-cron.ts), but the column is a
// free bag so future system-wide toggles slot in without migrations.
const ALERT_RETENTION_MIN = 7;
const ALERT_RETENTION_MAX = 3650;
const ALERT_RETENTION_DEFAULT = 90;
// Task #171: admin-tunable cap on rows kept in `alerts_cleanup_runs`.
const CLEANUP_AUDIT_KEEP_MIN = 30;
const CLEANUP_AUDIT_KEEP_MAX = 3650;
const CLEANUP_AUDIT_KEEP_DEFAULT = 365;

async function ensureAppSettingsRow() {
  await db
    .insert(appSettingsTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: appSettingsTable.id });
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, 1))
    .limit(1);
  return row!;
}

function readAlertRetention(systemBag: unknown): number | null {
  if (!systemBag || typeof systemBag !== "object") return null;
  const v = (systemBag as Record<string, unknown>)["alertRetentionDays"];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < ALERT_RETENTION_MIN || v > ALERT_RETENTION_MAX) return null;
  return Math.floor(v);
}

function readCleanupAuditKeepRuns(systemBag: unknown): number | null {
  if (!systemBag || typeof systemBag !== "object") return null;
  const v = (systemBag as Record<string, unknown>)["cleanupAuditKeepRuns"];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < CLEANUP_AUDIT_KEEP_MIN || v > CLEANUP_AUDIT_KEEP_MAX) return null;
  return Math.floor(v);
}

interface LastAlertSweep {
  deleted: number;
  retentionDays: number;
  source: "db" | "env" | "default";
  runAt: string;
}

function readLastAlertSweep(systemBag: unknown): LastAlertSweep | null {
  if (!systemBag || typeof systemBag !== "object") return null;
  const raw = (systemBag as Record<string, unknown>)["lastAlertSweep"];
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const deleted = typeof o.deleted === "number" ? o.deleted : null;
  const retentionDays =
    typeof o.retentionDays === "number" ? o.retentionDays : null;
  const source = o.source;
  const runAt = typeof o.runAt === "string" ? o.runAt : null;
  if (
    deleted == null ||
    retentionDays == null ||
    runAt == null ||
    (source !== "db" && source !== "env" && source !== "default")
  ) {
    return null;
  }
  return { deleted, retentionDays, source, runAt };
}

router.get("/admin/system-settings", adminOnly, async (req, res) => {
  try {
    const row = await ensureAppSettingsRow();
    const dbValue = readAlertRetention(row.system);
    const envRaw = process.env["ALERTS_RETENTION_DAYS"];
    const envParsed = envRaw ? Number.parseInt(envRaw, 10) : NaN;
    const envValue =
      Number.isFinite(envParsed) &&
      envParsed >= ALERT_RETENTION_MIN &&
      envParsed <= ALERT_RETENTION_MAX
        ? envParsed
        : null;
    const effective = dbValue ?? envValue ?? ALERT_RETENTION_DEFAULT;
    const source: "db" | "env" | "default" =
      dbValue != null ? "db" : envValue != null ? "env" : "default";
    const auditKeepDb = readCleanupAuditKeepRuns(row.system);
    const cleanupReport = readCleanupReportConfig(row.system);
    res.json({
      alertRetentionDays: dbValue,
      effectiveAlertRetentionDays: effective,
      source,
      envOverride: envValue,
      defaultDays: ALERT_RETENTION_DEFAULT,
      minDays: ALERT_RETENTION_MIN,
      maxDays: ALERT_RETENTION_MAX,
      lastAlertSweep: readLastAlertSweep(row.system),
      cleanupAuditKeepRuns: auditKeepDb,
      effectiveCleanupAuditKeepRuns: auditKeepDb ?? CLEANUP_AUDIT_KEEP_DEFAULT,
      cleanupAuditKeepDefault: CLEANUP_AUDIT_KEEP_DEFAULT,
      cleanupAuditKeepMin: CLEANUP_AUDIT_KEEP_MIN,
      cleanupAuditKeepMax: CLEANUP_AUDIT_KEEP_MAX,
      cleanupReportSchedule: cleanupReport.schedule,
      cleanupReportRecipients: cleanupReport.recipients,
      cleanupReportLastSentAt: cleanupReport.lastSentAt,
      cleanupReportSubject: cleanupReport.subject,
      cleanupReportIntro: cleanupReport.intro,
    });
  } catch (err) {
    req.log.error({ err }, "Get system settings failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const UpdateSystemSettingsBody = z.object({
  // null clears the DB override → cron falls back to env, then default.
  alertRetentionDays: z
    .number()
    .int()
    .min(ALERT_RETENTION_MIN)
    .max(ALERT_RETENTION_MAX)
    .nullable()
    .optional(),
  // Task #171: null clears the override → cron falls back to default (365).
  cleanupAuditKeepRuns: z
    .number()
    .int()
    .min(CLEANUP_AUDIT_KEEP_MIN)
    .max(CLEANUP_AUDIT_KEEP_MAX)
    .nullable()
    .optional(),
  // Task #178: scheduled email of the cleanup PDF report.
  cleanupReportSchedule: z
    .enum(CLEANUP_REPORT_SCHEDULES as readonly [
      CleanupReportSchedule,
      ...CleanupReportSchedule[],
    ])
    .optional(),
  cleanupReportRecipients: z
    .array(z.string().email().max(200))
    .max(50)
    .optional(),
  // Task #179: optional admin-customisable subject and intro text. Null/empty
  // string clears the override → sender falls back to the built-in defaults.
  cleanupReportSubject: z
    .string()
    .max(CLEANUP_REPORT_SUBJECT_MAX)
    .nullable()
    .optional(),
  cleanupReportIntro: z
    .string()
    .max(CLEANUP_REPORT_INTRO_MAX)
    .nullable()
    .optional(),
});

router.patch("/admin/system-settings", adminOnly, async (req, res) => {
  try {
    const body = UpdateSystemSettingsBody.parse(req.body);
    const row = await ensureAppSettingsRow();
    const prevSystem = (row.system ?? {}) as Record<string, unknown>;
    const prev = readAlertRetention(prevSystem);
    const prevAuditKeep = readCleanupAuditKeepRuns(prevSystem);
    const prevCleanupReport = readCleanupReportConfig(prevSystem);
    const nextSystem: Record<string, unknown> = { ...prevSystem };
    if (body.alertRetentionDays !== undefined) {
      if (body.alertRetentionDays === null) {
        delete nextSystem["alertRetentionDays"];
      } else {
        nextSystem["alertRetentionDays"] = body.alertRetentionDays;
      }
    }
    if (body.cleanupAuditKeepRuns !== undefined) {
      if (body.cleanupAuditKeepRuns === null) {
        delete nextSystem["cleanupAuditKeepRuns"];
      } else {
        nextSystem["cleanupAuditKeepRuns"] = body.cleanupAuditKeepRuns;
      }
    }
    if (
      body.cleanupReportSchedule !== undefined ||
      body.cleanupReportRecipients !== undefined ||
      body.cleanupReportSubject !== undefined ||
      body.cleanupReportIntro !== undefined
    ) {
      const cleanupReport: Record<string, unknown> = {
        schedule: prevCleanupReport.schedule,
        recipients: prevCleanupReport.recipients,
        lastSentAt: prevCleanupReport.lastSentAt,
        subject: prevCleanupReport.subject,
        intro: prevCleanupReport.intro,
      };
      if (body.cleanupReportSchedule !== undefined) {
        cleanupReport.schedule = body.cleanupReportSchedule;
      }
      if (body.cleanupReportRecipients !== undefined) {
        cleanupReport.recipients = Array.from(
          new Set(body.cleanupReportRecipients.map((r) => r.trim().toLowerCase()).filter(Boolean)),
        );
      }
      if (body.cleanupReportSubject !== undefined) {
        const v = body.cleanupReportSubject?.trim() ?? "";
        cleanupReport.subject = v.length > 0 ? v : null;
      }
      if (body.cleanupReportIntro !== undefined) {
        const v = body.cleanupReportIntro?.trim() ?? "";
        cleanupReport.intro = v.length > 0 ? v : null;
      }
      nextSystem["cleanupReport"] = cleanupReport;
    }
    await db
      .update(appSettingsTable)
      .set({ system: nextSystem, updatedAt: new Date() })
      .where(eq(appSettingsTable.id, row.id));
    if (body.alertRetentionDays !== undefined) {
      void recordAudit(req, {
        action: "system_settings.alert_retention_changed",
        entity: `app_settings#${row.id}`,
        details: `from=${prev ?? "default"} to=${body.alertRetentionDays ?? "default"}`,
        severity: "info",
      });
      req.log.info(
        {
          userId: req.session?.userId,
          prev,
          next: body.alertRetentionDays,
        },
        "admin.system_settings.alert_retention_changed",
      );
    }
    if (
      body.cleanupReportSchedule !== undefined ||
      body.cleanupReportRecipients !== undefined ||
      body.cleanupReportSubject !== undefined ||
      body.cleanupReportIntro !== undefined
    ) {
      const subjectChanged = body.cleanupReportSubject !== undefined;
      const introChanged = body.cleanupReportIntro !== undefined;
      void recordAudit(req, {
        action: "system_settings.cleanup_report_changed",
        entity: `app_settings#${row.id}`,
        details:
          `schedule=${body.cleanupReportSchedule ?? prevCleanupReport.schedule}` +
          ` recipients=${body.cleanupReportRecipients?.length ?? prevCleanupReport.recipients.length}` +
          (subjectChanged ? " subject=changed" : "") +
          (introChanged ? " intro=changed" : ""),
        severity: "info",
      });
      req.log.info(
        {
          userId: req.session?.userId,
          schedule: body.cleanupReportSchedule,
          recipients: body.cleanupReportRecipients?.length,
          subjectChanged,
          introChanged,
        },
        "admin.system_settings.cleanup_report_changed",
      );
    }
    if (body.cleanupAuditKeepRuns !== undefined) {
      void recordAudit(req, {
        action: "system_settings.cleanup_audit_keep_changed",
        entity: `app_settings#${row.id}`,
        details: `from=${prevAuditKeep ?? "default"} to=${body.cleanupAuditKeepRuns ?? "default"}`,
        severity: "info",
      });
      req.log.info(
        {
          userId: req.session?.userId,
          prev: prevAuditKeep,
          next: body.cleanupAuditKeepRuns,
        },
        "admin.system_settings.cleanup_audit_keep_changed",
      );
    }
    return res.json({
      ok: true,
      alertRetentionDays:
        body.alertRetentionDays !== undefined
          ? body.alertRetentionDays
          : prev,
      cleanupAuditKeepRuns:
        body.cleanupAuditKeepRuns !== undefined
          ? body.cleanupAuditKeepRuns
          : prevAuditKeep,
      cleanupReportSchedule:
        body.cleanupReportSchedule ?? prevCleanupReport.schedule,
      cleanupReportRecipients:
        body.cleanupReportRecipients ?? prevCleanupReport.recipients,
      cleanupReportSubject:
        body.cleanupReportSubject !== undefined
          ? (body.cleanupReportSubject?.trim() || null)
          : prevCleanupReport.subject,
      cleanupReportIntro:
        body.cleanupReportIntro !== undefined
          ? (body.cleanupReportIntro?.trim() || null)
          : prevCleanupReport.intro,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "بيانات غير صحيحة" });
    }
    req.log.error({ err }, "Patch system settings failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Task #166: trigger the nightly alerts retention sweep on demand so admins
// can verify a retention change immediately instead of waiting for the
// next nightly run.
router.post("/admin/system-settings/run-alerts-cleanup", adminOnly, async (req, res) => {
  try {
    const summary = await runAlertsCleanup();
    void recordAudit(req, {
      action: "system_settings.alert_cleanup_run",
      entity: "alerts",
      details: `deleted=${summary.deleted} retentionDays=${summary.retentionDays} source=${summary.source}`,
      severity: "info",
    });
    req.log.info(
      {
        userId: req.session?.userId,
        deleted: summary.deleted,
        retentionDays: summary.retentionDays,
        source: summary.source,
      },
      "admin.system_settings.alert_cleanup_run",
    );
    return res.json({ ok: true, ...summary });
  } catch (err) {
    req.log.error({ err }, "Run alerts cleanup failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Task #181: live preview of the resolved cleanup report email subject
// + body. Admins can iterate on wording without spamming auditors —
// returns exactly what the cron would mail given the current draft.
// Query params:
//   subject   — optional override (else stored value, else default)
//   intro     — optional override (else stored value, else default)
//   schedule  — optional override of the cadence/window selector
const previewQuerySchema = z.object({
  subject: z.string().max(CLEANUP_REPORT_SUBJECT_MAX).optional(),
  intro: z.string().max(CLEANUP_REPORT_INTRO_MAX).optional(),
  schedule: z.enum(CLEANUP_REPORT_SCHEDULES).optional(),
});

router.get(
  "/admin/system-settings/cleanup-report-preview",
  adminOnly,
  async (req, res) => {
    try {
      const parsed = previewQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid query", details: parsed.error.flatten() });
      }
      const settingsRow = await db
        .select({ system: appSettingsTable.system })
        .from(appSettingsTable)
        .limit(1);
      const cfg = readCleanupReportConfig(settingsRow[0]?.system);

      const effectiveSchedule: CleanupReportSchedule =
        parsed.data.schedule ??
        (cfg.schedule === "off" ? "weekly" : cfg.schedule);
      const days = windowDaysForSchedule(effectiveSchedule);
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

      // Resolve subject/intro: explicit query param wins (even if empty
      // string -> use default), else fall back to stored config.
      const subjectInput =
        parsed.data.subject !== undefined
          ? parsed.data.subject.trim() || null
          : cfg.subject;
      const introInput =
        parsed.data.intro !== undefined
          ? parsed.data.intro.trim() || null
          : cfg.intro;

      const [{ count: rowCount }] = await db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(alertsCleanupRunsTable)
        .where(
          and(
            gte(alertsCleanupRunsTable.ranAt, from),
            lte(alertsCleanupRunsTable.ranAt, to),
          ),
        );

      const compliance = await loadComplianceReportSummary({ from, to });

      const rendered = renderCleanupReportEmail({
        subject: subjectInput,
        intro: introInput,
        schedule: effectiveSchedule,
        from,
        to,
        rowCount: Number(rowCount ?? 0),
        complianceCounts: compliance.counts,
      });

      return res.json({
        subject: rendered.subject,
        body: rendered.body,
        periodLabel: rendered.periodLabel,
        from: rendered.from,
        to: rendered.to,
        rowCount: Number(rowCount ?? 0),
        complianceAlertCount: rendered.complianceAlertCount,
        schedule: effectiveSchedule,
      });
    } catch (err) {
      req.log.error({ err }, "Cleanup report preview failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Task #178: manually email the cleanup PDF report to the configured
// recipients immediately, bypassing the schedule cadence. Useful for
// admins to verify a new recipient list / SMTP setup without waiting
// for the next weekly/monthly tick.
router.post(
  "/admin/system-settings/send-cleanup-report-now",
  adminOnly,
  async (req, res) => {
    try {
      const result = await sendCleanupReportEmail({ force: true });
      if (!result.sent) {
        const reasonMap: Record<string, string> = {
          no_recipients: "لم تتم إضافة أي مستلم بعد.",
          mailer_not_configured:
            "البريد غير مُهيأ — يرجى ضبط SMTP_HOST/SMTP_PORT.",
          schedule_off: "الجدولة معطّلة.",
        };
        const msg = reasonMap[result.reason ?? ""] ?? (result.reason ?? "تعذّر الإرسال");
        return res.status(400).json({ error: msg, reason: result.reason });
      }
      void recordAudit(req, {
        action: "system_settings.cleanup_report_sent_manual",
        entity: "alerts_cleanup_runs",
        details: `recipients=${result.recipients?.length ?? 0} rows=${result.rowCount ?? 0}`,
        severity: "info",
      });
      return res.json({
        ok: true,
        sent: true,
        recipients: result.recipients ?? [],
        rowCount: result.rowCount ?? 0,
      });
    } catch (err) {
      req.log.error({ err }, "Send cleanup report failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Task #184: send the cleanup PDF to the logged-in admin only. Lets
// them verify SMTP / formatting end-to-end without spamming the real
// auditor recipient list. Does NOT update `lastSentAt` — this is a
// test, not the scheduled send.
router.post(
  "/admin/system-settings/send-cleanup-report-test",
  adminOnly,
  async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "غير مسجّل الدخول" });
      }
      const row = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      const email = row[0]?.email?.trim();
      if (!email) {
        return res
          .status(400)
          .json({ error: "لا يوجد بريد إلكتروني للحساب الحالي." });
      }
      const result = await sendCleanupReportEmail({
        recipientsOverride: [email],
      });
      if (!result.sent) {
        const reasonMap: Record<string, string> = {
          no_recipients: "لا يوجد بريد إلكتروني للحساب الحالي.",
          mailer_not_configured:
            "البريد غير مُهيأ — يرجى ضبط SMTP_HOST/SMTP_PORT.",
        };
        const msg =
          reasonMap[result.reason ?? ""] ?? (result.reason ?? "تعذّر الإرسال");
        return res.status(400).json({ error: msg, reason: result.reason });
      }
      void recordAudit(req, {
        action: "system_settings.cleanup_report_sent_test",
        entity: "alerts_cleanup_runs",
        details: `recipient=${email} rows=${result.rowCount ?? 0}`,
        severity: "info",
      });
      return res.json({
        ok: true,
        sent: true,
        recipient: email,
        rowCount: result.rowCount ?? 0,
      });
    } catch (err) {
      req.log.error({ err }, "Send cleanup report (test) failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ============== Company Settings (letterhead, bank, PO terms) ==============
// Singleton row at id=1 holding the fields rendered on the PO PDF header
// and footer. PDF generators read this with an env-var fallback so an
// unconfigured tenant still produces a usable document.

function serializeCompany(row: typeof companySettingsTable.$inferSelect | undefined | null) {
  if (!row) {
    return {
      id: 1,
      nameEn: null, nameAr: null, vatNumber: null, address: null,
      phone: null, email: null, logoObjectKey: null,
      bankName: null, bankIban: null, termsEn: null, termsAr: null,
      updatedAt: new Date(0).toISOString(),
    };
  }
  return {
    id: row.id,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    vatNumber: row.vatNumber,
    address: row.address,
    phone: row.phone,
    email: row.email,
    logoObjectKey: row.logoObjectKey,
    bankName: row.bankName,
    bankIban: row.bankIban,
    termsEn: row.termsEn,
    termsAr: row.termsAr,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ensureCompanyRow() {
  await db
    .insert(companySettingsTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: companySettingsTable.id });
  const [row] = await db
    .select()
    .from(companySettingsTable)
    .where(eq(companySettingsTable.id, 1))
    .limit(1);
  return row!;
}

router.get("/admin/company-settings", adminOnly, async (req, res) => {
  try {
    const row = await ensureCompanyRow();
    res.json(serializeCompany(row));
  } catch (err) {
    req.log.error({ err }, "Get company settings failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const UpdateCompanyBody = z.object({
  nameEn: z.string().max(200).nullish(),
  nameAr: z.string().max(200).nullish(),
  vatNumber: z.string().max(50).nullish(),
  address: z.string().max(500).nullish(),
  phone: z.string().max(50).nullish(),
  email: z.string().email().max(200).nullish().or(z.literal("")),
  bankName: z.string().max(200).nullish(),
  bankIban: z.string().max(50).nullish(),
  termsEn: z.string().max(5000).nullish(),
  termsAr: z.string().max(5000).nullish(),
  logoObjectKey: z.string().max(500).nullish(),
});

router.patch("/admin/company-settings", adminOnly, async (req, res) => {
  try {
    await ensureCompanyRow();
    const body = UpdateCompanyBody.parse(req.body);
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) {
        update[k] = v === "" ? null : v;
      }
    }
    const [updated] = await db
      .update(companySettingsTable)
      .set(update)
      .where(eq(companySettingsTable.id, 1))
      .returning();
    return res.json(serializeCompany(updated));
  } catch (err) {
    req.log.error({ err }, "Update company settings failed");
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

const UploadLogoBody = z.object({
  // data URL: "data:image/png;base64,...." OR plain base64.
  // Restricted to PNG/JPEG: those are the only formats pdfkit can embed
  // in the PO header, so accepting WEBP/SVG would silently produce a
  // logo-less PDF after a "successful" upload.
  image: z.string().min(20).max(8 * 1024 * 1024),
  contentType: z.enum(["image/png", "image/jpeg"]),
});

router.post("/admin/company-settings/logo", adminOnly, async (req, res) => {
  try {
    const body = UploadLogoBody.parse(req.body);
    const m = /^data:[^;]+;base64,(.+)$/i.exec(body.image);
    const base64 = m ? m[1]! : body.image;
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "حجم الشعار غير صالح (الحد 5MB)" });
    }
    const extMap: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/svg+xml": "svg",
    };
    const uploaded = await uploadBufferToPrivateObject({
      buffer,
      contentType: body.contentType,
      ext: extMap[body.contentType],
    });
    await ensureCompanyRow();
    const [updated] = await db
      .update(companySettingsTable)
      .set({ logoObjectKey: uploaded.objectKey, updatedAt: new Date() })
      .where(eq(companySettingsTable.id, 1))
      .returning();
    return res.json(serializeCompany(updated));
  } catch (err) {
    req.log.error({ err }, "Upload company logo failed");
    return res.status(400).json({ error: "فشل رفع الشعار" });
  }
});

export default router;
