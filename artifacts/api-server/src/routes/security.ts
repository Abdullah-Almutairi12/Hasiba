import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { auditReadGuard } from "../middlewares/require-role";

const router = Router();

const CHECKLIST = [
  {
    key: "2fa",
    title: "تفعيل المصادقة الثنائية (2FA) للمسؤولين",
    description: "إلزامي لجميع الحسابات بصلاحية مدير نظام أو مدير مالي",
    status: "active",
    severity: "critical",
  },
  {
    key: "encryption",
    title: "تشفير البيانات الحساسة (AES-256)",
    description: "قواعد البيانات والنسخ الاحتياطي مشفرة بالكامل",
    status: "active",
    severity: "critical",
  },
  {
    key: "password_policy",
    title: "سياسة تغيير كلمة المرور الدورية",
    description: "يوصى بفرض تغيير كلمة المرور كل 90 يوماً لجميع الموظفين",
    status: "warning",
    severity: "medium",
  },
  {
    key: "audit_logs",
    title: "سجلات التدقيق غير قابلة للتعديل",
    description: "نظام WORM (Write Once, Read Many) مفعل للسجلات",
    status: "active",
    severity: "high",
  },
  {
    key: "backup",
    title: "النسخ الاحتياطي اليومي",
    description: "نسخ احتياطي تلقائي مشفر إلى التخزين السحابي يومياً",
    status: "active",
    severity: "high",
  },
  {
    key: "zatca",
    title: "ربط هيئة الزكاة (ZATCA Phase 2)",
    description: "الفوترة الإلكترونية المرتبطة بالهيئة (E-Invoicing)",
    status: "active",
    severity: "critical",
  },
];

const ROLE_MATRIX = [
  { permission: "الوصول للوحة القيادة", manager: true, accountant: true, cashier: false },
  { permission: "تعديل الأسعار", manager: true, accountant: false, cashier: false },
  { permission: "إصدار فواتير", manager: true, accountant: true, cashier: true },
  { permission: "إلغاء الفواتير", manager: true, accountant: true, cashier: false },
  { permission: "تعديل المخزون", manager: true, accountant: false, cashier: false },
  { permission: "عرض التقارير المالية", manager: true, accountant: true, cashier: false },
  { permission: "إدارة المستخدمين", manager: true, accountant: false, cashier: false },
];

router.get("/security/checklist", async (_req, res) => {
  const activeCount = CHECKLIST.filter((c) => c.status === "active").length;
  const score = Math.round((activeCount / CHECKLIST.length) * 100);
  res.json({
    score,
    ncaCompliant: score >= 80,
    items: CHECKLIST,
    roleMatrix: ROLE_MATRIX,
  });
});

router.get("/security/audit-logs", auditReadGuard, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await db
      .select()
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);
    res.json(
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
