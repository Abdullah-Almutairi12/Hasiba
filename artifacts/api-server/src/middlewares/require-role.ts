import type { Request, Response, NextFunction } from "express";
import { db, usersTable, userCompaniesTable, companiesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { returnActor } from "../lib/return-access";

export const ALL_ROLES = [
  "owner",
  "manager",
  "accountant",
  "sales",
  "cashier",
  "inventory",
  "marketing",
  "auditor",
  "hr",
  "production",
] as const;

export type Role = (typeof ALL_ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

export function requireRole(...roles: Role[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.session?.userId) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }
    // Never trust an old session role: membership can change after login.
    const [membership] = await db.select({ role: userCompaniesTable.role })
      .from(userCompaniesTable)
      .innerJoin(usersTable, eq(usersTable.id, userCompaniesTable.userId))
      .innerJoin(companiesTable, eq(companiesTable.id, userCompaniesTable.companyId))
      .where(and(
        eq(userCompaniesTable.userId, req.session.userId),
        eq(userCompaniesTable.companyId, req.session.companyId ?? -1),
        eq(usersTable.isActive, true),
        eq(companiesTable.isActive, true),
      )).limit(1);
    const userRole = membership?.role;
    if (!isRole(userRole)) {
      res.status(403).json({ error: "ليس لديك وصول إلى هذه الشركة" });
      return;
    }
    req.session.role = userRole;
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
// HR write guard: owners, managers, and the dedicated HR role.
function sensitiveGuard(base: ReturnType<typeof requireRole>, capability: "hr_view" | "hr_write") {
  return (req: Request, res: Response, next: NextFunction): void => {
    void base(req, res, async () => {
      try {
        const actor = await returnActor(req.session.userId!, req.session.companyId!);
        if (actor.custom && actor.role !== "owner" && !actor.capabilities.includes(capability)) {
          res.status(403).json({ error: "إدارة المستخدمين أو دور الفرع لا يمنحان بيانات الموارد البشرية والرواتب الحساسة", diagnosticRef: String(req.id) });
          return;
        }
        next();
      } catch {
        res.status(403).json({ error: "الصلاحية الحساسة غير متاحة", diagnosticRef: String(req.id) });
      }
    });
  };
}
export const hrGuard = sensitiveGuard(requireRole("owner", "manager", "hr"), "hr_write");
// HR read guard: PII-bearing data (employees, contracts, loans, attendance,
// expiry alerts, Saudization). Auditor + accountant get read-only because they
// need it for compliance / payroll review. Sales / cashier / inventory /
// marketing must NOT see HR PII.
export const hrReadGuard = sensitiveGuard(requireRole("owner", "manager", "hr", "accountant", "auditor"), "hr_view");
// Payroll read guard: same as hrReadGuard — payroll runs/lines/WPS contain
// salary data which is sensitive PII.
export const payrollReadGuard = sensitiveGuard(requireRole("owner", "manager", "hr", "accountant", "auditor"), "hr_view");
// Back-office sales writes (quotes, sales orders, deliveries, invoices,
// credit notes, CRM opportunities). Cashiers are intentionally EXCLUDED:
// they own the till (posGuard) but must not be able to mutate B2B
// quotations, SOs, DOs, or CRM pipeline. Use posGuard for till routes.
export const salesWriteGuard = requireRole("owner", "manager", "sales");
export const posGuard = requireRole("owner", "manager", "sales", "cashier");
export const inventoryGuard = requireRole("owner", "manager", "inventory");
// Procurement (P2P) — owners/managers, accountants (3-way match + payments)
// and inventory (purchasing + receipts).
export const procurementGuard = requireRole(
  "owner",
  "manager",
  "accountant",
  "inventory",
);
// Read access to cost-bearing inventory data (quants, moves, lots, takes).
// Sales / cashier are intentionally excluded — they must not see avg_cost
// or unit_cost. Use inventoryLookupGuard for non-cost POS lookups.
export const inventoryReadGuard = requireRole(
  "owner",
  "manager",
  "inventory",
  "accountant",
  "auditor",
  "production",
);
// Identity-only lookups (barcode → product/price) usable from the POS.
export const inventoryLookupGuard = requireRole(
  "owner",
  "manager",
  "inventory",
  "accountant",
  "auditor",
  "sales",
  "cashier",
);
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
// Manufacturing (MRP) write guard: owners, managers, and the dedicated
// production role can create BoMs, work orders, run consumption/production,
// QC and scrap. Reads use inventoryReadGuard since MRP data exposes cost.
export const productionGuard = requireRole("owner", "manager", "production");
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
