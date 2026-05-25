import { Router } from "express";
import { db, usersTable, branchesTable } from "@workspace/db";
import { desc, eq, and, ne } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  requireRole,
  adminGuard,
  ownerOnly,
  ALL_ROLES,
} from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";

const router = Router();

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
      .select(safeUserColumns)
      .from(usersTable)
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
  password: z.string().min(8).max(200),
  role: RoleEnum,
  branchId: z.number().int().positive().nullish(),
  isActive: z.boolean().optional(),
  has2fa: z.boolean().optional(),
});

router.post("/users", adminGuard, async (req, res) => {
  try {
    const body = CreateUserBody.parse(req.body);
    const actorRole = req.session.role;
    // Only an existing owner can create a new owner.
    if (body.role === "owner" && actorRole !== "owner") {
      return res
        .status(403)
        .json({ error: "فقط المالك يمكنه إنشاء حساب مالك آخر" });
    }
    const passwordHash = await bcrypt.hash(body.password, 12);
    const [created] = await db
      .insert(usersTable)
      .values({
        name: body.name,
        email: body.email.toLowerCase(),
        phone: body.phone ?? null,
        passwordHash,
        role: body.role,
        branchId: body.branchId ?? null,
        isActive: body.isActive ?? true,
        has2fa: body.has2fa ?? false,
      })
      .returning(safeUserColumns);
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
  password: z.string().min(8).max(200).optional(),
});

router.patch("/users/:id", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "معرّف غير صحيح" });
    const body = UpdateUserBody.parse(req.body);
    const actorRole = req.session.role;

    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!target) return res.status(404).json({ error: "المستخدم غير موجود" });

    // Owner-protection rules:
    // - Only owner can promote/demote owner.
    // - Only owner can edit another owner.
    if (target.role === "owner" && actorRole !== "owner") {
      return res.status(403).json({ error: "لا يمكن تعديل حساب المالك" });
    }
    if (body.role === "owner" && actorRole !== "owner") {
      return res
        .status(403)
        .json({ error: "فقط المالك يمكنه ترقية مستخدم إلى مالك" });
    }

    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.phone !== undefined) update.phone = body.phone;
    if (body.role !== undefined) update.role = body.role;
    if (body.branchId !== undefined) update.branchId = body.branchId;
    if (body.isActive !== undefined) update.isActive = body.isActive;
    if (body.has2fa !== undefined) update.has2fa = body.has2fa;
    if (body.password !== undefined) update.passwordHash = await bcrypt.hash(body.password, 12);

    const [updated] = await db
      .update(usersTable)
      .set(update)
      .where(eq(usersTable.id, id))
      .returning(safeUserColumns);
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
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!target) return res.status(404).json({ error: "المستخدم غير موجود" });
    if (target.role === "owner") {
      const others = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.role, "owner"), ne(usersTable.id, id)));
      if (others.length === 0) {
        return res.status(400).json({ error: "لا يمكن حذف آخر مالك في النظام" });
      }
    }
    await db.delete(usersTable).where(eq(usersTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting user");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Per-user UI preferences (e.g. preferred branch for the Retail liquidity
// view). Stored on the users row so it follows the manager across devices
// and browsers. Any authenticated user can read/write their own prefs.
const UpdatePreferencesBody = z.object({
  preferredBranchId: z.number().int().positive().nullable(),
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
      if (body.preferredBranchId !== null) {
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
      const [updated] = await db
        .update(usersTable)
        .set({ preferredBranchId: body.preferredBranchId })
        .where(eq(usersTable.id, userId))
        .returning({ preferredBranchId: usersTable.preferredBranchId });
      if (!updated) return res.status(404).json({ error: "المستخدم غير موجود" });
      return res.json({ preferredBranchId: updated.preferredBranchId });
    } catch (err) {
      req.log.error({ err }, "Error updating user preferences");
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
