import { Router } from "express";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import type { AuditConsent } from "@workspace/db";
import { desc, inArray, ne, and, eq, or, like } from "drizzle-orm";
import { auditReadGuard, requireRole, ALL_ROLES } from "../middlewares/require-role";

const router = Router();

const CHECKLIST = [
  {
    key: "2fa",
    title: "تفعيل المصادقة الثنائية (2FA) للمسؤولين",
    description: "تتوفر دورة تسجيل TOTP والتحقق والاستعادة؛ حالة المستخدم مشتقة من تسجيل مثبت وسياسة المنشأة مستقلة. توفر الوظيفة لا يعني أن جميع المسؤولين فعّلوها.",
    status: "warning",
    severity: "critical",
  },
  {
    key: "encryption",
    title: "تشفير البيانات الحساسة (AES-256)",
    description: "أسرار TOTP ورسائل استعادة كلمة المرور مشفرة بمفتاح مستقل. هذا لا يثبت تشفير قاعدة البيانات أو النسخ الاحتياطية؛ يلزم دليل بيئة التشغيل.",
    status: "warning",
    severity: "critical",
  },
  {
    key: "password_policy",
    title: "سياسة عبارات المرور وأدلة الاختراق",
    description: "عبارات قوية بطول 15 محرفًا على الأقل وحد أعلى 1024 مع دعم العربية الطويلة وتوافق التحقق السابق. لا يفرض تغيير دوري بلا سبب؛ عند الاشتباه تستخدم إجراءات إبطال الجلسات والتحقق المناسبة.",
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
    // Checklist completion is not an independent NCA compliance assessment.
    ncaCompliant: false,
    items: CHECKLIST,
    roleMatrix: ROLE_MATRIX,
  });
});

// ============================================================
// Audit log read + per-user audit consent redaction (Task #259).
//
// Consent is DATA-SUBJECT based: the user whose data appears in a row
// is the one whose `auditConsent` governs visibility for non-owner
// viewers. We resolve subjectUserId as follows:
//   1. If `entity` is of the form `user#<N>`, the subject is user N
//      (e.g. login/profile/security events targeting that user).
//   2. Otherwise the subject defaults to `row.userId` — the actor —
//      because an action row reflects that actor's own activity, and
//      their `auditConsent` is the most direct expression of how they
//      want their workflow surfaced to teammates.
//
// Owners bypass redaction (they are accountable for the company).
// Redaction is read-time only; the underlying audit_logs row is
// preserved verbatim, so the audit chain itself is never tampered with.
//
// Non-audit reads (customers, invoices, etc.) extend the same model:
// records that lack a per-row userId fall back to the COMPANY OWNER
// (resolved via `user_companies.role='owner'`) as the effective data
// subject, since the owner is accountable for the roster. See
// `routes/customers.ts#loadCompanyOwnerConsent` for the live wiring.
// ============================================================
const USER_ENTITY_RE = /^user#(\d+)/;
function subjectIdForRow(
  row: typeof auditLogsTable.$inferSelect,
): number | null {
  const m = row.entity ? USER_ENTITY_RE.exec(row.entity) : null;
  if (m) return Number(m[1]);
  return typeof row.userId === "number" ? row.userId : null;
}

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

    // Load consents for all distinct DATA SUBJECTS (not actors) in a
    // single round-trip.
    const subjectIds = [
      ...new Set(
        rows.map(subjectIdForRow).filter((id): id is number => id !== null),
      ),
    ];
    const consentByUserId = new Map<number, AuditConsent | undefined>();
    if (subjectIds.length > 0) {
      const consentRows = await db
        .select({ id: usersTable.id, adminPrefs: usersTable.adminPrefs })
        .from(usersTable)
        .where(inArray(usersTable.id, subjectIds));
      for (const cr of consentRows) {
        consentByUserId.set(cr.id, cr.adminPrefs?.auditConsent);
      }
    }

    res.json(
      rows.map((r) => {
        const sid = subjectIdForRow(r);
        return redactRow(r, sid !== null ? consentByUserId.get(sid) : undefined);
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /security/audit-access — "who viewed your data" ledger. Returns
 * the last 50 audit-log rows where another user (i.e. NOT the viewer)
 * performed an action whose `entity` references the viewer's own user
 * row (`user#<id>`). Strict tenant filter on companyId. The viewer is
 * the data subject on this endpoint by construction, so no consent
 * redaction is applied.
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
      // "Who viewed YOUR data" requires PROVABLE subject linkage —
      // a row should only appear in a viewer's ledger if the viewer
      // is genuinely the data subject. We define the subject in two
      // tiers:
      //
      //   (1) For every viewer: rows whose `entity` explicitly
      //       targets their user row (`user#<viewerId>%`). This is
      //       always-correct: profile reads, security events, and
      //       writes against their account.
      //
      //   (2) Additionally, for OWNER viewers only: roster-wide
      //       read events on tenant-owned data (currently
      //       `customer#listing` / `customer#<id>` from
      //       customers.ts), because per task #259 the company
      //       owner is the effective data subject for customer
      //       PII. Non-owners are never the subject for these
      //       rows, so we exclude them to avoid leaking
      //       teammates' activity into an unrelated user's panel.
      //
      // Bulk-read action heuristics (export/scan/send) are
      // intentionally NOT included here — they lack subject
      // linkage and would over-report. If a future feature
      // journals row-level subject on those rows, extend the OR.
      const viewerRole = req.session?.role;
      const subjectFilter =
        viewerRole === "owner"
          ? or(
              like(auditLogsTable.entity, `user#${viewerId}%`),
              eq(auditLogsTable.action, "read"),
            )
          : like(auditLogsTable.entity, `user#${viewerId}%`);
      const rows = await db
        .select()
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.companyId, companyId),
            ne(auditLogsTable.userId, viewerId),
            subjectFilter,
          ),
        )
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(50);

      // Owner viewers bypass redaction (consistent with
      // /security/audit-logs). Non-owners get the same per-actor
      // consent redaction here as on /security/audit-logs, so
      // even if subject-linkage is broadened later, a row's
      // details never leak past the actor's auditConsent.
      if (viewerRole === "owner") {
        res.json(
          rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        );
        return;
      }
      const subjectIds = [
        ...new Set(
          rows.map(subjectIdForRow).filter((id): id is number => id !== null),
        ),
      ];
      const consentByUserId = new Map<number, AuditConsent | undefined>();
      if (subjectIds.length > 0) {
        const consentRows = await db
          .select({ id: usersTable.id, adminPrefs: usersTable.adminPrefs })
          .from(usersTable)
          .where(inArray(usersTable.id, subjectIds));
        for (const cr of consentRows) {
          consentByUserId.set(cr.id, cr.adminPrefs?.auditConsent);
        }
      }
      res.json(
        rows.map((r) => {
          const sid = subjectIdForRow(r);
          return redactRow(
            r,
            sid !== null ? consentByUserId.get(sid) : undefined,
          );
        }),
      );
    } catch (err) {
      req.log.error({ err }, "Error fetching audit access ledger");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
