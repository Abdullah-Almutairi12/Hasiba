import { Router } from "express";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import type { AuditConsent } from "@workspace/db";
import { desc, inArray, ne, and, eq } from "drizzle-orm";
import { auditReadGuard, requireRole, ALL_ROLES } from "../middlewares/require-role";

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

// ============================================================
// Audit log read + per-user audit consent redaction (Task #259).
//
// Owners bypass redaction (they can see everything by design — they
// are accountable for the company). Every other viewer sees rows
// redacted per the ACTOR's stored `auditConsent`:
//   - salesDetails=false → monetary figures stripped from `details`
//   - customerPii=false  → `userName` replaced + emails/phones stripped
//   - locationContext=false → `ipAddress` nulled
//
// Redaction is read-time only; the underlying audit_logs row is
// preserved verbatim, so the audit chain itself is never tampered with.
// ============================================================

const REDACTED = "—";
const MONEY_RE = /\b\d{1,3}(?:[,\u066c]\d{3})+(?:[.\u066b]\d+)?|\b\d+(?:[.\u066b]\d+)?\s?(?:ر\.س|ريال|SAR)\b/giu;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s\-]{7,}\d/g;

function redactRow(
  row: typeof auditLogsTable.$inferSelect,
  consent: AuditConsent | null | undefined,
): Record<string, unknown> {
  const c: AuditConsent = consent ?? {};
  const salesDetails = c.salesDetails !== false;
  const customerPii = c.customerPii !== false;
  const locationContext = c.locationContext !== false;

  let details = row.details ?? null;
  if (details) {
    if (!salesDetails) details = details.replace(MONEY_RE, REDACTED);
    if (!customerPii) {
      details = details.replace(EMAIL_RE, REDACTED).replace(PHONE_RE, REDACTED);
    }
  }

  return {
    ...row,
    userName: customerPii ? row.userName : REDACTED,
    details,
    ipAddress: locationContext ? row.ipAddress : null,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/security/audit-logs", auditReadGuard, async (req, res) => {
  try {
    const companyId = req.session?.companyId;
    if (typeof companyId !== "number") {
      res.status(400).json({ error: "لا توجد شركة نشطة" });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.companyId, companyId))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    const viewerRole = req.session?.role;
    // Owner bypass: they see the raw rows so they can investigate.
    if (viewerRole === "owner") {
      res.json(
        rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      );
      return;
    }

    // Load consents for all distinct actors in a single round-trip.
    const actorIds = [
      ...new Set(rows.map((r) => r.userId).filter((id): id is number => typeof id === "number")),
    ];
    const consentByUserId = new Map<number, AuditConsent | undefined>();
    if (actorIds.length > 0) {
      const consentRows = await db
        .select({ id: usersTable.id, adminPrefs: usersTable.adminPrefs })
        .from(usersTable)
        .where(inArray(usersTable.id, actorIds));
      for (const cr of consentRows) {
        consentByUserId.set(cr.id, cr.adminPrefs?.auditConsent);
      }
    }

    res.json(rows.map((r) => redactRow(r, r.userId ? consentByUserId.get(r.userId) : undefined)));
  } catch (err) {
    req.log.error({ err }, "Error fetching audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /security/audit-access — "who else has been active in the audit
 * trail recently". Returns the last 50 audit rows whose actor is NOT
 * the current viewer, so any user can see at a glance who has been
 * touching data on the same tenant. The viewer's own consent does not
 * affect this list (they always see their fellow users' actions), but
 * the SAME read-time redaction is applied based on each actor's
 * consent, so privacy commitments still hold.
 */
router.get(
  "/security/audit-access",
  requireRole(...ALL_ROLES),
  async (req, res) => {
    try {
      const viewerId = req.session?.userId;
      const companyId = req.session?.companyId;
      if (typeof viewerId !== "number") {
        res.status(401).json({ error: "غير مسجل دخول" });
        return;
      }
      if (typeof companyId !== "number") {
        res.status(400).json({ error: "لا توجد شركة نشطة" });
        return;
      }
      const rows = await db
        .select()
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.companyId, companyId),
            ne(auditLogsTable.userId, viewerId),
          ),
        )
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(50);

      const viewerRole = req.session?.role;
      if (viewerRole === "owner") {
        res.json(
          rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        );
        return;
      }

      const actorIds = [
        ...new Set(rows.map((r) => r.userId).filter((id): id is number => typeof id === "number")),
      ];
      const consentByUserId = new Map<number, AuditConsent | undefined>();
      if (actorIds.length > 0) {
        const consentRows = await db
          .select({ id: usersTable.id, adminPrefs: usersTable.adminPrefs })
          .from(usersTable)
          .where(inArray(usersTable.id, actorIds));
        for (const cr of consentRows) {
          consentByUserId.set(cr.id, cr.adminPrefs?.auditConsent);
        }
      }
      res.json(
        rows.map((r) =>
          redactRow(r, r.userId ? consentByUserId.get(r.userId) : undefined),
        ),
      );
    } catch (err) {
      req.log.error({ err }, "Error fetching audit access ledger");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
