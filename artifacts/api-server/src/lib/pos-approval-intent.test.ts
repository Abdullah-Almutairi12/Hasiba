import { describe, expect, it } from "vitest";
import { matchesPosApprovalNotes, posApprovalNotes, posApprovalIntent } from "./pos-approval-intent";

describe("server POS approval intent commitment", () => {
  const body = { sessionId: 1, items: [{ productId: 2, quantity: 2, unitPrice: 10 }], total: 20, discount: 3 };
  const quote = { warehouseId: 1, vatRegistrationStatus: "registered", items: [{ productId: 2, unitPrice: 10, costPrice: 5 }] };
  it("binds the entire basket, parties, allocations, tender and session even at the same total", () => {
    const notes = posApprovalNotes(body, "server-calculated discount threshold", quote);
    for (const changed of [
      { ...body, items: [{ productId: 3, quantity: 2, unitPrice: 10 }] },
      { ...body, items: [{ productId: 2, quantity: 1, unitPrice: 20 }] },
      { ...body, customerId: 9 }, { ...body, sessionId: 2 },
      { ...body, salespersonId: 3 }, { ...body, paymentMethod: "bank" },
    ]) expect(matchesPosApprovalNotes(changed, notes, quote)).toBe(false);
    expect(matchesPosApprovalNotes(body, notes, { ...quote, items: [{ productId: 2, unitPrice: 11, costPrice: 5 }] })).toBe(false);
    expect(matchesPosApprovalNotes(body, notes, { ...quote, vatRegistrationStatus: "not_registered" })).toBe(false);
  });
  it("excludes only subsequent approval transport and manager credentials and is key-order stable", () => {
    const digest = posApprovalIntent(body, quote);
    expect(posApprovalIntent({ ...body, approvalRequestId: 5, managerOverride: { password: "synthetic" } }, quote)).toBe(digest);
    expect(posApprovalIntent({ discount: 3, total: 20, items: body.items, sessionId: 1 }, quote)).toBe(digest);
  });
  it("does not treat legacy notes or malformed content as financial approval evidence", () => {
    for (const notes of [null, "approved", "{}", "{\"kind\":\"pos-intent-v1\"}"]) {
      expect(matchesPosApprovalNotes(body, notes, quote)).toBe(false);
    }
  });
});
