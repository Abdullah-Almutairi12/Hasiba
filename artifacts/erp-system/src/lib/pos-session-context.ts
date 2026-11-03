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
export function selectedPosSession(sessions: PosSession[] | undefined, branchId: number | null, userId: number | undefined, preferredId?: number) {
  const candidates = (sessions ?? []).filter(s => s.status === "open" && s.branchId === branchId);
  if (preferredId) return candidates.find(s => s.id === preferredId && (s.cashierUserId == null || s.cashierUserId === userId));
  const own = candidates.filter(s => s.cashierUserId === userId);
  if (own.length === 1) return own[0];
  // Preserve a single pre-identity legacy shift only in an explicitly bound branch.
  const legacy = candidates.filter(s => s.cashierUserId == null);
  return candidates.length === 1 && legacy.length === 1 ? legacy[0] : undefined;
}
