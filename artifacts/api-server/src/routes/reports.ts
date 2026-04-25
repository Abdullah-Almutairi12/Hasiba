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

router.get("/reports/insights", async (_req, res) => {
  res.json({
    netProfitToday: 12450,
    profitChange: 4.2,
    customerLifetimeValue: 1840,
    clvChange: 8.5,
    avgBenchmark: 1620,
    forecastNextWeek: 89500,
    forecastConfidence: 92,
    anomalies: [
      {
        title: "ارتفاع غير معتاد في طلبات القهوة المختصة",
        description: "زيادة 38% خلال الـ 24 ساعة الماضية مقارنة بالمعدل الطبيعي",
        severity: "positive",
        action: "اقتراح: زيادة المخزون قبل نهاية الأسبوع",
      },
      {
        title: "انخفاض في متوسط قيمة الفاتورة - فرع العليا",
        description: "متوسط الفاتورة 64 ر.س مقارنة بـ 82 ر.س الشهر الماضي",
        severity: "warning",
        action: "اقتراح: مراجعة عروض البيع المتقاطع",
      },
      {
        title: "نمو قاعدة العملاء الجدد",
        description: "23 عميل جديد مسجل هذا الأسبوع - أعلى من المتوسط بنسبة 18%",
        severity: "positive",
        action: "اقتراح: إطلاق برنامج ولاء للمحافظة عليهم",
      },
    ],
    benchmarks: [
      { metric: "هامش الربح", you: 41, industry: 35 },
      { metric: "نسبة العائد", you: 18, industry: 22 },
      { metric: "رضا العملاء", you: 4.7, industry: 4.2 },
      { metric: "سرعة دوران المخزون", you: 12, industry: 9 },
    ],
  });
});

router.get("/reports/fraud-detection", async (_req, res) => {
  res.json([
    {
      id: 1,
      type: "خصم مرتفع",
      description: "خصم 35% على فاتورة #1842 - يتجاوز الحد المسموح",
      branch: "فرع الرياض - العليا",
      cashier: "خالد العنزي",
      amount: 234.5,
      time: "قبل 12 دقيقة",
      severity: "high",
    },
    {
      id: 2,
      type: "إلغاء فاتورة",
      description: "إلغاء فاتورة بقيمة 1,250 ر.س بدون سبب موثّق",
      branch: "فرع جدة - التحلية",
      cashier: "نوره الحربي",
      amount: 1250,
      time: "قبل 47 دقيقة",
      severity: "critical",
    },
    {
      id: 3,
      type: "مرتجع غير مطابق",
      description: "مرتجع لمنتج لم يظهر في فاتورة الشراء الأصلية",
      branch: "فرع الدمام",
      cashier: "أحمد بن خالد",
      amount: 89,
      time: "قبل ساعتين",
      severity: "medium",
    },
    {
      id: 4,
      type: "نمط غير معتاد",
      description: "5 فواتير متتالية بنفس القيمة بالضبط من نفس الكاشير",
      branch: "فرع الرياض - الملز",
      cashier: "فيصل المطيري",
      amount: 45,
      time: "قبل 3 ساعات",
      severity: "medium",
    },
  ]);
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
