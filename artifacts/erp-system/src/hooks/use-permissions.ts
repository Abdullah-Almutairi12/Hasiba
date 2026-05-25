import { useAuth } from "@/hooks/use-auth";
import {
  useListPermissionMatrix,
  getListPermissionMatrixQueryKey,
} from "@workspace/api-client-react";

export type Role =
  | "owner"
  | "manager"
  | "accountant"
  | "sales"
  | "cashier"
  | "inventory"
  | "marketing"
  | "auditor"
  | "hr"
  | "production";

export const ALL_ROLES: Role[] = [
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
];

// Mirror of server-side groups in `artifacts/api-server/src/middlewares/require-role.ts`.
// Keep these in sync — the server is the source of truth, this is for UI gating only.
const GROUPS = {
  admin: ["owner", "manager"],
  ownerOnly: ["owner"],
  finance: ["owner", "manager", "accountant"],
  // Mirror server: cashier owns the till (pos) but cannot mutate B2B sales
  // documents (quotations, sales orders, deliveries, credit notes, CRM).
  salesWrite: ["owner", "manager", "sales"],
  pos: ["owner", "manager", "sales", "cashier"],
  posRead: ["owner", "manager", "accountant", "sales", "cashier", "auditor"],
  inventory: ["owner", "manager", "inventory"],
  marketing: ["owner", "manager", "marketing"],
  reportRead: ["owner", "manager", "accountant", "auditor"],
  exports: ["owner", "manager", "accountant", "auditor", "inventory", "marketing"],
  analyticsRead: ["owner", "manager", "accountant", "marketing", "auditor"],
  invoiceRead: ["owner", "manager", "accountant", "inventory", "auditor"],
  supplierRead: ["owner", "manager", "accountant", "inventory", "auditor"],
  // Mirror server-side procurementGuard: who may write POs/GRNs/payment runs.
  procurement: ["owner", "manager", "accountant", "inventory"],
  auditRead: ["owner", "manager", "auditor"],
  // HR write guard: owners, managers, and the dedicated HR role.
  hr: ["owner", "manager", "hr"],
  hrRead: ["owner", "manager", "hr", "accountant", "auditor"],
  // Manufacturing (MRP) write guard — mirrors server-side `productionGuard`.
  production: ["owner", "manager", "production"],
  // Manufacturing read guard mirrors server-side inventoryReadGuard.
  productionRead: ["owner", "manager", "inventory", "accountant", "auditor", "production"],
} as const satisfies Record<string, readonly Role[]>;

export type PermissionKey = keyof typeof GROUPS;

// Per-page nav visibility. Each nav key is mapped to the set of roles allowed
// to see it. Reads on these pages are filtered both here (UX) and on the
// server (security). These MUST stay in sync with the server-side guards in
// `artifacts/api-server/src/middlewares/require-role.ts`.
export const NAV_PERMISSIONS: Record<string, readonly Role[]> = {
  dashboard: ALL_ROLES, // every role gets a landing page
  // POS *page* visibility = posRead (accountant + auditor can view tills/sessions
  // even though they cannot ring up sales). Write-side is enforced server-side.
  pos: GROUPS.posRead,
  products: ALL_ROLES, // read-only for most; writes guarded server-side
  invoices: GROUPS.invoiceRead,
  customers: ["owner", "manager", "accountant", "sales", "cashier", "marketing", "auditor"],
  suppliers: GROUPS.supplierRead,
  accounting: ["owner", "manager", "accountant", "auditor"],
  reports: GROUPS.reportRead,
  reports_builder: GROUPS.reportRead,
  reports_saved: GROUPS.reportRead,
  my_dashboard: ALL_ROLES,
  projects: ALL_ROLES,
  marketing: ["owner", "manager", "marketing", "auditor"],
  branches: ["owner", "manager", "inventory", "auditor"],
  transfers: ["owner", "manager", "inventory", "auditor"],
  stocktake: ["owner", "manager", "inventory", "accountant", "auditor"],
  reorder: ["owner", "manager", "inventory", "accountant"],
  // Procurement is open to all authenticated roles: any user can create
  // a Purchase Requisition (server-side `procurementGuard` still gates
  // PO/GRN/payment-run actions for non-procurement roles).
  procurement: ALL_ROLES,
  sales: ["owner", "manager", "accountant", "sales", "cashier", "auditor"],
  crm: ["owner", "manager", "sales", "marketing", "auditor"],
  users: GROUPS.admin,
  admin: GROUPS.admin,
  // Marketplace integrations: managers configure connectors; inventory
  // role can trigger pushes/syncs from the same page.
  integrations_marketplaces: ["owner", "manager", "inventory"],
  anomalies: GROUPS.auditRead,
  hr: GROUPS.hrRead,
  manufacturing: GROUPS.productionRead,
  // Approval inbox (طلبات الموافقة) — managers, owners, and accountants
  // are the canonical approvers; auditors get read access. Everyone else
  // accesses their own pending items via the bell icon instead.
  approvals: ["owner", "manager", "accountant", "auditor"],
  settings: ALL_ROLES,
  documents: ALL_ROLES,
  intercompany: GROUPS.finance,
};

export function useCurrentRole(): Role | null {
  const { user } = useAuth();
  return (user?.role as Role | undefined) ?? null;
}

export function usePermissions() {
  const role = useCurrentRole();
  // The admin permission matrix is loaded best-effort. The endpoint is
  // admin-only, so non-admin roles will get a 403 — we just ignore it and
  // fall back to the static defaults. `staleTime` is generous because the
  // matrix changes rarely (manual toggle in the admin UI).
  const { data: matrix } = useListPermissionMatrix({
    query: {
      queryKey: getListPermissionMatrixQueryKey(),
      staleTime: 60_000,
      retry: false,
      refetchOnWindowFocus: false,
      enabled: !!role,
    },
  });

  function has(group: PermissionKey): boolean {
    if (!role) return false;
    return (GROUPS[group] as readonly Role[]).includes(role);
  }

  function canSee(navKey: string): boolean {
    if (!role) return false;
    // Honour the admin-defined override matrix when available. The matrix
    // is the union of static defaults + per-cell overrides; an explicit
    // `false` override removes nav access for that role × module pair, and
    // an explicit `true` grants it.
    if (matrix) {
      const ov = matrix.overrides.find(
        (o) => o.role === role && o.permissionKey === navKey,
      );
      if (ov) return ov.enabled;
    }
    const allowed = NAV_PERMISSIONS[navKey];
    if (!allowed) return true;
    return allowed.includes(role);
  }

  return {
    role,
    isOwner: role === "owner",
    isAdmin: has("admin"),
    canManageFinance: has("finance"),
    canWriteSales: has("salesWrite"),
    canUsePos: has("pos"),
    canManageInventory: has("inventory"),
    canManageMarketing: has("marketing"),
    canReadReports: has("reportRead"),
    canExport: has("exports"),
    has,
    canSee,
  };
}
