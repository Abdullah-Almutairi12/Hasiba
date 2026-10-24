import type { CreatePosSessionBody } from "@workspace/api-client-react";

/**
 * Durable intent for opening a POS shift. The key and the exact body are
 * frozen together with the responsibility header they were first sent under.
 * An unknown result keeps the intent; only success or a confirmed fresh
 * rejection clears it. A failure NEVER produces a new key.
 */
export type SessionIntent = { key: string; body: CreatePosSessionBody; responsibility: string | null };

export const sessionIntentKey = (scope: string) => `hasba:pos-session-open:${scope}`;

export function readSessionIntent(scope: string | null): SessionIntent | null | "unreadable" {
  if (!scope) return null;
  let raw: string | null;
  try { raw = sessionStorage.getItem(sessionIntentKey(scope)); } catch { return "unreadable"; }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SessionIntent;
    if (!v || typeof v.key !== "string" || !/^[a-zA-Z0-9_.:-]{8,128}$/.test(v.key) ||
      !Number.isInteger(v.body?.branchId) || !Number.isFinite(Number(v.body?.openingCash))) return "unreadable";
    return { key: v.key, body: v.body, responsibility: v.responsibility ?? null };
  } catch { return "unreadable"; }
}

export function saveSessionIntent(scope: string, intent: SessionIntent): boolean {
  try { sessionStorage.setItem(sessionIntentKey(scope), JSON.stringify(intent)); return true; } catch { return false; }
}

export function clearSessionIntent(scope: string): boolean {
  try { sessionStorage.removeItem(sessionIntentKey(scope)); return true; } catch { return false; }
}

/** A fresh 4xx (not 408/429) is a confirmed rejection; anything else is unknown. */
export function isConfirmedRejection(err: unknown): boolean {
  const s = (err as { status?: number } | null)?.status;
  return typeof s === "number" && s >= 400 && s < 500 && s !== 408 && s !== 429;
}
