import type { LegacyTeamUser, TeamGrantInput, TeamPersonInput } from "@workspace/api-client-react";
import { isDecimalString, newCreationKey, normalizePerson } from "@/lib/team-access";

export type LegacyKind = "inventory" | "pos";

/** Upper bound of actions per legacy role. The owner may narrow, never widen. */
export const LEGACY_CEILING: Record<LegacyKind, string[]> = {
  inventory: ["inventory.read", "inventory.cost.read"],
  pos: ["pos.read", "pos.sell", "pos.shift.open"],
};

export function legacyKind(role: string): LegacyKind | null {
  if (role === "cashier") return "pos";
  if (role === "inventory") return "inventory";
  return null;
}

export const ROLE_LABEL: Record<string, string> = { cashier: "كاشير", inventory: "أمين مخزون", inventory_manager: "مدير مخزون" };
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

export const STATE_LABEL: Record<string, string> = {
  legacy: "صلاحيات قديمة",
  active: "محوّل",
  reverted: "مُستعاد للقديم",
  managed: "وصول مقيد قائم",
};
export const stateLabel = (s: string) => STATE_LABEL[s] ?? s;
export const isConverted = (s: string) => s === "active";
export const isReverted = (s: string) => s === "reverted";

/** Initial person: only ceiling actions, only the user's existing branch, no warehouses, no dates. */
export function initialLegacyPerson(u: LegacyTeamUser, creationKey = newCreationKey()): TeamPersonInput | null {
  const kind = legacyKind(u.role);
  if (!kind) return null;
  const grant: TeamGrantInput = {
    resource: kind,
    branchId: u.branchId ?? 0,
    warehouseIds: [],
    actions: [...LEGACY_CEILING[kind]],
    amountLimit: null,
    startsAt: null,
    endsAt: null,
  };
  return {
    creationKey,
    name: u.name,
    email: u.email ?? null,
    loginKinds: kind === "pos" ? ["pos"] : ["platform"],
    grants: [grant],
    deniedActions: [],
  };
}

export function legacyIssues(u: LegacyTeamUser, p: TeamPersonInput): string[] {
  const kind = legacyKind(u.role);
  const out: string[] = [];
  if (!kind) return ["الدور غير مؤهل للتحويل."];
  const g = p.grants[0];
  if (!g || p.grants.length !== 1) return ["يجب أن تبقى مسؤولية واحدة فقط."];
  const ceiling = LEGACY_CEILING[kind];
  if (g.actions.some((a) => !ceiling.includes(a))) out.push("إجراء خارج صلاحيات الدور القديم.");
  if (!g.actions.includes(`${kind}.read`)) out.push(`صلاحية العرض الأساسية (${kind}.read) مطلوبة.`);
  if (!g.branchId) out.push("اختر الفرع.");
  if (u.branchId && g.branchId !== u.branchId) out.push("الفرع يجب أن يطابق فرع المستخدم الحالي.");
  if (g.warehouseIds.length === 0) out.push("اختر مستودعًا واحدًا على الأقل.");
  if (kind !== "pos" && g.amountLimit) out.push("السقف المالي متاح لنقطة البيع فقط.");
  if (g.amountLimit && !isDecimalString(g.amountLimit)) out.push("السقف رقم عشري موجب.");
  if (g.startsAt && g.endsAt && new Date(g.endsAt) <= new Date(g.startsAt)) out.push("تاريخ الانتهاء يجب أن يلي البداية.");
  return out;
}

export function conversionBody(u: LegacyTeamUser, p: TeamPersonInput) {
  return { userId: u.userId, person: normalizePerson(p) };
}

export const MIN_ROLLBACK_REASON = 10;
export const rollbackReasonOk = (r: string) => r.trim().length >= MIN_ROLLBACK_REASON;
