import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/auth/login", async (req, res) => {
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

    // Regenerate session ID to prevent session fixation attacks
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log.error({ err: regenErr }, "Session regenerate failed");
        return res.status(500).json({ error: "حدث خطأ في الخادم" });
      }
      req.session.userId = user.id;
      req.session.role = user.role as typeof req.session.role;
      req.session.save((saveErr) => {
        if (saveErr) {
          req.log.error({ err: saveErr }, "Session save failed");
          return res.status(500).json({ error: "حدث خطأ في الخادم" });
        }
        res.json({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchId: user.branchId,
          avatarUrl: user.avatarUrl,
        });
      });
    });
  } catch (err) {
    req.log.error({ err }, "Login failed");
    res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Logout failed");
      return res.status(500).json({ error: "تعذر تسجيل الخروج" });
    }
    res.clearCookie("hasba.sid");
    res.json({ ok: true });
  });
});

// Public signup is for the very first company owner. The role is fixed
// server-side — clients cannot self-assign privileged roles. Additional
// users (with elevated roles) must be created by an authenticated admin
// through the user management flow.
const SignupBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

router.post("/auth/signup", async (req, res) => {
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

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(usersTable)
      .values({
        name,
        email: normalizedEmail,
        passwordHash,
        // Role is intentionally fixed for public signup. Do NOT trust
        // anything from the request body here.
        role: "manager",
        isActive: true,
      })
      .returning();

    // Regenerate session ID after signup to prevent session fixation
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log.error({ err: regenErr }, "Session regenerate failed");
        return res.status(500).json({ error: "حدث خطأ في الخادم" });
      }
      req.session.userId = user.id;
      req.session.role = user.role as typeof req.session.role;
      req.session.save((saveErr) => {
        if (saveErr) {
          req.log.error({ err: saveErr }, "Session save failed");
          return res.status(500).json({ error: "حدث خطأ في الخادم" });
        }
        res.status(201).json({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchId: user.branchId,
          avatarUrl: user.avatarUrl,
        });
      });
    });
  } catch (err) {
    req.log.error({ err }, "Signup failed");
    res.status(500).json({ error: "حدث خطأ في الخادم" });
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

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
      avatarUrl: user.avatarUrl,
    });
  } catch (err) {
    req.log.error({ err }, "Auth me failed");
    res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

export default router;
