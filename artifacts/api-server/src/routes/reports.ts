import { Router, type RequestHandler } from "express";
import { db, posOrdersTable, productsTable } from "@workspace/db";
import { sql, gte, and, eq } from "drizzle-orm";
import { reportReadGuard } from "../middlewares/require-role";
import { getCompanyId } from "../lib/scoped-db";

const router = Router();

// These former responses were illustrations, not tenant-derived analyses.
// Keep genuine financial reports separate; never invent profits or accuse staff.
const unavailableAnalytics: RequestHandler = (_req, res) => {
  res.status(503).json({
    code: "REPORT_ANALYTICS_NOT_READY",
    error: "الملخص والتحليلات التلقائية غير متاحة حاليًا؛ لم تُربط بمصادر معتمدة لمنشأتك، ولا تُعرض أرقام أو تنبيهات افتراضية.",
  });
};

// Scope the guard to /reports/* paths only. Using router.use(guard) without a
// path would block requests to OTHER routers mounted after this one in the
// parent app — Express runs router-level middleware for every request that
// enters the router, regardless of whether a route matches.
router.use("/reports", reportReadGuard);

router.get("/reports/sales", async (req, res) => {
  try {
    // Tenant scope: every aggregation below must filter by the caller's
    // company_id. pos_orders + products both have NOT NULL company_id.
    const companyId = getCompanyId(req);
    const posScope = eq(posOrdersTable.companyId, companyId);
    const prodScope = eq(productsTable.companyId, companyId);
    const period = (req.query.period as string) || "monthly";
    const now = new Date();

    let bucketExpr: ReturnType<typeof sql>;
    let labels: string[];
    let startDate: Date;

    if (period === "daily") {
      labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      bucketExpr = sql`extract(hour from ${posOrdersTable.createdAt})::int`;
    } else if (period === "weekly") {
      labels = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
      bucketExpr = sql`extract(dow from ${posOrdersTable.createdAt})::int`;
    } else if (period === "monthly") {
      labels = ["الأسبوع 1", "الأسبوع 2", "الأسبوع 3", "الأسبوع 4"];
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 27);
      startDate.setHours(0, 0, 0, 0);
      bucketExpr = sql`floor(extract(epoch from ${posOrdersTable.createdAt} - ${startDate.toISOString()}::timestamp) / (7 * 86400))::int`;
    } else {
      labels = [
        "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
        "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
      ];
      startDate = new Date(now.getFullYear(), 0, 1);
      bucketExpr = sql`extract(month from ${posOrdersTable.createdAt})::int - 1`;
    }

    const rows = await db
      .select({
        bucket: bucketExpr.as("bucket"),
        total: sql<string>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
        cnt: sql<string>`count(*)`,
      })
      .from(posOrdersTable)
      .where(and(gte(posOrdersTable.createdAt, startDate), posScope))
      .groupBy(sql`bucket`);

    const map = new Map<number, { total: number; cnt: number }>();
    for (const r of rows) {
      map.set(Number(r.bucket), { total: Number(r.total), cnt: Number(r.cnt) });
    }

    const data = labels.map((label, i) => {
      const v = map.get(i) ?? { total: 0, cnt: 0 };
      const prior = labels.slice(0, i).map((_, j) => map.get(j)?.total ?? 0);
      const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : v.total;
      return {
        label,
        actual: Math.round(v.total),
        forecast: Math.round(avg * 1.05) || Math.round(v.total),
      };
    });

    const totalRevenue = data.reduce((sum, d) => sum + d.actual, 0);
    const totalOrders = Array.from(map.values()).reduce((s, v) => s + v.cnt, 0);

    // Real margin from product catalog
    const [marginRow] = await db
      .select({
        avgMargin: sql<string>`coalesce(avg((${productsTable.price}::numeric - ${productsTable.costPrice}::numeric) / nullif(${productsTable.price}::numeric, 0)), 0.30)`,
      })
      .from(productsTable)
      .where(and(sql`${productsTable.isActive} = true`, prodScope));
    const margin = Number(marginRow.avgMargin);

    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    res.json({
      period,
      totalRevenue,
      totalProfit: Math.round(totalRevenue * margin),
      totalOrders,
      avgOrderValue: Number(avgOrderValue.toFixed(2)),
      data,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching sales report");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/ai-summary", unavailableAnalytics);
router.get("/reports/insights", unavailableAnalytics);
router.get("/reports/fraud-detection", unavailableAnalytics);

router.get("/reports/top-products", async (req, res) => {
  try {
    // Aggregate items from pos_orders.items JSONB. Each item: {productId, quantity, price}.
    // Tenant scope: filter both the CTE source (pos_orders) and the outer SELECT (products)
    // by company_id so one tenant's report cannot include another tenant's lines/products.
    const companyId = getCompanyId(req);
    const rows = await db.execute(sql`
      WITH expanded AS (
        SELECT
          (item->>'productId')::int AS product_id,
          coalesce((item->>'quantity')::int, 1) AS qty,
          coalesce((item->>'price')::numeric, 0) AS price
        FROM ${posOrdersTable},
        jsonb_array_elements(${posOrdersTable.items}) AS item
        WHERE ${posOrdersTable.companyId} = ${companyId}
      )
      SELECT
        p.id,
        p.name,
        p.name_ar AS "nameAr",
        coalesce(sum(e.qty), 0)::int AS "salesCount",
        coalesce(sum(e.qty * e.price), 0)::numeric AS revenue
      FROM ${productsTable} p
      LEFT JOIN expanded e ON e.product_id = p.id
      WHERE p.is_active = true
        AND p.company_id = ${companyId}
      GROUP BY p.id, p.name, p.name_ar
      ORDER BY "salesCount" DESC
      LIMIT 5
    `);

    const topProducts = (rows.rows as Array<{
      id: number;
      name: string;
      nameAr: string;
      salesCount: number;
      revenue: string | number;
    }>).map((p) => ({
      id: p.id,
      name: p.name,
      nameAr: p.nameAr,
      salesCount: Number(p.salesCount),
      revenue: Math.round(Number(p.revenue)),
      change: 0,
    }));

    res.json(topProducts);
  } catch (err) {
    req.log.error({ err }, "Error fetching top products");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
