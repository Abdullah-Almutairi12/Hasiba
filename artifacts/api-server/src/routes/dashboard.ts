import { Router } from "express";
import { db } from "@workspace/db";
import {
  productsTable,
  posOrdersTable,
  posSessionsTable,
  alertsTable,
  alertDismissalsTable,
  branchesTable,
  invoicesTable,
  auditLogsTable,
  intercompanyLinksTable,
} from "@workspace/db";
import { sql, gte, desc, and, lt, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { handleRouteError } from "../lib/handle-error";
import { adminGuard } from "../middlewares/require-role";
import { getCompanyId } from "../lib/scoped-db";

/**
 * Mirrors STALE_SCAN_MS in routes/intercompany.ts: 24h scan cadence
 * plus 2h slack for boot delay / clock skew / long-running scans.
 */
const STALE_SCAN_MS = 26 * 60 * 60 * 1000;
const FINANCE_ROLES = new Set(["owner", "manager", "accountant"]);

const router = Router();

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

/**
 * Compact KPI snapshot for the sticky manager bar shown on every page.
 * Manager/owner only. Returns five quick-glance metrics + health score.
 */
router.get("/dashboard/manager-bar", adminGuard, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const today = startOfDay(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Tenant scope: strict per-company predicates. company_id is now
    // NOT NULL on all scoped tables (migration 0007).
    const posScope = eq(posOrdersTable.companyId, companyId);
    const invScope = eq(invoicesTable.companyId, companyId);
    const prodScope = eq(productsTable.companyId, companyId);
    const alertScope = eq(alertsTable.companyId, companyId);

    // Run independent aggregates in parallel; consolidate product stats
    // into a single scan to reduce DB load for the polling widget.
    const [
      [todayAgg],
      [yestAgg],
      [pendingInvoices],
      [productAgg],
      [alertsAgg],
    ] = await Promise.all([
      db
        .select({
          total: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
          orders: sql<string>`count(*)`,
        })
        .from(posOrdersTable)
        .where(and(gte(posOrdersTable.createdAt, today), posScope)),
      db
        .select({
          total: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
        })
        .from(posOrdersTable)
        .where(
          and(
            gte(posOrdersTable.createdAt, yesterday),
            lt(posOrdersTable.createdAt, today),
            posScope,
          ),
        ),
      db
        .select({
          count: sql<string>`count(*)`,
          amount: sql<string>`coalesce(sum(${invoicesTable.amount}::numeric), 0)`,
        })
        .from(invoicesTable)
        .where(and(eq(invoicesTable.status, "pending"), invScope)),
      db
        .select({
          total: sql<string>`count(*)`,
          lowStockCount: sql<string>`count(*) filter (where ${productsTable.stock} <= ${productsTable.minStock})`,
          avgMargin: sql<string>`coalesce(avg((${productsTable.price}::numeric - ${productsTable.costPrice}::numeric) / nullif(${productsTable.price}::numeric, 0)), 0.30)`,
        })
        .from(productsTable)
        .where(and(eq(productsTable.isActive, true), prodScope)),
      db
        .select({
          unread: sql<string>`count(*) filter (where ${alertsTable.isRead} = false)`,
        })
        .from(alertsTable)
        .where(alertScope),
    ]);

    const totalSales = Number(todayAgg.total);
    const yestSales = Number(yestAgg.total);
    const lowStockCount = Number(productAgg.lowStockCount);
    const productCount = Number(productAgg.total) || 1;
    const profitMargin = Number(productAgg.avgMargin);
    const stockHealth = Math.max(0, 100 - (lowStockCount / productCount) * 100);
    const marginHealth = Math.min(100, profitMargin * 100 * 2);
    const growthHealth = Math.max(0, Math.min(100, 50 + pctChange(totalSales, yestSales)));
    const healthScore = Math.round(marginHealth * 0.4 + stockHealth * 0.3 + growthHealth * 0.3);

    res.json({
      salesToday: totalSales,
      salesChange: pctChange(totalSales, yestSales),
      ordersToday: Number(todayAgg.orders),
      pendingInvoicesCount: Number(pendingInvoices.count),
      pendingInvoicesAmount: Number(pendingInvoices.amount),
      lowStockCount,
      unreadAlertsCount: Number(alertsAgg.unread),
      healthScore,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching manager bar KPIs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/summary", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    // Strict tenant scope predicates (company_id NOT NULL since migration 0007).
    const posScope = eq(posOrdersTable.companyId, companyId);
    const prodScope = eq(productsTable.companyId, companyId);
    const today = startOfDay(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Today + yesterday sales
    const [todayAgg] = await db
      .select({
        total: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
        count: sql<string>`count(*)`,
      })
      .from(posOrdersTable)
      .where(and(gte(posOrdersTable.createdAt, today), posScope));

    const [yestAgg] = await db
      .select({
        total: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
      })
      .from(posOrdersTable)
      .where(
        and(gte(posOrdersTable.createdAt, yesterday), lt(posOrdersTable.createdAt, today), posScope),
      );

    // Real margin from product catalog (avg)
    const [marginRow] = await db
      .select({
        avgMargin: sql<string>`coalesce(avg((${productsTable.price}::numeric - ${productsTable.costPrice}::numeric) / nullif(${productsTable.price}::numeric, 0)), 0.30)`,
      })
      .from(productsTable)
      .where(and(sql`${productsTable.isActive} = true`, prodScope));

    const [productStats] = await db
      .select({
        inventoryValue: sql<string>`coalesce(sum(${productsTable.costPrice}::numeric * ${productsTable.stock}), 0)`,
        lowStockCount: sql<string>`count(*) filter (where ${productsTable.stock} <= ${productsTable.minStock})`,
      })
      .from(productsTable)
      .where(and(sql`${productsTable.isActive} = true`, prodScope));

    const totalSales = Number(todayAgg.total);
    const yestSales = Number(yestAgg.total);
    const profitMargin = Number(marginRow.avgMargin);
    const profit = totalSales * profitMargin;
    const yestProfit = yestSales * profitMargin;
    // Net profit assumes operating cost overhead ~30% of gross profit
    const netProfit = profit * 0.7;

    // Health score: weighted of margin (40), low-stock ratio (30), sales growth (30)
    const totalProducts = await db
      .select({ count: sql<string>`count(*)` })
      .from(productsTable)
      .where(and(sql`${productsTable.isActive} = true`, prodScope));
    const productCount = Number(totalProducts[0].count) || 1;
    const lowStockCount = Number(productStats.lowStockCount);
    const stockHealth = Math.max(0, 100 - (lowStockCount / productCount) * 100);
    const marginHealth = Math.min(100, profitMargin * 100 * 2);
    const growthHealth = Math.max(0, Math.min(100, 50 + pctChange(totalSales, yestSales)));
    const healthScore = Math.round(marginHealth * 0.4 + stockHealth * 0.3 + growthHealth * 0.3);

    const liquidity = healthScore >= 75 ? "ممتاز" : healthScore >= 50 ? "جيد" : "ضعيف";
    const growth =
      pctChange(totalSales, yestSales) >= 10
        ? "ممتاز"
        : pctChange(totalSales, yestSales) >= 0
          ? "جيد جداً"
          : "ضعيف";
    const risk = lowStockCount > productCount * 0.2 ? "مرتفع" : lowStockCount > 0 ? "متوسط" : "منخفض";

    res.json({
      totalSalesToday: totalSales,
      totalSalesChange: pctChange(totalSales, yestSales),
      totalProfit: profit,
      profitChange: pctChange(profit, yestProfit),
      profitMargin: Number((profitMargin * 100).toFixed(1)),
      inventoryValue: Number(productStats.inventoryValue),
      lowStockCount,
      netProfit,
      healthScore,
      liquidity,
      growth,
      risk,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching dashboard summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/sales-chart", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const posScope = eq(posOrdersTable.companyId, companyId);
    const period = (req.query.period as string) || "weekly";
    const now = new Date();

    let bucketExpr: ReturnType<typeof sql>;
    let labels: string[];
    let buckets: number;
    let startDate: Date;

    if (period === "weekly") {
      buckets = 7;
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
      bucketExpr = sql`extract(dow from ${posOrdersTable.createdAt} at time zone 'UTC')::int`;
      labels = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    } else if (period === "monthly") {
      buckets = 4;
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 27);
      startDate.setHours(0, 0, 0, 0);
      bucketExpr = sql`floor(extract(epoch from ${posOrdersTable.createdAt} - ${startDate.toISOString()}::timestamp) / (7 * 86400))::int`;
      labels = ["الأسبوع 1", "الأسبوع 2", "الأسبوع 3", "الأسبوع 4"];
    } else {
      buckets = 12;
      startDate = new Date(now.getFullYear(), 0, 1);
      bucketExpr = sql`extract(month from ${posOrdersTable.createdAt})::int - 1`;
      labels = [
        "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
        "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
      ];
    }

    const rows = await db
      .select({
        bucket: bucketExpr.as("bucket"),
        total: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
      })
      .from(posOrdersTable)
      .where(and(gte(posOrdersTable.createdAt, startDate), posScope))
      .groupBy(sql`bucket`);

    const map = new Map<number, number>();
    for (const r of rows) map.set(Number(r.bucket), Number(r.total));

    const data = labels.map((label, i) => {
      const actual = Math.round(map.get(i) ?? 0);
      // Forecast = simple moving average of previous buckets * 1.05 growth factor
      const prior = labels.slice(0, i).map((_, j) => map.get(j) ?? 0);
      const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : actual;
      const forecast = Math.round(avg * 1.05) || actual;
      return { label, actual, forecast };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Error fetching sales chart");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/alerts", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = req.session?.userId;
    const alertScope = eq(alertsTable.companyId, companyId);
    const role = req.session?.role;
    const isFinance = typeof role === "string" && FINANCE_ROLES.has(role);

    // Persisted alerts always come first. The stale-scan banner is
    // synthesized at read time (not written to the alerts table) so it
    // automatically disappears the moment the nightly cron writes a
    // fresh `scan_nightly` audit row — no cleanup logic required.
    const alertsPromise = db
      .select()
      .from(alertsTable)
      .where(alertScope)
      .orderBy(desc(alertsTable.createdAt))
      .limit(10);

    // Per-user dismissals: hide an alert iff its trigger timestamp
    // is <= dismissedAt. Fetched once and joined client-side because
    // synthetic and persisted alerts share the same lookup table.
    const dismissalsPromise =
      typeof userId === "number"
        ? db
            .select({
              alertKey: alertDismissalsTable.alertKey,
              dismissedAt: alertDismissalsTable.dismissedAt,
            })
            .from(alertDismissalsTable)
            .where(
              and(
                eq(alertDismissalsTable.userId, userId),
                // Tenant scope: a user that belongs to multiple
                // companies dismisses per-company, so the synthetic
                // banner hidden in company A still shows in company B.
                eq(alertDismissalsTable.companyId, companyId),
              ),
            )
        : Promise.resolve([] as Array<{ alertKey: string; dismissedAt: Date }>);

    // Only finance roles ever see the stale-scan banner; for everyone
    // else we skip the extra DB round-trip entirely.
    const stalePromise = isFinance
      ? Promise.all([
          db
            .select({ createdAt: auditLogsTable.createdAt })
            .from(auditLogsTable)
            .where(
              and(
                eq(auditLogsTable.action, "scan_nightly"),
                eq(auditLogsTable.entity, "intercompany_imbalance"),
                sql`${auditLogsTable.details} ~ ${`group=\\[(.*,)?${companyId}(,.*)?\\]`}`,
              ),
            )
            .orderBy(desc(auditLogsTable.createdAt))
            .limit(1),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(intercompanyLinksTable)
            .where(
              sql`${intercompanyLinksTable.sourceCompanyId} = ${companyId} OR ${intercompanyLinksTable.targetCompanyId} = ${companyId}`,
            ),
        ])
      : Promise.resolve(null);

    const [alerts, staleData, dismissals] = await Promise.all([
      alertsPromise,
      stalePromise,
      dismissalsPromise,
    ]);

    const dismissedAtByKey = new Map<string, Date>();
    for (const d of dismissals) dismissedAtByKey.set(d.alertKey, d.dismissedAt);

    const synthetic: Array<{
      id: number;
      key: string;
      type: string;
      title: string;
      message: string;
      isRead: boolean;
      createdAt: string;
      href?: string;
    }> = [];

    if (staleData) {
      const [lastScanRow, linkCountRow] = staleData;
      const hasLinks = (linkCountRow[0]?.n ?? 0) > 0;
      const lastScan = lastScanRow[0];
      const isStale = hasLinks
        ? !lastScan || Date.now() - lastScan.createdAt.getTime() > STALE_SCAN_MS
        : false;
      if (isStale) {
        const key = "synthetic:stale_scan";
        // triggeredAt = the moment the banner became stale. When a
        // fresh `scan_nightly` runs and the condition relapses, this
        // advances and the alert re-emerges past any older dismissal.
        const triggeredAt = lastScan
          ? new Date(lastScan.createdAt.getTime() + STALE_SCAN_MS)
          : new Date(0);
        const dismissedAt = dismissedAtByKey.get(key);
        if (!dismissedAt || triggeredAt > dismissedAt) {
          const message = lastScan
            ? `لم يعمل الفحص الليلي لعدم التطابق بين الشركات منذ أكثر من 26 ساعة (آخر تشغيل: ${lastScan.createdAt.toISOString()}). افتح /intercompany?tab=imbalances للمراجعة.`
            : "لم يعمل الفحص الليلي لعدم التطابق بين الشركات بعد رغم وجود روابط بين شركات. افتح /intercompany?tab=imbalances للمراجعة.";
          synthetic.push({
            // Negative sentinel id keeps the synthetic row distinguishable
            // from real alerts.id (serial, always positive) and stable for
            // React list keys across polls.
            id: -1,
            key,
            type: "warning",
            title: "فحص عدم التطابق بين الشركات متأخر",
            message,
            isRead: false,
            createdAt: new Date().toISOString(),
            href: "/intercompany?tab=imbalances",
          });
        }
      }
    }

    const persisted = alerts
      .filter((a) => {
        const dismissedAt = dismissedAtByKey.get(`alert:${a.id}`);
        // Real alerts have a fixed createdAt, so any dismissal after
        // creation hides the row indefinitely — a new trigger inserts
        // a new alerts row with a fresh id (and therefore a fresh key).
        return !dismissedAt || a.createdAt > dismissedAt;
      })
      .map((a) => ({
        id: a.id,
        key: `alert:${a.id}`,
        type: a.type,
        title: a.title,
        message: a.message,
        isRead: a.isRead,
        createdAt: a.createdAt.toISOString(),
      }));

    res.json([...synthetic, ...persisted]);
  } catch (err) {
    req.log.error({ err }, "Error fetching alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

const dismissAlertBodySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9:_-]+$/i, "key must be alphanumeric with : _ -"),
  /**
   * Free-text justification for the audit trail. Optional so we
   * stay backwards-compatible with callers that just want to hide
   * the row; required UX-side enforcement lives on the frontend.
   */
  justificationNotes: z.string().trim().max(2000).optional(),
  /**
   * Relative URL of a PDF the user uploaded via POST
   * /storage/attachments. Validated to live under the private
   * object-storage namespace so callers cannot bind arbitrary URLs
   * (which would let them later "view" external resources from
   * inside the dismissed-alerts panel UI).
   */
  attachmentUrl: z
    .string()
    .regex(
      /^\/api\/storage\/objects\/attachments\/[A-Za-z0-9._/\-]+\.pdf$/i,
      "attachmentUrl must point at an uploaded PDF in /api/storage/objects/attachments/",
    )
    .max(512)
    .optional(),
});

router.post("/dashboard/alerts/dismiss", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (typeof userId !== "number") {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const companyId = getCompanyId(req);
    const { key, justificationNotes, attachmentUrl } =
      dismissAlertBodySchema.parse(req.body);
    const notes = justificationNotes && justificationNotes.length > 0
      ? justificationNotes
      : null;
    const attachment = attachmentUrl ?? null;

    // Validate the key actually corresponds to an alert visible to
    // this tenant — prevents users from poisoning the dismissals
    // table with arbitrary keys or hiding sibling tenants' alerts.
    // For `alert:<id>` keys we also stamp the numeric id into
    // alert_dismissals.alert_id so the FK cascade auto-cleans the
    // dismissal when the underlying alert row is deleted (task #156).
    let alertId: number | null = null;
    if (key.startsWith("alert:")) {
      const numericId = Number(key.slice("alert:".length));
      if (!Number.isInteger(numericId) || numericId <= 0) {
        res.status(400).json({ error: "Invalid alert key" });
        return;
      }
      const [row] = await db
        .select({ id: alertsTable.id })
        .from(alertsTable)
        .where(and(eq(alertsTable.id, numericId), eq(alertsTable.companyId, companyId)))
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "Alert not found" });
        return;
      }
      alertId = numericId;
    } else if (key !== "synthetic:stale_scan") {
      res.status(400).json({ error: "Unknown alert key" });
      return;
    }

    await db
      .insert(alertDismissalsTable)
      .values({
        userId,
        companyId,
        alertKey: key,
        alertId,
        justificationNotes: notes,
        attachmentUrl: attachment,
      })
      .onConflictDoUpdate({
        target: [
          alertDismissalsTable.userId,
          alertDismissalsTable.companyId,
          alertDismissalsTable.alertKey,
        ],
        set: {
          dismissedAt: new Date(),
          alertId,
          justificationNotes: notes,
          attachmentUrl: attachment,
        },
      });

    res.json({ ok: true });
  } catch (err) {
    handleRouteError(err, res);
  }
});

/**
 * Static labels for synthetic banners — used by the "previously
 * dismissed" panel so the user can recognise what they hid even
 * though the banner is only computed on the live feed.
 */
const SYNTHETIC_ALERT_LABELS: Record<
  string,
  { type: "warning" | "info" | "danger" | "success"; title: string; message: string }
> = {
  "synthetic:stale_scan": {
    type: "warning",
    title: "فحص عدم التطابق بين الشركات متأخر",
    message:
      "بانر يظهر تلقائياً عند تأخر الفحص الليلي لعدم التطابق بين الشركات لأكثر من 26 ساعة.",
  },
};

router.get("/dashboard/alerts/dismissed", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (typeof userId !== "number") {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const companyId = getCompanyId(req);

    const dismissals = await db
      .select({
        alertKey: alertDismissalsTable.alertKey,
        dismissedAt: alertDismissalsTable.dismissedAt,
        justificationNotes: alertDismissalsTable.justificationNotes,
        attachmentUrl: alertDismissalsTable.attachmentUrl,
      })
      .from(alertDismissalsTable)
      .where(
        and(
          eq(alertDismissalsTable.userId, userId),
          eq(alertDismissalsTable.companyId, companyId),
        ),
      )
      .orderBy(desc(alertDismissalsTable.dismissedAt));

    // Collect alert ids for the persisted-row keys so we can enrich
    // the response with title/message/type in a single round-trip.
    const alertIds: number[] = [];
    for (const d of dismissals) {
      if (d.alertKey.startsWith("alert:")) {
        const n = Number(d.alertKey.slice("alert:".length));
        if (Number.isInteger(n) && n > 0) alertIds.push(n);
      }
    }

    const alertRows =
      alertIds.length > 0
        ? await db
            .select({
              id: alertsTable.id,
              type: alertsTable.type,
              title: alertsTable.title,
              message: alertsTable.message,
            })
            .from(alertsTable)
            .where(
              and(
                inArray(alertsTable.id, alertIds),
                // Defence-in-depth: never reveal a sibling tenant's
                // alert metadata even if a stale dismissal row exists.
                eq(alertsTable.companyId, companyId),
              ),
            )
        : [];

    const alertById = new Map<number, (typeof alertRows)[number]>();
    for (const a of alertRows) alertById.set(a.id, a);

    const enriched = dismissals.map((d) => {
      const auditTrail = {
        justificationNotes: d.justificationNotes ?? null,
        attachmentUrl: d.attachmentUrl ?? null,
      };
      if (d.alertKey.startsWith("alert:")) {
        const n = Number(d.alertKey.slice("alert:".length));
        const row = alertById.get(n);
        if (row) {
          return {
            key: d.alertKey,
            type: row.type,
            title: row.title,
            message: row.message,
            dismissedAt: d.dismissedAt.toISOString(),
            synthetic: false,
            sourceMissing: false,
            ...auditTrail,
          };
        }
        // The original alert was deleted (or belongs to another
        // tenant). Surface a placeholder so the user can still
        // un-dismiss the stale row to clean it up.
        return {
          key: d.alertKey,
          type: "info" as const,
          title: "تنبيه محذوف",
          message: "لم يعد التنبيه الأصلي موجوداً، يمكنك إزالة الإخفاء لتنظيف القائمة.",
          dismissedAt: d.dismissedAt.toISOString(),
          synthetic: false,
          sourceMissing: true,
          ...auditTrail,
        };
      }
      const meta = SYNTHETIC_ALERT_LABELS[d.alertKey];
      return {
        key: d.alertKey,
        type: meta?.type ?? "info",
        title: meta?.title ?? d.alertKey,
        message: meta?.message ?? "",
        dismissedAt: d.dismissedAt.toISOString(),
        synthetic: true,
        sourceMissing: false,
        ...auditTrail,
      };
    });

    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Error listing dismissed alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

const undismissQuerySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9:_-]+$/i, "key must be alphanumeric with : _ -"),
});

router.delete("/dashboard/alerts/dismissed", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (typeof userId !== "number") {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const companyId = getCompanyId(req);
    const { key } = undismissQuerySchema.parse(req.query);

    // Idempotent: deleting a non-existent dismissal still returns ok.
    // The (userId, companyId, alertKey) predicate enforces tenant +
    // owner scoping so a user cannot un-dismiss anyone else's row.
    await db
      .delete(alertDismissalsTable)
      .where(
        and(
          eq(alertDismissalsTable.userId, userId),
          eq(alertDismissalsTable.companyId, companyId),
          eq(alertDismissalsTable.alertKey, key),
        ),
      );

    res.json({ ok: true });
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.get("/dashboard/branch-performance", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const posScope = eq(posOrdersTable.companyId, companyId);
    const branchScope = eq(branchesTable.companyId, companyId);
    const today = startOfDay(new Date());
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(today);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const branches = await db
      .select()
      .from(branchesTable)
      .where(and(eq(branchesTable.isActive, true), branchScope));

    // Aggregate pos_orders → pos_sessions → branches for the last 7 days and previous 7 days.
    // pos_sessions has no companyId yet; we scope through posOrders.companyId which is the
    // authoritative tenant marker for sales data.
    const currentRows = await db
      .select({
        branchId: posSessionsTable.branchId,
        total: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
      })
      .from(posOrdersTable)
      .innerJoin(posSessionsTable, eq(posOrdersTable.sessionId, posSessionsTable.id))
      .where(and(gte(posOrdersTable.createdAt, sevenDaysAgo), posScope))
      .groupBy(posSessionsTable.branchId);

    const prevRows = await db
      .select({
        branchId: posSessionsTable.branchId,
        total: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
      })
      .from(posOrdersTable)
      .innerJoin(posSessionsTable, eq(posOrdersTable.sessionId, posSessionsTable.id))
      .where(
        and(
          gte(posOrdersTable.createdAt, fourteenDaysAgo),
          lt(posOrdersTable.createdAt, sevenDaysAgo),
          posScope,
        ),
      )
      .groupBy(posSessionsTable.branchId);

    const curMap = new Map<number, number>();
    for (const r of currentRows) curMap.set(r.branchId, Number(r.total));
    const prevMap = new Map<number, number>();
    for (const r of prevRows) prevMap.set(r.branchId, Number(r.total));

    const performance = branches.map((b) => {
      const sales = Math.round(curMap.get(b.id) ?? 0);
      const prev = prevMap.get(b.id) ?? 0;
      const change = pctChange(sales, prev);
      const status: "active" | "needs_attention" | "inactive" =
        change < -5 ? "needs_attention" : "active";
      return {
        id: b.id,
        name: b.nameAr,
        sales,
        change: Math.round(change),
        status,
      };
    });

    res.json(performance);
  } catch (err) {
    req.log.error({ err }, "Error fetching branch performance");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
