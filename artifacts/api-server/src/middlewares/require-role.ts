import type { Request, Response, NextFunction } from "express";

export type Role = "manager" | "accountant" | "cashier" | "auditor";

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.session?.role as Role | undefined;
    if (!userRole) {
      return res.status(401).json({ error: "غير مسجل دخول" });
    }
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: "ليس لديك صلاحية للوصول إلى هذه البيانات" });
    }
    next();
  };
}
