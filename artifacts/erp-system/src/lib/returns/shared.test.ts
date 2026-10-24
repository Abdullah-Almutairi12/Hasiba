import { describe, expect, it } from "vitest";
import { closingStateLabel, returnNoteState, statusTone } from "./shared";

describe("independent review, physical receipt and financial issue presentation", () => {
  it("never labels an approved closing as a payout entitlement",()=>{
    expect(closingStateLabel("approved")).toBe("إقفال مكتمل ومعتمد");
    expect(closingStateLabel("approved")).not.toContain("مستحق الصرف");
  });
  it("keeps pending closing review separate from completed closure",()=>{
    expect(closingStateLabel("pending")).toBe("بانتظار مراجعة الفرق");
  });
  it("keeps a sole-owner exception explicit after reload rather than calling it independent review",()=>{
    expect(closingStateLabel("approved",true)).toContain("ليس اعتمادًا مستقلًا");
  });
  it("distinguishes direct permission from independent approval and still waits for receipt", () => {
    const state = returnNoteState({status:"pending_approval",review_status:"direct_authorized",receipt_required:true});
    expect(state.awaitingApproval).toBe(false);
    expect(state.awaitingReceipt).toBe(true);
    expect(state.financialPending).toBe(true);
    expect(statusTone(state.status).text).toBe("مسموح مباشرة — بانتظار الاستلام");
  });
  it("counts a submitted unapproved note as awaiting review only", () => {
    expect(returnNoteState({ status: "pending", review_status: "pending", receipt_required: true })).toEqual({
      financialPending: true, awaitingApproval: true, awaitingReceipt: false, status: "pending",
    });
  });
  it("approved review is not another pending approval or financial issuance", () => {
    const state = returnNoteState({ status: "pending", review_status: "approved", receipt_required: true, received_by: null });
    expect(state).toEqual({ financialPending: true, awaitingApproval: false, awaitingReceipt: true, status: "pending_receipt" });
    expect(statusTone(state.status).text).toBe("معتمد — بانتظار الاستلام");
  });
  it("an approved note awaiting finalization still cannot offer payout or issued printing", () => {
    const state = returnNoteState({ status: "pending", review_status: "approved", receipt_required: false });
    expect(state.financialPending).toBe(true);
    expect(state.awaitingApproval).toBe(false);
    expect(statusTone(state.status).text).toBe("معتمد — بانتظار الترحيل");
  });
  it("issued receipt is neither waiting for review nor receipt", () => {
    expect(returnNoteState({ status: "issued", review_status: "approved", receipt_required: true, received_by: 5 })).toEqual({
      financialPending: false, awaitingApproval: false, awaitingReceipt: false, status: "issued",
    });
  });
  it("keeps legacy pending semantics without inventing receipt evidence", () => {
    expect(returnNoteState({ status: "pending" }).awaitingApproval).toBe(true);
    expect(returnNoteState({ status: "pending" }).awaitingReceipt).toBe(false);
  });
  it("does not reinterpret old issued or rejected statuses as awaiting approval", () => {
    for (const status of ["issued", "rejected", "draft", "cancelled"]) {
      const state = returnNoteState({ status });
      expect(state.status).toBe(status);
      expect(state.financialPending).toBe(false);
      expect(state.awaitingApproval).toBe(false);
    }
  });
});
