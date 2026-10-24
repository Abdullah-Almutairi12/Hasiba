import { lockApprovalAuthorityWrite } from "../lib/approval-authority";
import { Router } from "express";
import { db, usersTable, branchesTable, userCompaniesTable, companiesTable } from "@workspace/db";
import { desc, eq, and, ne, inArray } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  requireRole,
  adminGuard,
  ownerOnly,
  ALL_ROLES,
} from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";
import { recordAudit } from "../lib/audit";
import { requireCompanyContext } from "../middlewares/require-company-context";
import { assertCompanyBranch } from "../lib/company-access";
import { isPublishedBootstrapPassword } from "../lib/bootstrap-password";
import { assertAnotherActiveOwner } from "../lib/company-ownership";

const router = Router();
router.use(["/users", "/admin/team-consents"], requireCompanyContext);

// Explicit safe column projection — NEVER include passwordHash in responses.
const safeUserColumns = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  phone: usersTable.phone,
  role: usersTable.role,
  branchId: usersTable.branchId,
  preferredBranchId: usersTable.preferredBranchId,
  avatarUrl: usersTable.avatarUrl,
  has2fa: usersTable.has2fa,
  isActive: usersTable.isActive,
  lastLoginAt: usersTable.lastLoginAt,
  createdAt: usersTable.createdAt,
} as const;

// ============== Roles catalogue (8 roles - Odoo/Zoho/SAP hybrid) ==============
const ROLES = [
  {
    key: "owner",
    name: "Owner / Super Admin",
    nameAr: "المالك / المسؤول الأعلى",
    description: "صلاحيات كاملة على النظام، الفروع، المالية، وإدارة المستخدمين",
    icon: "crown",
    color: "rose",
    requires2fa: true,
    permissions: ["all"],
  },
  {
    key: "manager",
    name: "General Manager",
    nameAr: "مدير عام",
    description: "إدارة العمليات والتقارير المالية وإدارة المستخدمين",
    icon: "user-tie",
    color: "purple",
    requires2fa: true,
    permissions: [
      "dashboard",
      "pos",
      "sales",
      "inventory",
      "invoices",
      "accounting",
      "reports",
      "marketing",
      "users.read",
      "branches",
    ],
  },
  {
    key: "accountant",
    name: "Accountant",
    nameAr: "محاسب",
    description: "القيود اليومية، الفواتير، التقارير الضريبية، والتصدير",
    icon: "calculator",
    color: "blue",
    requires2fa: true,
    permissions: ["accounting", "invoices", "reports", "exports"],
  },
  {
    key: "sales",
    name: "Sales Representative",
    nameAr: "مندوب مبيعات",
    description: "إدارة العملاء، عروض الأسعار، والمبيعات",
    icon: "trending-up",
    color: "cyan",
    requires2fa: false,
    permissions: ["pos", "sales", "customers", "products.read"],
  },
  {
    key: "cashier",
    name: "Cashier",
    nameAr: "كاشير",
    description: "إصدار الفواتير في نقطة البيع وإغلاق الصندوق",
    icon: "cash-register",
    color: "green",
    requires2fa: false,
    // Cashiers add walk-in customers from the POS; this matches Zoho/Odoo defaults.
    permissions: ["pos", "products.read", "customers.create"],
  },
  {
    key: "inventory",
    name: "Inventory Manager",
    nameAr: "مدير مخزون",
    description: "المنتجات، المستودعات، أوامر الشراء، وحركة المخزون",
    icon: "package",
    color: "amber",
    requires2fa: false,
    permissions: ["products", "inventory", "warehouses", "suppliers", "invoices.read"],
  },
  {
    key: "marketing",
    name: "Marketing Specialist",
    nameAr: "اختصاصي تسويق",
    description: "الحملات التسويقية، شرائح العملاء، والتحليلات",
    icon: "megaphone",
    color: "pink",
    requires2fa: false,
    permissions: ["marketing", "customers.read", "analytics.read", "exports.marketing"],
  },
  {
    key: "hr",
    name: "HR Specialist",
    nameAr: "موظف موارد بشرية",
    description: "إدارة الموظفين، العقود، الإجازات، والحضور",
    icon: "users",
    color: "teal",
    requires2fa: false,
    permissions: ["hr", "employees", "leaves", "attendance", "payroll.read"],
  },
  {
    key: "production",
    name: "Production / Manufacturing",
    nameAr: "إنتاج / تصنيع",
    description: "أوامر الإنتاج، قوائم المواد، مراكز العمل، فحوصات الجودة",
    icon: "factory",
    color: "indigo",
    requires2fa: false,
    permissions: ["manufacturing", "products.read", "inventory.read"],
  },
  {
    key: "auditor",
    name: "Auditor",
    nameAr: "مراقب / مدقق",
    description: "الاطلاع فقط على جميع البيانات، سجل التدقيق، والتقارير",
    icon: "magnifying-glass-chart",
    color: "orange",
    // Auditors get full read across the system + audit trail.
    requires2fa: false,
    permissions: ["read_only", "audit_logs", "reports.read", "exports.read"],
  },
] as const;

router.get("/users/roles", async (_req, res) => {
  res.json(ROLES);
});

router.get("/users", adminGuard, async (req, res) => {
  try {
    const rows = await db
      .select({ ...safeUserColumns, role: userCompaniesTable.role })
      .from(usersTable)
      .innerJoin(userCompaniesTable, and(
        eq(userCompaniesTable.userId, usersTable.id),
        eq(userCompaniesTable.companyId, req.session.companyId!),
      ))
      .orderBy(desc(usersTable.createdAt));
    res.json(
      rows.map((u) => ({
        ...u,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching users");
    res.status(500).json({ error: "Internal server error" });
  }
});

const RoleEnum = z.enum(ALL_ROLES);

const CreateUserBody = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().max(40).nullish(),
  password: z.string().min(8).max(200).refine(
    (value) => !isPublishedBootstrapPassword(value),
    "اختر كلمة مرور غير منشورة وغير مستخدمة للتجربة",
  ),
  role: RoleEnum,
  branchId: z.number().int().positive().nullish(),
  isActive: z.boolean().optional(),
  has2fa: z.boolean().optional(),
});

router.post("/users", adminGuard, async (req, res) => {
  try {
    const body = CreateUserBody.parse(req.body);
    if (body.branchId != null) await assertCompanyBranch(body.branchId, req.session.companyId!);
    const actorRole = req.session.role;
    // Only an existing owner can create a new owner.
    if (body.role === "owner" && actorRole !== "owner") {
      return res
        .status(403)
        .json({ error: "فقط المالك يمكنه إنشاء حساب مالك آخر" });
    }
    const passwordHash = await bcrypt.hash(body.password, 12);
    const created = await db.transaction(async (tx) => {
      await lockApprovalAuthorityWrite(tx);
      const [user] = await tx.insert(usersTable).values({
          name: body.name,
          email: body.email.toLowerCase(),
          phone: body.phone ?? null,
          passwordHash,
          role: body.role,
          branchId: body.branchId ?? null,
          isActive: body.isActive ?? true,
          has2fa: body.has2fa ?? false,
        }).returning(safeUserColumns);
      await tx.insert(userCompaniesTable).values({
        userId: user.id, companyId: req.session.companyId!, role: body.role, isDefault: true,
      });
      return user;
    });
    return res.status(201).json({
      ...created,
      lastLoginAt: created.lastLoginAt ? created.lastLoginAt.toISOString() : null,
      createdAt: created.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating user");
    return handleRouteError(err, res);
  }
});

const UpdateUserBody = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().max(40).nullish(),
  role: RoleEnum.optional(),
  branchId: z.number().int().positive().nullish(),
  isActive: z.boolean().optional(),
  has2fa: z.boolean().optional(),
  password: z.string().min(8).max(200).refine(
    (value) => !isPublishedBootstrapPassword(value),
    "اختر كلمة مرور غير منشورة وغير مستخدمة للتجربة",
  ).optional(),
});

router.patch("/users/:id", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "معرّف غير صحيح" });
    const body = UpdateUserBody.parse(req.body);
    const actorRole = req.session.role;

    const companyId = req.session.companyId!;
    const [membership] = await db.select().from(userCompaniesTable)
      .where(and(eq(userCompaniesTable.userId, id), eq(userCompaniesTable.companyId, companyId)));
    if (!membership) return res.status(404).json({ error: "المستخدم غير موجود" });
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!target) return res.status(404).json({ error: "المستخدم غير موجود" });

    // Owner-protection rules:
    // - Only owner can promote/demote owner.
    // - Only owner can edit another owner.
    if ((target.role === "owner" || membership.role === "owner") && actorRole !== "owner") {
      return res.status(403).json({ error: "لا يمكن تعديل حساب المالك" });
    }
    if (body.role === "owner" && actorRole !== "owner") {
      return res
        .status(403)
        .json({ error: "فقط المالك يمكنه ترقية مستخدم إلى مالك" });
    }

    if (body.branchId != null) await assertCompanyBranch(body.branchId, companyId);
    const memberships = await db.select().from(userCompaniesTable).where(eq(userCompaniesTable.userId, id));
    // Passwords, activation, and profile fields belong to the global identity.
    // A tenant administrator must not change an identity used in another company.
    const globalChange = Object.entries(body).some(([key, value]) => key !== "role" && value !== undefined);
    if (globalChange && memberships.some((m) => m.companyId !== companyId)) {
      return res.status(403).json({ error: "لا يمكن تعديل حساب مشترك مع شركة أخرى" });
    }
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.phone !== undefined) update.phone = body.phone;
    if (body.branchId !== undefined) update.branchId = body.branchId;
    if (body.isActive !== undefined) update.isActive = body.isActive;
    if (body.has2fa !== undefined) update.has2fa = body.has2fa;
    if (body.password !== undefined) update.passwordHash = await bcrypt.hash(body.password, 12);

    const updated = await db.transaction(async (tx) => {
      await lockApprovalAuthorityWrite(tx);
      await tx.select({ id: companiesTable.id }).from(companiesTable)
        .where(eq(companiesTable.id, companyId)).for("update");
      const [currentMembership] = await tx.select().from(userCompaniesTable)
        .where(and(eq(userCompaniesTable.userId, id), eq(userCompaniesTable.companyId, companyId))).limit(1);
      if (!currentMembership) throw Object.assign(new Error("المستخدم غير موجود"), { status: 404 });
      if (currentMembership.role === "owner" &&
        (body.isActive === false || (body.role !== undefined && body.role !== "owner"))) {
        await assertAnotherActiveOwner(tx, companyId, id);
      }
      if (body.role !== undefined) await tx.update(userCompaniesTable).set({ role: body.role })
        .where(and(eq(userCompaniesTable.userId, id), eq(userCompaniesTable.companyId, companyId)));
      if (Object.keys(update).length) await tx.update(usersTable).set(update).where(eq(usersTable.id, id));
      const [user] = await tx.select(safeUserColumns).from(usersTable).where(eq(usersTable.id, id));
      return { ...user, role: body.role ?? currentMembership.role };
    });
    return res.json({
      ...updated,
      lastLoginAt: updated.lastLoginAt ? updated.lastLoginAt.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error updating user");
    return handleRouteError(err, res);
  }
});

router.delete("/users/:id", ownerOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "معرّف غير صحيح" });
    if (id === req.session.userId) {
      return res.status(400).json({ error: "لا يمكنك حذف حسابك الخاص" });
    }
    // Never delete the last owner.
    const [target] = await db.select().from(userCompaniesTable).where(and(
      eq(userCompaniesTable.userId, id), eq(userCompaniesTable.companyId, req.session.companyId!),
    )).limit(1);
    if (!target) return res.status(404).json({ error: "المستخدم غير موجود" });
    // Removing access must not delete an identity used by another tenant.
    await db.transaction(async (tx) => {
      await lockApprovalAuthorityWrite(tx);
      const companyId = req.session.companyId!;
      await tx.select({ id: companiesTable.id }).from(companiesTable)
        .where(eq(companiesTable.id, companyId)).for("update");
      const [membership] = await tx.select().from(userCompaniesTable).where(and(
        eq(userCompaniesTable.userId, id), eq(userCompaniesTable.companyId, companyId),
      )).limit(1);
      if (!membership) throw Object.assign(new Error("المستخدم غير موجود"), { status: 404 });
      if (membership.role === "owner") await assertAnotherActiveOwner(tx, companyId, id);
      await tx.delete(userCompaniesTable).where(eq(userCompaniesTable.id, membership.id));
    });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting user");
    return handleRouteError(err, res);
  }
});

// Per-user UI preferences (e.g. preferred branch for the Retail liquidity
// view). Stored on the users row so it follows the manager across devices
// and browsers. Any authenticated user can read/write their own prefs.
const AuditConsentSchema = z
  .object({
    salesDetails: z.boolean().optional(),
    customerPii: z.boolean().optional(),
    locationContext: z.boolean().optional(),
  })
  .partial();

const UpdatePreferencesBody = z.object({
  preferredBranchId: z.number().int().positive().nullable().optional(),
  insightMode: z.boolean().optional(),
  auditConsent: AuditConsentSchema.optional(),
});

router.patch(
  "/users/me/preferences",
  requireRole(...ALL_ROLES),
  async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "غير مسجل دخول" });
      const body = UpdatePreferencesBody.parse(req.body);
      // When setting a non-null branch, verify it exists, is active, and
      // belongs to the caller's current company so a forged id can't be
      // persisted by a hostile or stale client.
      if (body.preferredBranchId !== undefined && body.preferredBranchId !== null) {
        const companyId = req.session.companyId;
        if (!companyId) {
          return res.status(400).json({ error: "لا توجد شركة نشطة" });
        }
        const [branch] = await db
          .select({ id: branchesTable.id })
          .from(branchesTable)
          .where(
            and(
              eq(branchesTable.id, body.preferredBranchId),
              eq(branchesTable.companyId, companyId),
              eq(branchesTable.isActive, true),
            ),
          )
          .limit(1);
        if (!branch) {
          return res.status(400).json({ error: "الفرع غير متاح" });
        }
      }

      // Build a partial patch — adminPrefs is a jsonb bag we merge into
      // so updating insightMode does not wipe lastAdminTab and vice
      // versa. preferredBranchId stays on its own column.
      const patch: Record<string, unknown> = {};
      if (body.preferredBranchId !== undefined) {
        patch["preferredBranchId"] = body.preferredBranchId;
      }
      if (body.insightMode !== undefined || body.auditConsent !== undefined) {
        const [existing] = await db
          .select({ adminPrefs: usersTable.adminPrefs })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        const merged = { ...(existing?.adminPrefs ?? {}) };
        if (body.insightMode !== undefined) merged.insightMode = body.insightMode;
        if (body.auditConsent !== undefined) {
          merged.auditConsent = {
            ...(merged.auditConsent ?? {}),
            ...body.auditConsent,
          };
          // Task #260 — stamp the moment the user touched their consent
          // (server clock, not client). Clears any pending re-confirm
          // request from an owner because the user has just re-spoken.
          merged.auditConsentUpdatedAt = new Date().toISOString();
          delete merged.auditConsentReconfirmRequestedAt;
          delete merged.auditConsentReconfirmRequestedBy;
        }
        patch["adminPrefs"] = merged;
      }

      // No-op safe-guard: if nothing was sent, just echo the current state.
      if (Object.keys(patch).length === 0) {
        const [current] = await db
          .select({
            preferredBranchId: usersTable.preferredBranchId,
            adminPrefs: usersTable.adminPrefs,
          })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        if (!current) return res.status(404).json({ error: "المستخدم غير موجود" });
        return res.json({
          preferredBranchId: current.preferredBranchId,
          adminPrefs: current.adminPrefs ?? {},
        });
      }

      const [updated] = await db
        .update(usersTable)
        .set(patch)
        .where(eq(usersTable.id, userId))
        .returning({
          preferredBranchId: usersTable.preferredBranchId,
          adminPrefs: usersTable.adminPrefs,
        });
      if (!updated) return res.status(404).json({ error: "المستخدم غير موجود" });
      return res.json({
        preferredBranchId: updated.preferredBranchId,
        adminPrefs: updated.adminPrefs ?? {},
      });
    } catch (err) {
      req.log.error({ err }, "Error updating user preferences");
      return handleRouteError(err, res);
    }
  },
);

// GET current user's preferences (Task #259). Returns the same shape
// PATCH /users/me/preferences echoes so the frontend can hydrate from
// the server on mount.
router.get(
  "/users/me/preferences",
  requireRole(...ALL_ROLES),
  async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "غير مسجل دخول" });
      const [row] = await db
        .select({
          preferredBranchId: usersTable.preferredBranchId,
          adminPrefs: usersTable.adminPrefs,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (!row) return res.status(404).json({ error: "المستخدم غير موجود" });
      return res.json({
        preferredBranchId: row.preferredBranchId,
        adminPrefs: row.adminPrefs ?? {},
      });
    } catch (err) {
      req.log.error({ err }, "Error fetching user preferences");
      return handleRouteError(err, res);
    }
  },
);

// GET current user's audit consent (Task #259). Returns defaults
// (everything allowed) merged with any stored adminPrefs.auditConsent
// so the Privacy & Consent UI always has a defined shape to render.
router.get(
  "/users/me/audit-consent",
  requireRole(...ALL_ROLES),
  async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "غير مسجل دخول" });
      const [row] = await db
        .select({ adminPrefs: usersTable.adminPrefs })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (!row) return res.status(404).json({ error: "المستخدم غير موجود" });
      const stored = row.adminPrefs?.auditConsent ?? {};
      return res.json({
        salesDetails: stored.salesDetails ?? true,
        customerPii: stored.customerPii ?? true,
        locationContext: stored.locationContext ?? true,
      });
    } catch (err) {
      req.log.error({ err }, "Error fetching audit consent");
      return handleRouteError(err, res);
    }
  },
);

// ============== Task #260 — Team Privacy / Audit consent overview ==============
// Owner-only view of every teammate's per-user audit consent
// settings (Task #259 facets: salesDetails / customerPii /
// locationContext). The owner is accountable for the company's
// audit posture, so they need a single page that surfaces overly
// restrictive choices (which may hide legitimate investigations)
// and stale defaults (where staff never engaged with the prompt).
//
// Scope: only users who belong to the OWNER's current company via
// `user_companies`. We never expose users from other tenants. We
// also exclude the owner themselves — their own consent already
// lives in /users/me/audit-consent and they bypass redaction
// anyway, so it is not actionable here.
const TEAM_CONSENT_DEFAULTS = {
  salesDetails: true,
  customerPii: true,
  locationContext: true,
} as const;

router.get("/admin/team-consents", ownerOnly, async (req, res) => {
  try {
    const companyId = req.session.companyId;
    const ownerId = req.session.userId;
    if (typeof companyId !== "number") {
      return res.status(400).json({ error: "لا توجد شركة نشطة" });
    }
    if (typeof ownerId !== "number") {
      return res.status(401).json({ error: "غير مسجل دخول" });
    }
    // Roster scoped to the current company. Inactive users are
    // included so the owner can still review/coach off-boarded
    // accounts.
    const memberships = await db
      .select({ userId: userCompaniesTable.userId, role: userCompaniesTable.role })
      .from(userCompaniesTable)
      .where(eq(userCompaniesTable.companyId, companyId));
    const memberIds = memberships
      .map((m) => m.userId)
      .filter((id) => id !== ownerId);
    if (memberIds.length === 0) return res.json([]);
    const roleByUser = new Map(memberships.map((m) => [m.userId, m.role]));
    const rows = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        isActive: usersTable.isActive,
        adminPrefs: usersTable.adminPrefs,
      })
      .from(usersTable)
      .where(inArray(usersTable.id, memberIds))
      .orderBy(usersTable.name);
    return res.json(
      rows.map((r) => {
        const ac = r.adminPrefs?.auditConsent ?? {};
        return {
          userId: r.id,
          name: r.name,
          email: r.email,
          role: roleByUser.get(r.id) ?? r.role,
          isActive: r.isActive,
          consent: {
            salesDetails: ac.salesDetails ?? TEAM_CONSENT_DEFAULTS.salesDetails,
            customerPii: ac.customerPii ?? TEAM_CONSENT_DEFAULTS.customerPii,
            locationContext:
              ac.locationContext ?? TEAM_CONSENT_DEFAULTS.locationContext,
          },
          isDefault:
            ac.salesDetails === undefined &&
            ac.customerPii === undefined &&
            ac.locationContext === undefined,
          lastChangedAt: r.adminPrefs?.auditConsentUpdatedAt ?? null,
          reconfirmRequestedAt:
            r.adminPrefs?.auditConsentReconfirmRequestedAt ?? null,
        };
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching team consents");
    return handleRouteError(err, res);
  }
});

router.post(
  "/admin/team-consents/:userId/request-reconfirm",
  ownerOnly,
  async (req, res) => {
    try {
      const targetId = Number(req.params.userId);
      if (!Number.isFinite(targetId)) {
        return res.status(400).json({ error: "معرّف غير صحيح" });
      }
      const companyId = req.session.companyId;
      const ownerId = req.session.userId;
      if (typeof companyId !== "number") {
        return res.status(400).json({ error: "لا توجد شركة نشطة" });
      }
      if (targetId === ownerId) {
        return res
          .status(400)
          .json({ error: "لا يمكنك طلب إعادة تأكيد من نفسك" });
      }
      // Verify the target belongs to the owner's current company.
      const [membership] = await db
        .select({ userId: userCompaniesTable.userId })
        .from(userCompaniesTable)
        .where(
          and(
            eq(userCompaniesTable.userId, targetId),
            eq(userCompaniesTable.companyId, companyId),
          ),
        )
        .limit(1);
      if (!membership) {
        return res.status(404).json({ error: "المستخدم غير موجود" });
      }
      const [existing] = await db
        .select({
          adminPrefs: usersTable.adminPrefs,
          name: usersTable.name,
        })
        .from(usersTable)
        .where(eq(usersTable.id, targetId))
        .limit(1);
      if (!existing) {
        return res.status(404).json({ error: "المستخدم غير موجود" });
      }
      const merged = { ...(existing.adminPrefs ?? {}) };
      merged.auditConsentReconfirmRequestedAt = new Date().toISOString();
      if (typeof ownerId === "number") {
        merged.auditConsentReconfirmRequestedBy = ownerId;
      }
      await db
        .update(usersTable)
        .set({ adminPrefs: merged })
        .where(eq(usersTable.id, targetId));
      void recordAudit(req, {
        action: "request_consent_reconfirm",
        entity: `user#${targetId}`,
        details: `طلب إعادة تأكيد إعدادات الخصوصية من المستخدم ${existing.name}`,
        severity: "info",
      });
      return res.json({
        ok: true,
        userId: targetId,
        reconfirmRequestedAt: merged.auditConsentReconfirmRequestedAt,
      });
    } catch (err) {
      req.log.error({ err }, "Error requesting consent reconfirm");
      return handleRouteError(err, res);
    }
  },
);

// Lightweight permissions endpoint — frontend uses it to drive sidebar / page guards.
router.get("/users/permissions", requireRole(...ALL_ROLES), async (req, res) => {
  const role = req.session.role;
  res.json({
    role,
    permissions: ROLES.find((r) => r.key === role)?.permissions ?? [],
  });
});

export default router;
