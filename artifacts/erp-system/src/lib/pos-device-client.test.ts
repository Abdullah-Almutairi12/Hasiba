import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findAnyPendingEvidence, findPendingEvidence, forgetBlockReason, rememberActor,
  setPosMode, unlockBlockReason, parsePublicJwk,
} from "./pos-device-client";

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

describe("pending evidence guards", () => {
  it("finds employee-scoped POS checkout but not another employee's", () => {
    sessionStorage.setItem("hasba:pos-checkout:7:3", "{}");
    expect(findPendingEvidence(7, 3).map((p) => p.kind)).toEqual(["pos-checkout"]);
    expect(findPendingEvidence(8, 3)).toEqual([]);
    expect(findAnyPendingEvidence().length).toBe(1);
  });

  it("ignores confirmed last-receipt pointer", () => {
    sessionStorage.setItem("hasba:pos-checkout:7:3:last-receipt", "{}");
    expect(findPendingEvidence(7, 3)).toEqual([]);
    expect(findAnyPendingEvidence()).toEqual([]);
  });

  it("fails closed when localStorage is unreadable", () => {
    const spy = vi.spyOn(Storage.prototype, "key").mockImplementation(function (this: Storage) {
      if (this === localStorage) throw new Error("denied");
      return null;
    });
    localStorage.setItem("x", "1");
    try { expect(findPendingEvidence(1, 1).some((p) => p.kind === "unreadable")).toBe(true); }
    finally { spy.mockRestore(); }
  });

  it("blocks a different cashier while the original actor has unresolved intent, never deletes it", () => {
    rememberActor({ personId: 11, userId: 7, companyId: 3 });
    sessionStorage.setItem("hasba:returns:payout:7:3:abc", "{}");
    expect(unlockBlockReason(12)).toMatch(/11/);
    expect(unlockBlockReason(11)).toBeNull();
    expect(sessionStorage.getItem("hasba:returns:payout:7:3:abc")).toBe("{}");
  });

  it("allows a different cashier when nothing is pending", () => {
    rememberActor({ personId: 11, userId: 7, companyId: 3 });
    expect(unlockBlockReason(12)).toBeNull();
  });

  it("fails closed on unreadable actor record", () => {
    localStorage.setItem("hasba:pos-device:actor", "{bad");
    expect(unlockBlockReason(5)).not.toBeNull();
  });

  it("refuses device reset in POS mode or with any evidence", () => {
    setPosMode(true);
    expect(forgetBlockReason()).not.toBeNull();
    setPosMode(false);
    expect(forgetBlockReason()).toBeNull();
    sessionStorage.setItem("hasba:financial-request:deadbeef", "k");
    expect(forgetBlockReason()).not.toBeNull();
  });
});

describe("public key parsing", () => {
  it("rejects a JWK carrying a private component", () => {
    const x = "a".repeat(43), y = "b".repeat(43);
    expect(parsePublicJwk(JSON.stringify({ kty: "EC", crv: "P-256", x, y }))).toEqual({ kty: "EC", crv: "P-256", x, y });
    expect(parsePublicJwk(JSON.stringify({ kty: "EC", crv: "P-256", x, y, d: x }))).toBeNull();
  });
});
