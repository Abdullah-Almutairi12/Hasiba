import type { PosSession } from "@workspace/api-client-react";

export type ShiftSelection = { branchId: number; sessionId?: number };
export const shiftSelectionKey = (scope: string) => `hasba:pos-shift-selection:${scope}`;
export function readShiftSelection(scope: string): ShiftSelection | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(shiftSelectionKey(scope)) || "null");
    return value && Number.isSafeInteger(value.branchId) && value.branchId > 0 &&
      (value.sessionId === undefined || Number.isSafeInteger(value.sessionId) && value.sessionId > 0) ? value : null;
  } catch { return null; }
}
export function saveShiftSelection(scope: string, value: ShiftSelection): void {
  try { sessionStorage.setItem(shiftSelectionKey(scope), JSON.stringify(value)); } catch { /* Selection is not execution evidence. */ }
}
/** A list position or another branch's shift is never a context selector. */
export function eligiblePosSessions(sessions: PosSession[] | undefined, branchId: number | null, userId: number | undefined) {
  return (sessions ?? []).filter(s => s.status === "open" && s.branchId === branchId &&
    (s.cashierUserId == null || s.cashierUserId === userId));
}
export function selectedPosSession(sessions: PosSession[] | undefined, branchId: number | null, userId: number | undefined, preferredId?: number) {
  const candidates = eligiblePosSessions(sessions, branchId, userId);
  const preferred = candidates.find(s => s.id === preferredId);
  // An invalid/stale preference is not evidence that the branch has no shift.
  return preferred ?? (candidates.length === 1 ? candidates[0] : undefined);
}
