import { describe, expect, it, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { getWorkspaceResponsibility } from "@workspace/api-client-react";
import {
  buildActivationUrl, checkNewPassword, emptyGrant, emptyPerson, fromDraft, needsDeviceSetup,
  normalizePerson, readTokenFromHash, toDraft, validatePerson,
} from "./team-access";
import { __resetWorkspaceResponsibility, selectResponsibility, syncWorkspaceIdentity } from "./workspace-responsibility";

const catalog = [
  { key: "inventory.read", label: "عرض", resource: "inventory", available: true },
  { key: "pos.read", label: "عرض نقطة البيع", resource: "pos", available: true },
  { key: "pos.sell_cash", label: "بيع", resource: "pos", available: true },
  { key: "inventory.adjust", label: "تسوية", resource: "inventory", available: false },
];
const warehouses = [
  { id: 1, branchId: 10, name: "R1", nameAr: "الرياض", isDefault: true },
  { id: 2, branchId: 20, name: "J1", nameAr: "جدة", isDefault: true },
];

describe("team access helpers", () => {
  it("new grants are never broad", () => {
    const g = emptyGrant("inventory");
    expect(g).toMatchObject({ branchId: 0, warehouseIds: [], actions: [], amountLimit: null });
  });
  it("accepts inventory Riyadh + pos Jeddah as distinct grants", () => {
    const p = { ...emptyPerson(), name: "ريم", loginKinds: [] as never[], grants: [
      { ...emptyGrant("inventory"), branchId: 10, warehouseIds: [1], actions: ["inventory.read"] },
      { ...emptyGrant("pos"), branchId: 20, warehouseIds: [2], actions: ["pos.read", "pos.sell_cash"], amountLimit: "1500.50" },
    ] };
    expect(validatePerson(p, catalog, warehouses)).toEqual([]);
  });
  it("rejects cross-branch warehouses, unavailable actions and bad limits", () => {
    const p = { ...emptyPerson(), name: "x", grants: [
      { ...emptyGrant("inventory"), branchId: 10, warehouseIds: [2], actions: ["inventory.adjust"], amountLimit: "-3" },
    ] };
    const msgs = validatePerson(p, catalog, warehouses).map((i) => i.path);
    expect(msgs).toContain("grants.0.warehouseIds");
    expect(msgs).toContain("grants.0.actions");
    expect(msgs).toContain("grants.0.amountLimit");
  });
  it("platform login requires a real email; pos without email needs device", () => {
    const p = { ...emptyPerson(), name: "x", loginKinds: ["platform" as const] };
    expect(validatePerson(p, catalog, warehouses).some((i) => i.path === "email")).toBe(true);
    expect(needsDeviceSetup({ loginKinds: ["pos"], email: null })).toBe(true);
    expect(needsDeviceSetup({ loginKinds: ["pos"], email: "a@b.sa" })).toBe(false);
  });
  it("normalizes email and keeps creationKey", () => {
    const p = { ...emptyPerson(), name: " a ", email: " A@B.SA " };
    const n = normalizePerson(p);
    expect(n.email).toBe("a@b.sa");
    expect(n.creationKey).toBe(p.creationKey);
  });
  it("draft round-trips without secrets", () => {
    const p = { ...emptyPerson(), name: "سارة" };
    const d = toDraft(p, 7);
    expect(Object.keys(d.person!)).toEqual(["creationKey", "name", "email", "loginKinds", "grants", "deniedActions"]);
    expect(fromDraft(JSON.parse(JSON.stringify(d)))).toEqual({ person: p, selectedPersonId: 7 });
    expect(JSON.stringify(d)).not.toMatch(/token|password/i);
  });
  it("activation url uses fragment, not query", () => {
    const u = buildActivationUrl("https://x.sa", "/app/", "abc+/=");
    expect(u).toBe("https://x.sa/app/team-activate#token=abc%2B%2F%3D");
    expect(u).not.toContain("?");
    expect(readTokenFromHash(new URL(u).hash)).toBe("abc+/=");
  });
  it("password policy", () => {
    expect(checkNewPassword("short")).toMatch(/15/);
    expect(checkNewPassword("password12345678")).toMatch(/شائعة/);
    expect(checkNewPassword("111111111111111111")).not.toBeNull();
    expect(checkNewPassword("نخلة-زرقاء-فوق-السحاب-2024")).toBeNull();
  });
});

describe("workspace responsibility", () => {
  beforeEach(() => __resetWorkspaceResponsibility());
  it("sets header id and clears non-auth cache on change and identity switch", () => {
    const qc = new QueryClient();
    qc.setQueryData(["auth", "me"], { id: 1 });
    qc.setQueryData(["/api/workspace/inventory"], [1]);
    syncWorkspaceIdentity(qc, "1:5:scoped");
    selectResponsibility(qc, { id: 42, resource: "inventory", branchId: 10, actions: [], vatRegistered: null });
    expect(getWorkspaceResponsibility()).toBe("42");
    expect(qc.getQueryData(["/api/workspace/inventory"])).toBeUndefined();
    expect(qc.getQueryData(["auth", "me"])).toEqual({ id: 1 });
    qc.setQueryData(["/api/x"], 1);
    syncWorkspaceIdentity(qc, "1:6:scoped");
    expect(getWorkspaceResponsibility()).toBeNull();
    expect(qc.getQueryData(["/api/x"])).toBeUndefined();
  });
});

import { effectiveActions, selectionFromAccess } from "@/lib/workspace-responsibility";
import { readPendingPosAttempt } from "@/hooks/use-pos-checkout";
describe("scoped selection snapshot", () => {
  const acc = { status: "active", deniedActions: ["pos.shift.open"], vatRegistered: false,
    grants: [{ id: 7, resource: "pos", branchId: 2, actions: ["pos.read", "pos.sell", "pos.shift.open"] }] };
  it("keeps effective actions (grant minus denied) and the real VAT flag", () => {
    expect(effectiveActions(acc, 7)).toEqual(["pos.read", "pos.sell"]);
    expect(selectionFromAccess(acc, 7)).toEqual({ id: 7, resource: "pos", branchId: 2, actions: ["pos.read", "pos.sell"], vatRegistered: false });
    expect(selectionFromAccess({ ...acc, vatRegistered: undefined }, 7)?.vatRegistered).toBeNull();
    expect(effectiveActions({ ...acc, status: "suspended" }, 7)).toEqual([]);
  });
  it("peeks pending checkout evidence without touching it", () => {
    sessionStorage.setItem("hasba:pos-checkout:1:2", "{broken");
    expect(readPendingPosAttempt("1:2")).toBe("unreadable");
    expect(sessionStorage.getItem("hasba:pos-checkout:1:2")).toBe("{broken");
    sessionStorage.removeItem("hasba:pos-checkout:1:2");
    expect(readPendingPosAttempt("1:2")).toBeNull();
  });
});

import { validatePerson } from "@/lib/team-access";
describe("base read prerequisite", () => {
  const cat = [{ key: "pos.read", available: true }, { key: "pos.sell", available: true }] as never;
  const person = (actions: string[], denied: string[] = []) => ({ ...emptyPerson(), name: "سارة", loginKinds: ["pos"], deniedActions: denied,
    grants: [{ ...emptyGrant("pos"), branchId: 1, warehouseIds: [1], actions }] }) as never;
  const msgs = (p: never) => validatePerson(p, cat, [{ id: 1, branchId: 1 }] as never).map((i) => i.message).join(" ");
  it("requires explicit base read but permits an overriding deny for effective preview", () => {
    expect(msgs(person(["pos.sell"]))).toContain("pos.read");
    expect(msgs(person(["pos.read", "pos.sell"]))).not.toContain("صلاحية العرض الأساسية");
    expect(msgs(person(["pos.read", "pos.sell"], ["pos.read"]))).toBe("");
  });
});
