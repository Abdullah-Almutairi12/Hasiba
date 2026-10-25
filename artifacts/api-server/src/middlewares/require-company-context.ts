import type { Request, Response, NextFunction } from "express";
import { db, userCompaniesTable, usersTable, companiesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { isRole } from "./require-role";

/**
 * Ensure the request carries a valid `companyId` on its session, lazily
 * back-filling it from `user_companies` if missing (e.g. for sessions
 * minted before Phase 2 shipped). Routes mounted after this middleware
 * may safely call `getCompanyId(req)` / `scopedDb(req)`.
 *
 * Behaviour:
 *   - 401 if no userId on the session (defence in depth; `requireAuth`
 *     should already have run).
 *   - 403 if the user has no `user_companies` rows at all (unprovisioned
 *     account — should not happen post-backfill, but we refuse loudly
 *     instead of silently leaking unscoped data).
 *   - Sets `req.session.companyId` from the user's default row (or the
 *     most recently created one as a fallback) and continues.
 */
export async function requireCompanyContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.session?.purpose === "administration_receipt") {
    res.status(403).json({ error: "جلسة الاسترداد لا تتيح اختيار منشأة أو تشغيلها" });
    return;
  }
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "غير مسجل دخول" });
    return;
  }
  try {
    const [active] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.isActive, true)));
    if (!active) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }
    const [defaultRow] = await db
      .select({ companyId: userCompaniesTable.companyId, role: userCompaniesTable.role })
      .from(userCompaniesTable)
      .innerJoin(companiesTable, eq(companiesTable.id, userCompaniesTable.companyId))
      .where(and(eq(userCompaniesTable.userId, userId), eq(companiesTable.isActive, true),
        req.session.companyId
          ? eq(userCompaniesTable.companyId, req.session.companyId)
          : eq(userCompaniesTable.isDefault, true)))
      .limit(1);
    let membership = defaultRow;
    if (!membership && !req.session.companyId) {
      const [anyRow] = await db
        .select({ companyId: userCompaniesTable.companyId, role: userCompaniesTable.role })
        .from(userCompaniesTable)
        .innerJoin(companiesTable, eq(companiesTable.id, userCompaniesTable.companyId))
        .where(and(eq(userCompaniesTable.userId, userId), eq(companiesTable.isActive, true)))
        .orderBy(desc(userCompaniesTable.createdAt))
        .limit(1);
      membership = anyRow;
    }
    if (!membership || !isRole(membership.role)) {
      res.status(403).json({ error: "لا توجد شركة مرتبطة بهذا الحساب" });
      return;
    }
    req.session.companyId = membership.companyId;
    req.session.role = membership.role;
    req.session.save((err) => {
      if (err) {
        req.log.error({ err }, "session save in requireCompanyContext failed");
        res.status(500).json({ error: "حدث خطأ في الخادم" });
        return;
      }
      next();
    });
  } catch (err) {
    req.log.error({ err }, "requireCompanyContext failed");
    res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
}
