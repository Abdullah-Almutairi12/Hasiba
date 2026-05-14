import { db, permissionOverridesTable } from "@workspace/db";

// Default per-(role × navKey) UI visibility. MUST stay in sync with the
// frontend mirror in `artifacts/erp-system/src/hooks/use-permissions.ts`.
// This is the soft, UI-only matrix — write-side guards in `require-role`
// remain authoritative.
const ALL_ROLES = [
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

const NAV_DEFAULTS: Record<string, readonly string[]> = {
  dashboard: ALL_ROLES,
  pos: ["owner", "manager", "accountant", "sales", "cashier", "auditor"],
  products: ALL_ROLES,
  invoices: ["owner", "manager", "accountant", "inventory", "auditor"],
  customers: ["owner", "manager", "accountant", "sales", "cashier", "marketing", "auditor"],
  accounting: ["owner", "manager", "accountant", "auditor"],
  reports: ["owner", "manager", "accountant", "auditor"],
  reports_builder: ["owner", "manager", "accountant", "auditor"],
  reports_saved: ["owner", "manager", "accountant", "auditor"],
  my_dashboard: ALL_ROLES,
  projects: ALL_ROLES,
  marketing: ["owner", "manager", "marketing", "auditor"],
  branches: ["owner", "manager", "inventory", "auditor"],
  transfers: ["owner", "manager", "inventory", "auditor"],
  stocktake: ["owner", "manager", "inventory", "accountant", "auditor"],
  reorder: ["owner", "manager", "inventory", "accountant"],
  procurement: ALL_ROLES,
  sales: ["owner", "manager", "accountant", "sales", "cashier", "auditor"],
  crm: ["owner", "manager", "sales", "marketing", "auditor"],
  users: ["owner", "manager"],
  admin: ["owner", "manager"],
  hr: ["owner", "manager", "hr", "accountant", "auditor"],
  manufacturing: ["owner", "manager", "inventory", "accountant", "auditor", "production"],
  approvals: ["owner", "manager", "accountant", "auditor"],
  settings: ALL_ROLES,
};

// In-memory cache, refreshed on every mutation.
let cache: Map<string, boolean> = new Map();
let loaded = false;

function cellKey(role: string, permissionKey: string) {
  return `${role}::${permissionKey}`;
}

export async function refreshPermissionOverridesCache(): Promise<void> {
  const rows = await db.select().from(permissionOverridesTable);
  const next = new Map<string, boolean>();
  for (const r of rows) next.set(cellKey(r.role, r.permissionKey), r.enabled);
  cache = next;
  loaded = true;
}

async function ensureLoaded() {
  if (!loaded) await refreshPermissionOverridesCache();
}

export async function getPermissionMatrixPayload() {
  await ensureLoaded();
  const overrides = [...cache.entries()].map(([k, enabled]) => {
    const [role, permissionKey] = k.split("::");
    return { role: role!, permissionKey: permissionKey!, enabled };
  });
  return {
    roles: [...ALL_ROLES],
    permissionKeys: Object.keys(NAV_DEFAULTS),
    defaults: Object.fromEntries(
      Object.entries(NAV_DEFAULTS).map(([k, v]) => [k, [...v]]),
    ) as Record<string, string[]>,
    overrides,
  };
}

export async function canRoleSee(role: string, permissionKey: string): Promise<boolean> {
  await ensureLoaded();
  const override = cache.get(cellKey(role, permissionKey));
  if (override !== undefined) return override;
  const def = NAV_DEFAULTS[permissionKey];
  return def ? def.includes(role) : true;
}

export const ADMIN_PERMISSION_KEYS = Object.keys(NAV_DEFAULTS);
