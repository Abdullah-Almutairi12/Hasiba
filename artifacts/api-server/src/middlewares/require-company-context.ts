import type { Request, Response, NextFunction } from "express";
import { db, userCompaniesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

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
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "غير مسجل دخول" });
    return;
  }
  if (typeof req.session.companyId === "number" && req.session.companyId > 0) {
    next();
    return;
  }
  try {
    const [defaultRow] = await db
      .select({ companyId: userCompaniesTable.companyId })
      .from(userCompaniesTable)
      .where(and(eq(userCompaniesTable.userId, userId), eq(userCompaniesTable.isDefault, true)))
      .limit(1);
    let companyId = defaultRow?.companyId;
    if (!companyId) {
      const [anyRow] = await db
        .select({ companyId: userCompaniesTable.companyId })
        .from(userCompaniesTable)
        .where(eq(userCompaniesTable.userId, userId))
        .orderBy(desc(userCompaniesTable.createdAt))
        .limit(1);
      companyId = anyRow?.companyId;
    }
    if (!companyId) {
      res.status(403).json({ error: "لا توجد شركة مرتبطة بهذا الحساب" });
      return;
    }
    req.session.companyId = companyId;
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
