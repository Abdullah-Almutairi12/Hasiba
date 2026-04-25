import { Router } from "express";
import { db, usersTable, insertUserSchema } from "@workspace/db";
import { desc } from "drizzle-orm";
import { requireRole } from "../middlewares/require-role";
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
  avatarUrl: usersTable.avatarUrl,
  has2fa: usersTable.has2fa,
  isActive: usersTable.isActive,
  lastLoginAt: usersTable.lastLoginAt,
  createdAt: usersTable.createdAt,
} as const;

const ROLES = [
  {
    key: "manager",
    name: "General Manager",
    nameAr: "مدير عام",
    description: "صلاحيات كاملة للتحكم في النظام والتقارير المالية",
    icon: "user-tie",
    color: "purple",
    requires2fa: true,
    permissions: ["all"],
  },
  {
    key: "accountant",
    name: "Accountant",
    nameAr: "محاسب",
    description: "إدارة الفواتير، التقارير الضريبية، والقيود اليومية",
    icon: "calculator",
    color: "blue",
    requires2fa: true,
    permissions: ["reports", "invoices", "accounting"],
  },
  {
    key: "cashier",
    name: "Cashier",
    nameAr: "كاشير",
    description: "إصدار الفواتير، المرتجعات المحدودة، وإغلاق الصندوق",
    icon: "cash-register",
    color: "green",
    requires2fa: false,
    permissions: ["pos", "sales"],
  },
  {
    key: "auditor",
    name: "Auditor",
    nameAr: "مراقب / مدقق",
    description: "الاطلاع فقط على العمليات والمخزون دون تعديل",
    icon: "magnifying-glass-chart",
    color: "orange",
    requires2fa: false,
    permissions: ["read_only"],
  },
];

router.get("/users", requireRole("manager"), async (req, res) => {
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
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching users");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/users", requireRole("manager"), async (req, res) => {
  try {
    const parsed = insertUserSchema.parse(req.body);
    // Re-select with safe columns to avoid leaking passwordHash on insert.
    const [created] = await db
      .insert(usersTable)
      .values(parsed)
      .returning(safeUserColumns);
    res.status(201).json({
      ...created,
      lastLoginAt: created.lastLoginAt ? created.lastLoginAt.toISOString() : null,
      createdAt: created.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating user");
    handleRouteError(err, res);
  }
});

router.get("/users/roles", async (_req, res) => {
  res.json(ROLES);
});

export default router;
