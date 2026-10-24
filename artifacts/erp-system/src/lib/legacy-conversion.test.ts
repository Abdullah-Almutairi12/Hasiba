import { describe, expect, it } from "vitest";
import type { LegacyTeamUser } from "@workspace/api-client-react";
import { conversionBody, initialLegacyPerson, legacyIssues, rollbackReasonOk, legacyKind, isConverted, isReverted } from "./legacy-conversion";

const cashier: LegacyTeamUser = { userId: 7, personId: null, name: "سارة", email: "s@x.sa", role: "cashier", branchId: 3, conversionState: "legacy", eligible: true };

describe("legacy conversion", () => {
  it("accepts only the exact backend roles and conversion states, not substring guesses", () => {
    expect(legacyKind("inventory_manager")).toBeNull();
    expect(legacyKind("super_cashier")).toBeNull();
    expect(isConverted("active")).toBe(true);
    expect(isConverted("managed")).toBe(false);
    expect(isReverted("reverted")).toBe(true);
    expect(isReverted("rolled_back")).toBe(false);
  });
  it("starts with only the cashier ceiling and existing branch", () => {
    const p = initialLegacyPerson(cashier, "k1")!;
    expect(p.grants[0].actions).toEqual(["pos.read", "pos.sell", "pos.shift.open"]);
    expect(p.grants[0].branchId).toBe(3);
    expect(p.grants[0].warehouseIds).toEqual([]);
  });
  it("rejects widening and foreign branch, allows narrowing", () => {
    const p = initialLegacyPerson(cashier, "k1")!;
    p.grants[0].warehouseIds = [1];
    expect(legacyIssues(cashier, p)).toEqual([]);
    p.grants[0].actions = ["pos.read"];
    expect(legacyIssues(cashier, p)).toEqual([]);
    p.grants[0].actions = ["pos.read", "pos.refund"];
    p.grants[0].branchId = 4;
    expect(legacyIssues(cashier, p).length).toBe(2);
  });
  it("inventory uses the actual catalog action inventory.cost.read and body carries userId", () => {
    const u = { ...cashier, role: "inventory" };
    const p = initialLegacyPerson(u, "k2")!;
    expect(p.grants[0].actions).toEqual(["inventory.read", "inventory.cost.read"]);
    expect(conversionBody(u, p).userId).toBe(7);
  });
  it("requires rollback reason of 10 chars", () => {
    expect(rollbackReasonOk("قصير")).toBe(false);
    expect(rollbackReasonOk("سبب واضح للاستعادة")).toBe(true);
  });
});
