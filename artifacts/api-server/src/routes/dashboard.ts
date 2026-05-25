import { Router } from "express";
import { db } from "@workspace/db";
import {
  productsTable,
  posOrdersTable,
  posSessionsTable,
  alertsTable,
  branchesTable,
  invoicesTable,
} from "@workspace/db";
import { sql, gte, desc, and, lt, eq } from "drizzle-orm";
import { adminGuard } from "../middlewares/require-role";
import { getCompanyId } from "../lib/scoped-db";

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

    // Tenant scope: scoped tables use `company_id`, and rows may exist with
    // a NULL company_id from legacy backfill — treat NULL as "any company".
    const posScope = sql`(${posOrdersTable.companyId} = ${companyId} OR ${posOrdersTable.companyId} IS NULL)`;
    const invScope = sql`(${invoicesTable.companyId} = ${companyId} OR ${invoicesTable.companyId} IS NULL)`;
    const prodScope = sql`(${productsTable.companyId} = ${companyId} OR ${productsTable.companyId} IS NULL)`;
    const alertScope = sql`(${alertsTable.companyId} = ${companyId} OR ${alertsTable.companyId} IS NULL)`;

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
      .where(gte(posOrdersTable.createdAt, today));

    const [yestAgg] = await db
      .select({
        total: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
      })
      .from(posOrdersTable)
      .where(
        and(gte(posOrdersTable.createdAt, yesterday), lt(posOrdersTable.createdAt, today)),
      );

    // Real margin from product catalog (avg)
    const [marginRow] = await db
      .select({
        avgMargin: sql<string>`coalesce(avg((${productsTable.price}::numeric - ${productsTable.costPrice}::numeric) / nullif(${productsTable.price}::numeric, 0)), 0.30)`,
      })
      .from(productsTable)
      .where(sql`${productsTable.isActive} = true`);

    const [productStats] = await db
      .select({
        inventoryValue: sql<string>`coalesce(sum(${productsTable.costPrice}::numeric * ${productsTable.stock}), 0)`,
        lowStockCount: sql<string>`count(*) filter (where ${productsTable.stock} <= ${productsTable.minStock})`,
      })
      .from(productsTable)
      .where(sql`${productsTable.isActive} = true`);

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
      .where(sql`${productsTable.isActive} = true`);
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
      .where(gte(posOrdersTable.createdAt, startDate))
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
    const alerts = await db
      .select()
      .from(alertsTable)
      .orderBy(desc(alertsTable.createdAt))
      .limit(10);

    res.json(
      alerts.map((a) => ({
        id: a.id,
        type: a.type,
        title: a.title,
        message: a.message,
        isRead: a.isRead,
        createdAt: a.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/branch-performance", async (req, res) => {
  try {
    const today = startOfDay(new Date());
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(today);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const branches = await db
      .select()
      .from(branchesTable)
      .where(eq(branchesTable.isActive, true));

    // Aggregate pos_orders → pos_sessions → branches for the last 7 days and previous 7 days
    const currentRows = await db
      .select({
        branchId: posSessionsTable.branchId,
        total: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
      })
      .from(posOrdersTable)
      .innerJoin(posSessionsTable, eq(posOrdersTable.sessionId, posSessionsTable.id))
      .where(gte(posOrdersTable.createdAt, sevenDaysAgo))
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
