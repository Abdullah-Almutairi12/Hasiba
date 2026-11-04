import { describe, it, expect } from "vitest";
import type { PosSession } from "@workspace/api-client-react";
import { readShiftSelection, saveShiftSelection, selectedPosSession } from "./pos-session-context";
import { clearSessionIntent, saveSessionIntent } from "./pos-session-intent";
const shift = (id: number, branchId: number, cashierUserId: number | null = 11) => ({ id, branchId, cashierUserId, status:"open" } as PosSession);
describe("explicit POS shift context",()=>{
  it("never borrows the first open shift or another cashier's shift",()=>{
    const all=[shift(1,99),shift(2,7,22),shift(3,7)];
    expect(selectedPosSession(all,null,11)).toBeUndefined();
    expect(selectedPosSession(all,7,11)?.id).toBe(3);
    expect(selectedPosSession(all,99,11,3)?.id).toBe(1);
    expect(selectedPosSession(all,7,11,2)?.id).toBe(3);
    expect(selectedPosSession([shift(2,7),shift(3,7)],7,11)).toBeUndefined();
    expect(selectedPosSession([shift(2,7),shift(3,7)],7,11,3)?.id).toBe(3);
  });
  it("recovers a sole eligible shift after a closed preference, never guesses among multiple eligible shifts",()=>{
    const closed={...shift(9,7),status:"closed"} as PosSession;
    expect(selectedPosSession([closed,shift(42,7)],7,11,9)?.id).toBe(42);
    expect(selectedPosSession([closed,shift(42,7),shift(43,7)],7,11,9)).toBeUndefined();
    expect(selectedPosSession([shift(42,7),shift(43,7)],7,11,43)?.id).toBe(43);
  });
  it("isolates persisted choices by user, company and responsibility",()=>{
    sessionStorage.clear();saveShiftSelection("11:21:legacy",{branchId:7,sessionId:3});
    expect(readShiftSelection("11:21:legacy")).toEqual({branchId:7,sessionId:3});
    for(const scope of ["12:21:legacy","11:22:legacy","11:21:77"])expect(readShiftSelection(scope)).toBeNull();
    expect(selectedPosSession([shift(3,8)],7,11,3)).toBeUndefined();
  });
  it("does not clear a newer opening intent when an older response arrives",()=>{
    const scope="11:21";
    saveSessionIntent(scope,{key:"new-request-0001",body:{branchId:7,openingCash:10,cashierName:""},responsibility:null});
    expect(clearSessionIntent(scope,"old-request-0001")).toBe(false);
    expect(sessionStorage.getItem(`hasba:pos-session-open:${scope}`)).toContain("new-request-0001");
    expect(clearSessionIntent(scope,"new-request-0001")).toBe(true);
  });
});
