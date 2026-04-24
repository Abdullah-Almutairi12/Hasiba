import { Router } from "express";
import { db, usersTable, insertUserSchema } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

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

router.get("/users", async (req, res) => {
  try {
    const rows = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
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

router.post("/users", async (req, res) => {
  try {
    const parsed = insertUserSchema.parse(req.body);
    const [created] = await db.insert(usersTable).values(parsed).returning();
    res.status(201).json({
      ...created,
      lastLoginAt: created.lastLoginAt ? created.lastLoginAt.toISOString() : null,
      createdAt: created.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating user");
    res.status(400).json({ error: "Invalid request" });
  }
});

router.get("/users/roles", async (_req, res) => {
  res.json(ROLES);
});

export default router;
