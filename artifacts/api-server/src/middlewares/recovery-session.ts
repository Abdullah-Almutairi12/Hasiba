import type { Request, Response, NextFunction } from "express";

/** A receipt credential is not a tenant login, even if memberships still exist. */
export function recoverySessionGate(req: Request, res: Response, next: NextFunction) {
  if (req.session?.purpose !== "administration_receipt") return next();
  const allowed = req.method === "POST" && [
    "/auth/login", "/auth/logout", "/auth/administration/recover",
  ].includes(req.path) ||
    req.method === "GET" && /^\/auth\/administration\/handovers\/[^/]+\/receipt$/.test(req.path) ||
    req.method === "POST" && /^\/auth\/administration\/handovers\/[^/]+\/complete$/.test(req.path);
  if (allowed) return next();
  res.status(403).json({ error: "جلسة استرداد إيصال فقط؛ سجل دخولًا عاديًا لاستخدام المنشأة" });
}
