import { useAuth } from "@/hooks/use-auth";

export type Role =
  | "owner"
  | "manager"
  | "accountant"
  | "sales"
  | "cashier"
  | "inventory"
  | "marketing"
  | "auditor";

export const ALL_ROLES: Role[] = [
  "owner",
  "manager",
  "accountant",
  "sales",
  "cashier",
  "inventory",
  "marketing",
  "auditor",
];

// Mirror of server-side groups in `artifacts/api-server/src/middlewares/require-role.ts`.
// Keep these in sync — the server is the source of truth, this is for UI gating only.
const GROUPS = {
  admin: ["owner", "manager"],
  ownerOnly: ["owner"],
  finance: ["owner", "manager", "accountant"],
  salesWrite: ["owner", "manager", "sales", "cashier"],
  pos: ["owner", "manager", "sales", "cashier"],
  inventory: ["owner", "manager", "inventory"],
  marketing: ["owner", "manager", "marketing"],
  reportRead: ["owner", "manager", "accountant", "auditor"],
  exports: ["owner", "manager", "accountant", "auditor", "inventory", "marketing"],
  analyticsRead: ["owner", "manager", "accountant", "marketing", "auditor"],
} as const satisfies Record<string, readonly Role[]>;

export type PermissionKey = keyof typeof GROUPS;

// Per-page nav visibility. Each nav key is mapped to the set of roles allowed
// to see it. Reads on these pages are filtered both here (UX) and on the
// server (security).
export const NAV_PERMISSIONS: Record<string, readonly Role[]> = {
  dashboard: ALL_ROLES, // every role gets a landing page
  pos: ["owner", "manager", "sales", "cashier"],
  products: ALL_ROLES, // read-only for most; writes guarded server-side
  invoices: ["owner", "manager", "accountant", "inventory", "auditor"],
  customers: ["owner", "manager", "accountant", "sales", "marketing", "auditor"],
  accounting: ["owner", "manager", "accountant", "auditor"],
  reports: GROUPS.reportRead,
  projects: ALL_ROLES,
  marketing: ["owner", "manager", "marketing", "auditor"],
  branches: ["owner", "manager", "inventory", "auditor"],
  users: GROUPS.admin,
  admin: GROUPS.admin,
  settings: ALL_ROLES,
};

export function useCurrentRole(): Role | null {
  const { user } = useAuth();
  return (user?.role as Role | undefined) ?? null;
}

export function usePermissions() {
  const role = useCurrentRole();

  function has(group: PermissionKey): boolean {
    if (!role) return false;
    return (GROUPS[group] as readonly Role[]).includes(role);
  }

  function canSee(navKey: string): boolean {
    if (!role) return false;
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
