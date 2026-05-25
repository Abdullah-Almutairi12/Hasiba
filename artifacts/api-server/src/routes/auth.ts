import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db, usersTable, userCompaniesTable, companiesTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";

/**
 * Look up the company the user should land in after login. Returns the
 * `is_default = true` row when present, otherwise the most recently
 * created membership, otherwise `null` (caller decides what to do).
 */
async function resolveLoginCompanyId(userId: number): Promise<number | null> {
  const [def] = await db
    .select({ companyId: userCompaniesTable.companyId })
    .from(userCompaniesTable)
    .where(and(eq(userCompaniesTable.userId, userId), eq(userCompaniesTable.isDefault, true)))
    .limit(1);
  if (def?.companyId) return def.companyId;
  const [any] = await db
    .select({ companyId: userCompaniesTable.companyId })
    .from(userCompaniesTable)
    .where(eq(userCompaniesTable.userId, userId))
    .orderBy(desc(userCompaniesTable.createdAt))
    .limit(1);
  return any?.companyId ?? null;
}

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "محاولات كثيرة جداً، يرجى المحاولة لاحقاً" },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "تم تجاوز الحد المسموح من إنشاء الحسابات، يرجى المحاولة لاحقاً" },
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "بيانات غير صحيحة" });
    }
    const { email, password } = parsed.data;

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: "هذا الحساب غير مفعل" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    }

    await db
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, user.id));

    const companyId = await resolveLoginCompanyId(user.id);
    if (!companyId) {
      return res
        .status(403)
        .json({ error: "لا توجد شركة مرتبطة بهذا الحساب — تواصل مع المدير" });
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log.error({ err: regenErr }, "Session regenerate failed");
        res.status(500).json({ error: "حدث خطأ في الخادم" });
        return;
      }
      req.session.userId = user.id;
      req.session.role = user.role as typeof req.session.role;
      req.session.companyId = companyId;
      req.session.save((saveErr) => {
        if (saveErr) {
          req.log.error({ err: saveErr }, "Session save failed");
          res.status(500).json({ error: "حدث خطأ في الخادم" });
          return;
        }
        res.json({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchId: user.branchId,
          preferredBranchId: user.preferredBranchId,
          avatarUrl: user.avatarUrl,
          companyId,
        });
      });
    });
    return;
  } catch (err) {
    req.log.error({ err }, "Login failed");
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Logout failed");
      res.status(500).json({ error: "تعذر تسجيل الخروج" });
      return;
    }
    res.clearCookie("hasba.sid");
    res.json({ ok: true });
  });
});

const SignupBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

router.post("/auth/signup", signupLimiter, async (req, res) => {
  try {
    const parsed = SignupBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "بيانات غير صحيحة" });
    }
    const { name, email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    // New self-serve signup is treated as a brand-new tenant: we create a
    // company row and grant the freshly-minted manager full owner-style
    // access to it via user_companies. Phase 3 will expose a UI to invite
    // additional users into the same company.
    const { user, companyId } = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(usersTable)
        .values({
          name,
          email: normalizedEmail,
          passwordHash,
          role: "manager",
          isActive: true,
        })
        .returning();
      const [c] = await tx
        .insert(companiesTable)
        .values({ name: `شركة ${name}` })
        .returning({ id: companiesTable.id });
      await tx.insert(userCompaniesTable).values({
        userId: u.id,
        companyId: c.id,
        role: "manager",
        isDefault: true,
      });
      return { user: u, companyId: c.id };
    });

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log.error({ err: regenErr }, "Session regenerate failed");
        res.status(500).json({ error: "حدث خطأ في الخادم" });
        return;
      }
      req.session.userId = user.id;
      req.session.role = user.role as typeof req.session.role;
      req.session.companyId = companyId;
      req.session.save((saveErr) => {
        if (saveErr) {
          req.log.error({ err: saveErr }, "Session save failed");
          res.status(500).json({ error: "حدث خطأ في الخادم" });
          return;
        }
        res.status(201).json({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchId: user.branchId,
          preferredBranchId: user.preferredBranchId,
          avatarUrl: user.avatarUrl,
          companyId,
        });
      });
    });
    return;
  } catch (err) {
    req.log.error({ err }, "Signup failed");
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

router.get("/auth/me", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "غير مسجل دخول" });
    }
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId))
      .limit(1);

    if (!user || !user.isActive) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "غير مسجل دخول" });
    }

    // Multi-Company Phase 3: surface every tenant the user can switch
    // into so the UI can render a switcher without an extra round-trip.
    const memberships = await db
      .select({
        id: companiesTable.id,
        name: companiesTable.name,
        role: userCompaniesTable.role,
        isDefault: userCompaniesTable.isDefault,
        isActive: companiesTable.isActive,
      })
      .from(userCompaniesTable)
      .innerJoin(companiesTable, eq(companiesTable.id, userCompaniesTable.companyId))
      .where(eq(userCompaniesTable.userId, user.id));

    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
      preferredBranchId: user.preferredBranchId,
      avatarUrl: user.avatarUrl,
      companyId: req.session.companyId ?? null,
      companies: memberships.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        isDefault: m.isDefault,
        isActive: m.isActive,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Auth me failed");
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

const SwitchCompanyBody = z.object({
  companyId: z.number().int().positive(),
});

/**
 * POST /auth/switch-company — flip the active tenant on the session.
 * Verifies the caller has a `user_companies` row for the target company
 * before mutating the session. Returns the new active companyId so the
 * frontend can immediately invalidate its query cache (Phase 4).
 */
router.post("/auth/switch-company", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "غير مسجل دخول" });
    }
    const parsed = SwitchCompanyBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "بيانات غير صحيحة" });
    }
    const userId = req.session.userId;
    const { companyId } = parsed.data;

    const [membership] = await db
      .select({
        companyId: userCompaniesTable.companyId,
        role: userCompaniesTable.role,
        isActive: companiesTable.isActive,
      })
      .from(userCompaniesTable)
      .innerJoin(companiesTable, eq(companiesTable.id, userCompaniesTable.companyId))
      .where(
        and(
          eq(userCompaniesTable.userId, userId),
          eq(userCompaniesTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!membership) {
      return res.status(403).json({
        error: "INVALID_REFERENCE",
        message: "ليس لديك وصول إلى هذه الشركة",
      });
    }
    if (!membership.isActive) {
      return res.status(409).json({
        error: "COMPANY_INACTIVE",
        message: "هذه الشركة معطّلة",
      });
    }

    req.session.companyId = companyId;
    req.session.save((saveErr) => {
      if (saveErr) {
        req.log.error({ err: saveErr }, "Session save failed in switch-company");
        res.status(500).json({ error: "حدث خطأ في الخادم" });
        return;
      }
      res.json({ companyId, role: membership.role });
    });
    return;
  } catch (err) {
    req.log.error({ err }, "Switch company failed");
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

export default router;
