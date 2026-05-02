import type { Request, Response, NextFunction } from "express";

export const ALL_ROLES = [
  "owner",
  "manager",
  "accountant",
  "sales",
  "cashier",
  "inventory",
  "marketing",
  "auditor",
] as const;

export type Role = (typeof ALL_ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = req.session?.role as Role | undefined;
    if (!userRole) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }
    if (!roles.includes(userRole)) {
      res.status(403).json({ error: "ليس لديك صلاحية للوصول إلى هذه البيانات" });
      return;
    }
    next();
  };
}

// Named role groups (Odoo / Zoho / SAP hybrid).
// owner  = founder / super-admin (system + financial god-mode).
// manager = branch / department admin (cannot delete owner-level data).
// accountant = full finance: ledger, invoices, exports.
// sales = quotes, customers write, but no finance.
// cashier = POS only (own till + branch reads).
// inventory = stock, purchases, warehouses.
// marketing = campaigns, segments, reads sales.
// auditor = read-only across the system + audit trail.

export const adminGuard = requireRole("owner", "manager");
export const ownerOnly = requireRole("owner");
export const financeGuard = requireRole("owner", "manager", "accountant");
export const salesWriteGuard = requireRole("owner", "manager", "sales", "cashier");
export const posGuard = requireRole("owner", "manager", "sales", "cashier");
export const inventoryGuard = requireRole("owner", "manager", "inventory");
export const marketingGuard = requireRole("owner", "manager", "marketing");
export const reportReadGuard = requireRole(
  "owner",
  "manager",
  "accountant",
  "auditor",
);
export const exportsGuard = requireRole(
  "owner",
  "manager",
  "accountant",
  "auditor",
  "inventory",
  "marketing",
);
// Permission to read company-wide analytics / forecasts.
export const analyticsReadGuard = requireRole(
  "owner",
  "manager",
  "accountant",
  "marketing",
  "auditor",
);

// Read guards for sensitive datasets that contain financial / supplier
// information. These are intentionally narrower than `requireAuth`:
// the cashier and marketing roles, for example, must NOT read the supplier
// ledger or supplier-side invoices.
export const invoiceReadGuard = requireRole(
  "owner",
  "manager",
  "accountant",
  "inventory",
  "auditor",
);
export const supplierReadGuard = requireRole(
  "owner",
  "manager",
  "accountant",
  "inventory",
  "auditor",
);
// POS sessions / orders / summaries: operational + finance roles.
// (Marketing & inventory have no business looking at till-level data.)
export const posReadGuard = requireRole(
  "owner",
  "manager",
  "accountant",
  "sales",
  "cashier",
  "auditor",
);
// Audit log access: management + auditor (auditors must inspect the trail).
export const auditReadGuard = requireRole("owner", "manager", "auditor");
// Customer ledger access. Inventory has no business reason to see customer
// PII, so they are excluded; everyone else who serves customers can read.
export const customerReadGuard = requireRole(
  "owner",
  "manager",
  "accountant",
  "sales",
  "cashier",
  "marketing",
  "auditor",
);
