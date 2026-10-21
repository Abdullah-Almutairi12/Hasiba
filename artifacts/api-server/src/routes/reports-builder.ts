import { Router } from "express";
import {
  db,
  reportDefinitionsTable,
  reportSubscriptionsTable,
  kpiAlertsTable,
  kpiAlertHistoryTable,
  alertsTable,
} from "@workspace/db";
import { eq, desc, and, or, sql, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireRole, isRole, type Role } from "../middlewares/require-role";
import { listSourcesForRole, getDataSource, userCanReadSource } from "../lib/data-sources";
import { runReport, type ReportConfig } from "../lib/query-builder";
import { streamCsv, streamXlsx, streamPdf } from "../lib/report-exporters";
import { handleRouteError } from "../lib/handle-error";
import { getCompanyId } from "../lib/scoped-db";
import { readableReport } from "../lib/finance-scope";

const router = Router();

const FilterSchema = z.object({
  column: z.string().min(1),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "between", "is_null", "not_null"]),
  value: z.unknown().optional(),
  value2: z.unknown().optional(),
});

const AggregateSchema = z.object({
  column: z.string().min(1),
  fn: z.enum(["sum", "avg", "count", "min", "max"]),
  alias: z.string().optional(),
});

const ReportConfigSchema = z.object({
  columns: z.array(z.string()).min(1),
  filters: z.array(FilterSchema).optional(),
  groupBy: z.array(z.string()).optional(),
  aggregates: z.array(AggregateSchema).optional(),
  orderBy: z.array(z.object({ column: z.string(), dir: z.enum(["asc", "desc"]).optional() })).optional(),
  limit: z.number().int().positive().max(5000).optional(),
});

const RunBody = z.object({
  source: z.string().min(1),
  config: ReportConfigSchema,
});

function reqRole(req: { session?: { role?: string } }): Role | undefined {
  const r = req.session?.role;
  return isRole(r) ? r : undefined;
}

function requireSourceRead(req: any, res: any, sourceKey: string): boolean {
  const source = getDataSource(sourceKey);
  if (!source) {
    res.status(404).json({ error: "مصدر البيانات غير معروف" });
    return false;
  }
  if (!userCanReadSource(reqRole(req), source)) {
    res.status(403).json({ error: "ليس لديك صلاحية قراءة هذا المصدر" });
    return false;
  }
  return true;
}

// ============== Data sources registry ==============
router.get("/reports/data-sources", (req, res) => {
  res.json(listSourcesForRole(reqRole(req)));
});

// ============== Live run (preview) ==============
router.post("/reports/run", async (req, res) => {
  try {
    const body = RunBody.parse(req.body);
    if (!requireSourceRead(req, res, body.source)) return;
    const result = await runReport(body.source, body.config as ReportConfig, getCompanyId(req));
    return res.json({
      columns: result.outputColumns,
      rows: result.rows,
      rowCount: result.rowCount,
    });
  } catch (err) {
    req.log.error({ err }, "reports/run failed");
    return handleRouteError(err, res);
  }
});

// ============== Saved report definitions ==============
function serializeDef(d: typeof reportDefinitionsTable.$inferSelect) {
  return {
    ...d,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

router.get("/reports/definitions", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const role = reqRole(req);
    const rows = await db
      .select()
      .from(reportDefinitionsTable)
      .where(
        readableReport(getCompanyId(req), userId, role),
      )
      .orderBy(desc(reportDefinitionsTable.updatedAt));
    res.json(rows.map(serializeDef));
  } catch (err) {
    req.log.error({ err }, "list report defs failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateDefBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dataSource: z.string().min(1),
  config: ReportConfigSchema,
  chartType: z.enum(["table", "bar", "line", "pie", "kpi"]).default("table"),
  sharedWithRole: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

router.post("/reports/definitions", async (req, res) => {
  try {
    const body = CreateDefBody.parse(req.body);
    if (!requireSourceRead(req, res, body.dataSource)) return;
    const userId = req.session.userId!;
    const [row] = await db
      .insert(reportDefinitionsTable)
      .values({
        name: body.name,
        description: body.description ?? null,
        dataSource: body.dataSource,
        config: body.config,
        chartType: body.chartType,
        ownerUserId: userId,
        companyId: getCompanyId(req),
        sharedWithRole: body.sharedWithRole ?? null,
        tags: body.tags ?? [],
      })
      .returning();
    return res.status(201).json(serializeDef(row));
  } catch (err) {
    req.log.error({ err }, "create report def failed");
    return handleRouteError(err, res);
  }
});

router.patch("/reports/definitions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.session.userId!;
    const body = CreateDefBody.partial().parse(req.body);
    const [existing] = await db.select().from(reportDefinitionsTable).where(and(eq(reportDefinitionsTable.id, id), eq(reportDefinitionsTable.companyId, getCompanyId(req))));
    if (!existing) return res.status(404).json({ error: "غير موجود" });
    if (existing.ownerUserId !== userId) return res.status(403).json({ error: "لا يمكن تعديل تقرير ليس ملكك" });
    if (body.dataSource && !requireSourceRead(req, res, body.dataSource)) return;
    const [updated] = await db
      .update(reportDefinitionsTable)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.dataSource && { dataSource: body.dataSource }),
        ...(body.config && { config: body.config }),
        ...(body.chartType && { chartType: body.chartType }),
        ...(body.sharedWithRole !== undefined && { sharedWithRole: body.sharedWithRole }),
        ...(body.tags && { tags: body.tags }),
        updatedAt: new Date(),
      })
      .where(eq(reportDefinitionsTable.id, id))
      .returning();
    return res.json(serializeDef(updated));
  } catch (err) {
    req.log.error({ err }, "update report def failed");
    return handleRouteError(err, res);
  }
});

router.delete("/reports/definitions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.session.userId!;
    const [existing] = await db.select().from(reportDefinitionsTable).where(and(eq(reportDefinitionsTable.id, id), eq(reportDefinitionsTable.companyId, getCompanyId(req))));
    if (!existing) return res.status(404).json({ error: "غير موجود" });
    if (existing.ownerUserId !== userId) return res.status(403).json({ error: "لا يمكن حذف تقرير ليس ملكك" });
    await db.delete(reportDefinitionsTable).where(eq(reportDefinitionsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "delete report def failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reports/definitions/:id/run", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [def] = await db.select().from(reportDefinitionsTable).where(and(eq(reportDefinitionsTable.id, id), readableReport(getCompanyId(req), req.session.userId!, reqRole(req))));
    if (!def) return res.status(404).json({ error: "غير موجود" });
    if (!requireSourceRead(req, res, def.dataSource)) return;
    const result = await runReport(def.dataSource, def.config as ReportConfig, getCompanyId(req));
    return res.json({
      definition: serializeDef(def),
      columns: result.outputColumns,
      rows: result.rows,
      rowCount: result.rowCount,
    });
  } catch (err) {
    req.log.error({ err }, "run saved report failed");
    return handleRouteError(err, res);
  }
});

router.get("/reports/definitions/:id/export", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const format = String(req.query.format || "xlsx") as "csv" | "xlsx" | "pdf";
    const [def] = await db.select().from(reportDefinitionsTable).where(and(eq(reportDefinitionsTable.id, id), readableReport(getCompanyId(req), req.session.userId!, reqRole(req))));
    if (!def) return res.status(404).json({ error: "غير موجود" });
    if (!requireSourceRead(req, res, def.dataSource)) return;
    const result = await runReport(def.dataSource, def.config as ReportConfig, getCompanyId(req));
    const filename = `${def.name.replace(/[^a-z0-9-_ \u0600-\u06FF]/gi, "_")}-${new Date().toISOString().slice(0, 10)}`;
    if (format === "csv") streamCsv(res, filename, result);
    else if (format === "pdf") streamPdf(res, filename, result);
    else await streamXlsx(res, filename, result);
    return;
  } catch (err) {
    req.log.error({ err }, "export saved report failed");
    return handleRouteError(err, res);
  }
});

// ============== Subscriptions ==============
function nextRunFor(cadence: string, from: Date = new Date()): Date {
  const next = new Date(from);
  if (cadence === "daily") next.setDate(next.getDate() + 1);
  else if (cadence === "monthly") next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + 7);
  return next;
}

const SubscriptionBody = z.object({
  reportId: z.number().int().positive(),
  recipients: z.array(z.string().email()).min(1),
  cadence: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
  format: z.enum(["xlsx", "pdf", "csv"]).default("xlsx"),
});

router.get("/reports/subscriptions", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const role = reqRole(req);
    const isAdmin = role === "owner" || role === "manager";
    const rows = await db
      .select()
      .from(reportSubscriptionsTable)
      .where(and(
        isAdmin ? sql`true` : eq(reportSubscriptionsTable.ownerUserId, userId),
        sql`${reportSubscriptionsTable.reportId} in (${db.select({ id: reportDefinitionsTable.id }).from(reportDefinitionsTable).where(readableReport(getCompanyId(req), userId, role))})`,
      ))
      .orderBy(desc(reportSubscriptionsTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        lastRunAt: r.lastRunAt?.toISOString() ?? null,
        nextRunAt: r.nextRunAt?.toISOString() ?? null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "list subscriptions failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reports/subscriptions", async (req, res) => {
  try {
    const body = SubscriptionBody.parse(req.body);
    const userId = req.session.userId!;
    const [def] = await db.select().from(reportDefinitionsTable).where(and(
      eq(reportDefinitionsTable.id, body.reportId),
      readableReport(getCompanyId(req), userId, reqRole(req)),
    ));
    if (!def) return res.status(404).json({ error: "غير موجود" });
    if (!requireSourceRead(req, res, def.dataSource)) return;
    const [row] = await db
      .insert(reportSubscriptionsTable)
      .values({
        reportId: body.reportId,
        ownerUserId: userId,
        recipients: body.recipients,
        cadence: body.cadence,
        format: body.format,
        nextRunAt: nextRunFor(body.cadence),
      })
      .returning();
    return res.status(201).json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      nextRunAt: row.nextRunAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "create subscription failed");
    return handleRouteError(err, res);
  }
});

router.delete("/reports/subscriptions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.session.userId!;
    const role = reqRole(req);
    const isAdmin = role === "owner" || role === "manager";
    const [existing] = await db.select().from(reportSubscriptionsTable).where(eq(reportSubscriptionsTable.id, id));
    if (!existing) return res.status(404).json({ error: "غير موجود" });
    const [def] = await db.select().from(reportDefinitionsTable).where(and(
      eq(reportDefinitionsTable.id, existing.reportId),
      readableReport(getCompanyId(req), userId, role),
    ));
    if (!def) return res.status(404).json({ error: "غير موجود" });
    if (!isAdmin && existing.ownerUserId !== userId) {
      return res.status(403).json({ error: "ليس لديك صلاحية" });
    }
    await db.delete(reportSubscriptionsTable).where(eq(reportSubscriptionsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "delete subscription failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== KPI Alerts ==============
const KpiAlertBody = z.object({
  name: z.string().min(1).max(200),
  reportId: z.number().int().positive().nullable().optional(),
  metricColumn: z.string().min(1),
  operator: z.enum(["above", "below", "changed_by"]),
  threshold: z.number(),
});

router.get("/reports/kpi-alerts", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const rows = await db
      .select()
      .from(kpiAlertsTable)
      .where(eq(kpiAlertsTable.ownerUserId, userId))
      .orderBy(desc(kpiAlertsTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        threshold: Number(r.threshold),
        lastValue: r.lastValue == null ? null : Number(r.lastValue),
        createdAt: r.createdAt.toISOString(),
        lastEvaluatedAt: r.lastEvaluatedAt?.toISOString() ?? null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "list kpi alerts failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reports/kpi-alerts", async (req, res) => {
  try {
    const body = KpiAlertBody.parse(req.body);
    const userId = req.session.userId!;
    if (body.reportId != null) {
      const [def] = await db.select().from(reportDefinitionsTable).where(and(
        eq(reportDefinitionsTable.id, body.reportId),
        readableReport(getCompanyId(req), userId, reqRole(req)),
      ));
      if (!def) return res.status(404).json({ error: "غير موجود" });
      if (!requireSourceRead(req, res, def.dataSource)) return;
    }
    const [row] = await db
      .insert(kpiAlertsTable)
      .values({
        name: body.name,
        ownerUserId: userId,
        reportId: body.reportId ?? null,
        metricColumn: body.metricColumn,
        operator: body.operator,
        threshold: String(body.threshold),
      })
      .returning();
    return res.status(201).json({
      ...row,
      threshold: Number(row.threshold),
      lastValue: row.lastValue == null ? null : Number(row.lastValue),
      createdAt: row.createdAt.toISOString(),
      lastEvaluatedAt: row.lastEvaluatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "create kpi alert failed");
    return handleRouteError(err, res);
  }
});

router.delete("/reports/kpi-alerts/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.session.userId!;
    const [existing] = await db.select().from(kpiAlertsTable).where(eq(kpiAlertsTable.id, id));
    if (!existing) return res.status(404).json({ error: "غير موجود" });
    if (existing.ownerUserId !== userId) return res.status(403).json({ error: "ليس لديك صلاحية" });
    await db.delete(kpiAlertsTable).where(eq(kpiAlertsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "delete kpi alert failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/kpi-alerts/history", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const rows = await db
      .select({
        id: kpiAlertHistoryTable.id,
        alertId: kpiAlertHistoryTable.alertId,
        triggeredAt: kpiAlertHistoryTable.triggeredAt,
        observedValue: kpiAlertHistoryTable.observedValue,
        threshold: kpiAlertHistoryTable.threshold,
        message: kpiAlertHistoryTable.message,
        alertName: kpiAlertsTable.name,
      })
      .from(kpiAlertHistoryTable)
      .innerJoin(kpiAlertsTable, eq(kpiAlertsTable.id, kpiAlertHistoryTable.alertId))
      .where(eq(kpiAlertsTable.ownerUserId, userId))
      .orderBy(desc(kpiAlertHistoryTable.triggeredAt))
      .limit(50);
    res.json(
      rows.map((r) => ({
        ...r,
        observedValue: Number(r.observedValue),
        threshold: Number(r.threshold),
        triggeredAt: r.triggeredAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "kpi history failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
