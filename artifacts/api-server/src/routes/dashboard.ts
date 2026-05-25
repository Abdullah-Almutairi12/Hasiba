import { Router } from "express";
import { db } from "@workspace/db";
import {
  productsTable,
  posOrdersTable,
  posSessionsTable,
  alertsTable,
  branchesTable,
  invoicesTable,
  auditLogsTable,
  intercompanyLinksTable,
} from "@workspace/db";
import { sql, gte, desc, and, lt, eq } from "drizzle-orm";
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

    const [alerts, staleData] = await Promise.all([alertsPromise, stalePromise]);

    const synthetic: Array<{
      id: number;
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
        const message = lastScan
          ? `لم يعمل الفحص الليلي لعدم التطابق بين الشركات منذ أكثر من 26 ساعة (آخر تشغيل: ${lastScan.createdAt.toISOString()}). افتح /intercompany?tab=imbalances للمراجعة.`
          : "لم يعمل الفحص الليلي لعدم التطابق بين الشركات بعد رغم وجود روابط بين شركات. افتح /intercompany?tab=imbalances للمراجعة.";
        synthetic.push({
          // Negative sentinel id keeps the synthetic row distinguishable
          // from real alerts.id (serial, always positive) and stable for
          // React list keys across polls.
          id: -1,
          type: "warning",
          title: "فحص عدم التطابق بين الشركات متأخر",
          message,
          isRead: false,
          createdAt: new Date().toISOString(),
          href: "/intercompany?tab=imbalances",
        });
      }
    }

    res.json([
      ...synthetic,
      ...alerts.map((a) => ({
        id: a.id,
        type: a.type,
        title: a.title,
        message: a.message,
        isRead: a.isRead,
        createdAt: a.createdAt.toISOString(),
      })),
    ]);
  } catch (err) {
    req.log.error({ err }, "Error fetching alerts");
    res.status(500).json({ error: "Internal server error" });
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
