import { Router } from "express";
import {
  db,
  dashboardsTable,
  dashboardWidgetsTable,
  reportDefinitionsTable,
  userCompaniesTable,
} from "@workspace/db";
import { eq, asc, desc, and } from "drizzle-orm";
import { z } from "zod";
import { isRole, type Role } from "../middlewares/require-role";
import { runReport, type ReportConfig } from "../lib/query-builder";
import { getDataSource, userCanReadSource } from "../lib/data-sources";
import { handleRouteError } from "../lib/handle-error";

const router = Router();

function reqRole(req: { session?: { role?: string } }): Role | undefined {
  const r = req.session?.role;
  return isRole(r) ? r : undefined;
}

function serializeDashboard(d: typeof dashboardsTable.$inferSelect) {
  return {
    ...d,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function serializeWidget(w: typeof dashboardWidgetsTable.$inferSelect) {
  return { ...w, createdAt: w.createdAt.toISOString() };
}

// Role-based starter widgets seeded into the user's first dashboard.
function starterWidgetsFor(role: Role | undefined) {
  if (role === "cashier" || role === "sales") {
    return [
      { type: "kpi", title: "مبيعات اليوم", config: { metric: "today_sales" }, position: 0, width: 6 },
      { type: "kpi", title: "عدد الطلبات", config: { metric: "today_orders" }, position: 1, width: 6 },
      { type: "list", title: "آخر الطلبات", config: { source: "recent_orders", limit: 5 }, position: 2, width: 12 },
    ];
  }
  if (role === "inventory") {
    return [
      { type: "kpi", title: "منتجات منخفضة المخزون", config: { metric: "low_stock_count" }, position: 0, width: 6 },
      { type: "kpi", title: "قيمة المخزون", config: { metric: "inventory_value" }, position: 1, width: 6 },
      { type: "list", title: "أكثر المنتجات مبيعاً", config: { source: "top_products", limit: 5 }, position: 2, width: 12 },
    ];
  }
  if (role === "accountant") {
    return [
      { type: "kpi", title: "صافي الربح اليومي", config: { metric: "net_profit_today" }, position: 0, width: 6 },
      { type: "kpi", title: "هامش الربح", config: { metric: "profit_margin" }, position: 1, width: 6 },
      { type: "text", title: "ملاحظات", config: { markdown: "أضف ملاحظات سريعة هنا..." }, position: 2, width: 12 },
    ];
  }
  if (role === "marketing") {
    return [
      { type: "kpi", title: "عدد العملاء", config: { metric: "customer_count" }, position: 0, width: 6 },
      { type: "kpi", title: "متوسط قيمة الطلب", config: { metric: "avg_order_value" }, position: 1, width: 6 },
    ];
  }
  // owner / manager / auditor / default
  return [
    { type: "kpi", title: "مبيعات اليوم", config: { metric: "today_sales" }, position: 0, width: 4 },
    { type: "kpi", title: "صافي الربح اليومي", config: { metric: "net_profit_today" }, position: 1, width: 4 },
    { type: "kpi", title: "مؤشر الصحة", config: { metric: "health_score" }, position: 2, width: 4 },
    { type: "list", title: "أكثر المنتجات مبيعاً", config: { source: "top_products", limit: 5 }, position: 3, width: 12 },
  ];
}

// ============== Dashboards ==============
router.get("/dashboards", async (req, res) => {
  try {
    const userId = req.session.userId!;
    let rows = await db
      .select()
      .from(dashboardsTable)
      .where(eq(dashboardsTable.ownerUserId, userId))
      .orderBy(desc(dashboardsTable.isHome), asc(dashboardsTable.id));

    // First-time user: seed a role-based starter dashboard.
    if (rows.length === 0) {
      const role = reqRole(req);
      const [created] = await db
        .insert(dashboardsTable)
        .values({ name: "لوحة التحكم", ownerUserId: userId, isHome: true })
        .returning();
      const widgets = starterWidgetsFor(role);
      if (widgets.length) {
        await db.insert(dashboardWidgetsTable).values(
          widgets.map((w) => ({ ...w, dashboardId: created.id })),
        );
      }
      rows = [created];
    }
    res.json(rows.map(serializeDashboard));
  } catch (err) {
    req.log.error({ err }, "list dashboards failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateDashboardBody = z.object({
  name: z.string().min(1).max(200),
  isHome: z.boolean().optional(),
});

router.post("/dashboards", async (req, res) => {
  try {
    const body = CreateDashboardBody.parse(req.body);
    const userId = req.session.userId!;
    if (body.isHome) {
      await db
        .update(dashboardsTable)
        .set({ isHome: false })
        .where(eq(dashboardsTable.ownerUserId, userId));
    }
    const [row] = await db
      .insert(dashboardsTable)
      .values({ name: body.name, ownerUserId: userId, isHome: body.isHome ?? false })
      .returning();
    return res.status(201).json(serializeDashboard(row));
  } catch (err) {
    req.log.error({ err }, "create dashboard failed");
    return handleRouteError(err, res);
  }
});

router.patch("/dashboards/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.session.userId!;
    const body = CreateDashboardBody.partial().parse(req.body);
    const [existing] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!existing || existing.ownerUserId !== userId) return res.status(404).json({ error: "غير موجود" });
    if (body.isHome) {
      await db
        .update(dashboardsTable)
        .set({ isHome: false })
        .where(eq(dashboardsTable.ownerUserId, userId));
    }
    const [updated] = await db
      .update(dashboardsTable)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.isHome !== undefined && { isHome: body.isHome }),
        updatedAt: new Date(),
      })
      .where(eq(dashboardsTable.id, id))
      .returning();
    return res.json(serializeDashboard(updated));
  } catch (err) {
    req.log.error({ err }, "update dashboard failed");
    return handleRouteError(err, res);
  }
});

router.delete("/dashboards/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.session.userId!;
    const [existing] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!existing || existing.ownerUserId !== userId) return res.status(404).json({ error: "غير موجود" });
    await db.delete(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.dashboardId, id));
    await db.delete(dashboardsTable).where(eq(dashboardsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "delete dashboard failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Widgets ==============
router.get("/dashboards/:id/widgets", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.session.userId!;
    const [d] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!d || d.ownerUserId !== userId) return res.status(404).json({ error: "غير موجود" });
    const rows = await db
      .select()
      .from(dashboardWidgetsTable)
      .where(eq(dashboardWidgetsTable.dashboardId, id))
      .orderBy(asc(dashboardWidgetsTable.position), asc(dashboardWidgetsTable.id));
    return res.json(rows.map(serializeWidget));
  } catch (err) {
    req.log.error({ err }, "list widgets failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

const WidgetBody = z.object({
  type: z.enum(["kpi", "chart", "list", "iframe", "text"]),
  title: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().nonnegative().optional(),
  width: z.number().int().min(1).max(12).optional(),
});

router.post("/dashboards/:id/widgets", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.session.userId!;
    const [d] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!d || d.ownerUserId !== userId) return res.status(404).json({ error: "غير موجود" });
    const body = WidgetBody.parse(req.body);

    // iframe sandbox: only allow http(s) URLs from a small allowlist.
    if (body.type === "iframe") {
      const url = String((body.config ?? {}).url ?? "");
      try {
        const u = new URL(url);
        if (u.protocol !== "https:") {
          return res.status(400).json({ error: "روابط الإطارات يجب أن تستخدم https" });
        }
      } catch {
        return res.status(400).json({ error: "رابط غير صالح" });
      }
    }

    const [row] = await db
      .insert(dashboardWidgetsTable)
      .values({
        dashboardId: id,
        type: body.type,
        title: body.title,
        config: body.config ?? {},
        position: body.position ?? 0,
        width: body.width ?? 4,
      })
      .returning();
    return res.status(201).json(serializeWidget(row));
  } catch (err) {
    req.log.error({ err }, "create widget failed");
    return handleRouteError(err, res);
  }
});

router.patch("/dashboards/:id/widgets/:wid", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const wid = Number(req.params.wid);
    const userId = req.session.userId!;
    const [d] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!d || d.ownerUserId !== userId) return res.status(404).json({ error: "غير موجود" });
    const body = WidgetBody.partial().parse(req.body);
    const [updated] = await db
      .update(dashboardWidgetsTable)
      .set({
        ...(body.title !== undefined && { title: body.title }),
        ...(body.config !== undefined && { config: body.config }),
        ...(body.position !== undefined && { position: body.position }),
        ...(body.width !== undefined && { width: body.width }),
        ...(body.type !== undefined && { type: body.type }),
      })
      .where(and(eq(dashboardWidgetsTable.id, wid), eq(dashboardWidgetsTable.dashboardId, id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "غير موجود" });
    return res.json(serializeWidget(updated));
  } catch (err) {
    req.log.error({ err }, "update widget failed");
    return handleRouteError(err, res);
  }
});

router.delete("/dashboards/:id/widgets/:wid", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const wid = Number(req.params.wid);
    const userId = req.session.userId!;
    const [d] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!d || d.ownerUserId !== userId) return res.status(404).json({ error: "غير موجود" });
    await db
      .delete(dashboardWidgetsTable)
      .where(and(eq(dashboardWidgetsTable.id, wid), eq(dashboardWidgetsTable.dashboardId, id)));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "delete widget failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Run a chart widget tied to a saved report definition.
router.post("/dashboards/widgets/:wid/data", async (req, res) => {
  try {
    const wid = Number(req.params.wid);
    const userId = req.session.userId!;
    const [w] = await db
      .select()
      .from(dashboardWidgetsTable)
      .where(eq(dashboardWidgetsTable.id, wid));
    if (!w) return res.status(404).json({ error: "غير موجود" });
    const [d] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, w.dashboardId));
    if (!d || d.ownerUserId !== userId) return res.status(403).json({ error: "ممنوع" });

    const cfg = (w.config ?? {}) as Record<string, unknown>;
    const reportId = Number(cfg.reportId);
    if (!reportId) return res.json({ rows: [], columns: [] });
    const [def] = await db.select().from(reportDefinitionsTable).where(eq(reportDefinitionsTable.id, reportId));
    if (!def) return res.status(404).json({ error: "تقرير غير موجود" });
    // Tenant + ownership scope: a report definition belongs to the user
    // who created it; it can be referenced by another user only when
    // explicitly shared via `sharedWithRole`. Since report_definitions
    // has no company_id column, we transitively enforce tenancy through
    // the owning user's session — both viewer and owner must belong to
    // the same company for cross-user access to be allowed.
    const viewerRole = reqRole(req);
    const isOwner = def.ownerUserId === userId;
    const sharedRoleMatch = def.sharedWithRole && viewerRole && def.sharedWithRole === viewerRole;
    if (!isOwner && !sharedRoleMatch) {
      return res.status(404).json({ error: "تقرير غير موجود" });
    }
    if (!isOwner) {
      const [ownerMembership] = await db
        .select({ companyId: userCompaniesTable.companyId })
        .from(userCompaniesTable)
        .where(and(
          eq(userCompaniesTable.userId, def.ownerUserId),
          eq(userCompaniesTable.companyId, req.session.companyId!),
        ))
        .limit(1);
      if (!ownerMembership) {
        return res.status(404).json({ error: "تقرير غير موجود" });
      }
    }
    const source = getDataSource(def.dataSource);
    if (!source || !userCanReadSource(viewerRole, source)) {
      return res.status(403).json({ error: "ليس لديك صلاحية" });
    }
    const result = await runReport(def.dataSource, def.config as ReportConfig);
    return res.json({ columns: result.outputColumns, rows: result.rows, chartType: def.chartType });
  } catch (err) {
    req.log.error({ err }, "widget data failed");
    return handleRouteError(err, res);
  }
});

// User home preference: set a dashboard as home page.
router.post("/dashboards/:id/set-home", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.session.userId!;
    const [d] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.id, id));
    if (!d || d.ownerUserId !== userId) return res.status(404).json({ error: "غير موجود" });
    await db
      .update(dashboardsTable)
      .set({ isHome: false })
      .where(eq(dashboardsTable.ownerUserId, userId));
    await db.update(dashboardsTable).set({ isHome: true }).where(eq(dashboardsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "set home failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
