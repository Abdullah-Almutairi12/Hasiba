import { Router } from "express";
import { db, posOrdersTable, productsTable } from "@workspace/db";
import { sql, desc } from "drizzle-orm";

const router = Router();

router.get("/reports/sales", async (req, res) => {
  try {
    const period = (req.query.period as string) || "monthly";

    const labels =
      period === "daily"
        ? Array.from({ length: 24 }, (_, i) => `${i}:00`)
        : period === "weekly"
          ? ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
          : period === "monthly"
            ? Array.from({ length: 4 }, (_, i) => `الأسبوع ${i + 1}`)
            : ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

    const data = labels.map((label) => ({
      label,
      actual: Math.floor(25000 + Math.random() * 25000),
      forecast: Math.floor(27000 + Math.random() * 22000),
    }));

    const totalRevenue = data.reduce((sum, d) => sum + d.actual, 0);

    res.json({
      period,
      totalRevenue,
      totalProfit: totalRevenue * 0.41,
      totalOrders: Math.floor(totalRevenue / 85),
      avgOrderValue: 85 + Math.random() * 20,
      data,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching sales report");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/ai-summary", async (req, res) => {
  try {
    res.json({
      summary:
        'لاحظت انخفاضًا في مبيعات فرع "الرياض - العليا" بنسبة 12% مقارنة بالأسبوع الماضي، بينما حقق فرع "جدة" نموًا مفاجئًا بنسبة 8% بفضل العروض الجديدة. هناك 3 عمليات مشبوهة تتطلب مراجعتك في قسم كشف الاحتيال. يُنصح بمراجعة مستوى مخزون منتجات القهوة المختصة.',
      updatedAt: new Date().toISOString(),
      netProfitToday: 12450,
      profitChange: 4.2,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching AI summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/top-products", async (req, res) => {
  try {
    const products = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        nameAr: productsTable.nameAr,
      })
      .from(productsTable)
      .where(sql`${productsTable.isActive} = true`)
      .limit(5);

    const topProducts = products.map((p, i) => ({
      id: p.id,
      name: p.name,
      nameAr: p.nameAr,
      salesCount: [320, 280, 245, 198, 156][i] || 100,
      revenue: [5760, 4480, 3430, 2772, 1560][i] || 1000,
      change: [12, 8, -3, 5, 15][i] || 0,
    }));

    res.json(topProducts);
  } catch (err) {
    req.log.error({ err }, "Error fetching top products");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
