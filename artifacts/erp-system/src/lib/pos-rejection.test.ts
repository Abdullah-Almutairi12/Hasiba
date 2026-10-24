import { afterEach, describe, expect, it, vi } from "vitest";
import { createPosOrder } from "@workspace/api-client-react";
import { readPosRejection } from "./pos-rejection";

afterEach(() => vi.unstubAllGlobals());
async function realError(status: number, body: unknown): Promise<unknown> {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
  try { await createPosOrder({ sessionId: 9, items: [{ productId: 5, quantity: 1 }], paymentMethod: "cash" }); }
  catch (e) { return e; }
  throw new Error("expected rejection");
}

describe("readPosRejection (classic POS catch)", () => {
  it("reads requiresManagerApproval and the pending id from a real ApiError .data", async () => {
    const err = await realError(403, { error: "تجاوزت حد الخصم", requiresManagerApproval: true, approvalRequestId: 41, actionKey: "pos.discount_pct", max: 0, attempted: 10 });
    expect((err as { response?: unknown }).response).toBeInstanceOf(Response);
    expect(readPosRejection(err)).toMatchObject({ status: 403, requiresManagerApproval: true, approvalRequestId: 41, actionKey: "pos.discount_pct", max: 0, attempted: 10 });
  });
  it("a plain 403 (FinancialRequestError) is not treated as an approval request", async () => {
    const r = readPosRejection(await realError(403, { error: "صلاحية المعتمِد لم تعد سارية" }));
    expect(r.requiresManagerApproval).toBe(false);
    expect(r.approvalRequestId).toBeNull();
    expect(r.error).toContain("المعتمِد");
  });
  it("still accepts the legacy axios-style shape", () => {
    expect(readPosRejection({ response: { status: 403, data: { requiresManagerApproval: true, approvalRequestId: 7 } } })).toMatchObject({ status: 403, requiresManagerApproval: true, approvalRequestId: 7 });
  });
});
