import { describe, expect, it } from "vitest";
import { freezeApprovalPolicy, frozenApprovalPolicy } from "./approval-policy";

const steps = () => [{ id: -1, ruleId: -1, sequence: 1, approverRole: "manager", approverUserId: null, minAmount: "0" }];
describe("frozen approval policy", () => {
  it("does not turn a legacy NULL snapshot into historical evidence", () => {
    expect(frozenApprovalPolicy({ companyId: 11, policySnapshot: null })).toBeNull();
  });
  it("retains the submitted definition independently of later edits", () => {
    const source = steps();
    const snapshot = freezeApprovalPolicy(11, null, source);
    source[0].approverRole = "cashier";
    expect(snapshot.steps[0].approverRole).toBe("manager");
    expect(frozenApprovalPolicy({ companyId: 11, policySnapshot: snapshot })?.revision).toBe(snapshot.revision);
  });
  it("uses a definition revision independent of capture time and JSONB key ordering", () => {
    const snapshot = freezeApprovalPolicy(11, null, steps());
    const reordered = Object.fromEntries(Object.entries(snapshot).reverse());
    expect(frozenApprovalPolicy({ companyId: 11, policySnapshot: reordered })?.revision).toBe(snapshot.revision);
    expect(freezeApprovalPolicy(11, null, steps()).revision).toBe(snapshot.revision);
  });
  it("rejects a modified step with an unchanged revision", () => {
    const snapshot = freezeApprovalPolicy(11, null, steps());
    snapshot.steps[0].approverRole = "owner";
    expect(() => frozenApprovalPolicy({ companyId: 11, policySnapshot: snapshot })).toThrow("تغيرت نسخة");
  });
  it("does not adopt another company's policy snapshot", () => {
    const snapshot = freezeApprovalPolicy(11, null, steps());
    expect(() => frozenApprovalPolicy({ companyId: 12, policySnapshot: snapshot })).toThrow("غير صالحة");
  });
  it("preserves decimal thresholds as text without a floating-point conversion", () => {
    const source = steps(); source[0].minAmount = "99999999999999.99";
    expect(freezeApprovalPolicy(11, null, source).steps[0].minAmount).toBe("99999999999999.99");
  });
});
