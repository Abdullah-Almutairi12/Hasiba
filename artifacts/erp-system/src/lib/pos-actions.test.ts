import { describe, expect, it } from "vitest";
import { ACTION_LABEL, actionLabel, applyReturnMode, canReachReturns, returnMode, splitAllowed, posResponsibilitySummary } from "./pos-actions";

describe("effective responsibility descriptions", () => {
  it("describes the granted manual tender, discount and branch-wide closing in Arabic", () => {
    const actions = ["pos.read","pos.sell","pos.payment.record","pos.discount","pos.shift.close"];
    expect(posResponsibilitySummary(actions)).toContain("تحصيل غير نقدي");
    expect(posResponsibilitySummary(actions)).toContain("الخصم متاح");
    expect(posResponsibilitySummary(actions)).toContain("لا ورديتك وحدها");
    expect(posResponsibilitySummary(actions, ["pos.discount","pos.payment.record"])).toContain("نقدي فقط");
    expect(posResponsibilitySummary(actions, ["pos.discount"])).toContain("الخصم غير ممنوح");
    expect(actionLabel("pos.shift.close")).toContain("ولو فتحها زميل");
  });
});

describe("pos action labels", () => {
  it("labels every new POS key in Arabic, never raw", () => {
    for (const k of ["pos.payment.record", "pos.discount", "pos.shift.close", "pos.shift.difference", "pos.return.request", "pos.return.direct", "pos.return.receive", "pos.return.payout", "pos.return.external"]) {
      expect(ACTION_LABEL[k]).toBeTruthy();
      expect(actionLabel(k)).not.toContain(k);
    }
  });
  it("unknown key is marked unknown, catalogue label used if meaningful", () => {
    expect(actionLabel("x.y")).toContain("غير معروف");
    expect(actionLabel("x.y", "تجربة")).toBe("تجربة");
  });
  it("no approve key is labelled", () => expect(ACTION_LABEL["pos.return.approve"]).toBeUndefined());
});

describe("return mode projection", () => {
  it("projects only request + direct, never stock/payout", () => {
    const base = ["pos.read", "pos.return.receive"];
    expect(applyReturnMode(base, "approval")).toEqual(["pos.read", "pos.return.receive", "pos.return.request"]);
    expect(applyReturnMode(base, "direct")).toEqual(["pos.read", "pos.return.receive", "pos.return.request", "pos.return.direct"]);
    expect(applyReturnMode(["pos.return.request", "pos.return.direct", "pos.return.payout"], "deny")).toEqual(["pos.return.payout"]);
  });
  it("reads modes", () => {
    expect(returnMode([])).toBe("deny");
    expect(returnMode(["pos.return.request"])).toBe("approval");
    expect(returnMode(["pos.return.request", "pos.return.direct"])).toBe("direct");
    expect(returnMode(["pos.return.direct"])).toBe("custom");
  });
});

describe("returns reachability and preview split", () => {
  it("requires pos responsibility with read and a return/shift-close action", () => {
    expect(canReachReturns(null)).toBe(false);
    expect(canReachReturns({ resource: "pos", actions: ["pos.read", "pos.sell"] })).toBe(false);
    expect(canReachReturns({ resource: "pos", actions: ["pos.return.request"] })).toBe(false);
    expect(canReachReturns({ resource: "pos", actions: ["pos.read", "pos.return.request"] })).toBe(true);
    expect(canReachReturns({ resource: "inventory", actions: ["pos.read", "pos.return.request"] })).toBe(false);
  });
  it("splits allowed vs blocked", () => {
    expect(splitAllowed(["pos.read"], ["pos.read", "pos.sell"])).toEqual({ allowed: ["pos.read"], blocked: ["pos.sell"] });
  });
});

import { scopedBodyDiscount, scopedCheckoutCaps } from "./pos-actions";
import { clearSessionIntent, isConfirmedRejection, readSessionIntent, saveSessionIntent } from "./pos-session-intent";

describe("managed checkout selector", () => {
  it("seller without record/discount: cash only, discount forced to 0", () => {
    const c = scopedCheckoutCaps(["pos.read", "pos.sell"]);
    expect(c).toEqual({ sell: true, discount: false, recordTender: false, tenders: ["cash"] });
    expect(scopedBodyDiscount(["pos.read", "pos.sell"], 12.5)).toBe(0);
  });
  it("pos.payment.record enables manual card/stc/transfer/deferred", () => {
    expect(scopedCheckoutCaps(["pos.read", "pos.sell", "pos.payment.record"]).tenders).toEqual(["cash", "card", "stc", "transfer", "deferred"]);
  });
  it("pos.discount passes the discount through (server applies scoped limit)", () => {
    expect(scopedBodyDiscount(["pos.read", "pos.sell", "pos.discount"], 12.5)).toBe(12.5);
  });
  it("record/discount without sell or read grant nothing", () => {
    expect(scopedCheckoutCaps(["pos.read", "pos.payment.record", "pos.discount"])).toEqual({ sell: false, discount: false, recordTender: false, tenders: ["cash"] });
    expect(scopedCheckoutCaps(["pos.sell", "pos.discount"]).discount).toBe(false);
    expect(scopedCheckoutCaps(null).tenders).toEqual(["cash"]);
  });
});

describe("shift-open intent", () => {
  it("keeps exact body+key until cleared; rejects corrupt evidence", () => {
    const intent = { key: "abcdef12-key", body: { branchId: 3, cashierName: "x", openingCash: 50 }, responsibility: "77" };
    expect(saveSessionIntent("1:2", intent)).toBe(true);
    expect(readSessionIntent("1:2")).toEqual(intent);
    clearSessionIntent("1:2");
    expect(readSessionIntent("1:2")).toBeNull();
    sessionStorage.setItem("hasba:pos-session-open:1:2", "{bad");
    expect(readSessionIntent("1:2")).toBe("unreadable");
    sessionStorage.clear();
  });
  it("only fresh non-retryable 4xx is a confirmed rejection", () => {
    expect(isConfirmedRejection({ status: 403 })).toBe(true);
    expect(isConfirmedRejection({ status: 408 })).toBe(false);
    expect(isConfirmedRejection({ status: 500 })).toBe(false);
    expect(isConfirmedRejection(new Error("net"))).toBe(false);
  });
});
