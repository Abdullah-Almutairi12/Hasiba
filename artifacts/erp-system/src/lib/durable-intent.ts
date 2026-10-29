// Durable, scoped storage for token-bearing financial intents (direct invoice,
// classic POS). Stores the EXACT body that is sent, its caller-owned
// Idempotency-Key and the responsibility header. Never stores secrets: callers
// must strip credentials before saving (see `secretFields`).

export type StoredIntent<B, M = unknown> = {
  v: 1;
  key: string;
  endpoint: string;
  body: B;
  responsibility: string | null;
  createdAt: string;
  /** Non-secret display snapshot (cart, form lines). */
  meta?: M;
  /** Names of in-memory-only fields that must be re-supplied for an exact replay. */
  secretFields?: string[];
  /** Non-secret parts of those fields kept for the prompt (e.g. manager email). */
  secretHints?: Record<string, unknown>;
};

export const intentStorageKey = (endpoint: string, userId: number | string, companyId: number | string) =>
  `hasba:financial-intent:${endpoint}:${userId}:${companyId}`;

const KEY_RE = /^[a-zA-Z0-9_.:-]{8,128}$/;

export function parseIntent<B, M>(raw: string, endpoint: string): StoredIntent<B, M> {
  const v = JSON.parse(raw) as StoredIntent<B, M>;
  if (!v || v.v !== 1 || typeof v.key !== "string" || !KEY_RE.test(v.key) || v.endpoint !== endpoint ||
    !v.body || typeof v.body !== "object" || !(v.responsibility === null || typeof v.responsibility === "string")) {
    throw new Error("Invalid saved financial intent");
  }
  return v;
}

/** Read without modifying. "unreadable" = evidence exists but cannot be trusted. */
export function readIntent<B, M>(storageKey: string, endpoint: string): StoredIntent<B, M> | null | "unreadable" {
  let raw: string | null;
  try { raw = sessionStorage.getItem(storageKey); } catch { return "unreadable"; }
  if (!raw) return null;
  try { return parseIntent<B, M>(raw, endpoint); } catch { return "unreadable"; }
}

export function saveIntent(storageKey: string, intent: StoredIntent<unknown, unknown>): void {
  sessionStorage.setItem(storageKey, JSON.stringify(intent));
}

/**
 * Remove only if the stored intent is still exactly ours. A newer intent
 * (another tab copy, a later attempt) is never erased.
 */
export function clearIntentIfKey(storageKey: string, key: string): "cleared" | "newer" | "absent" {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return "absent";
  let storedKey: unknown;
  try { storedKey = (JSON.parse(raw) as { key?: unknown }).key; } catch { return "newer"; }
  if (storedKey !== key) return "newer";
  sessionStorage.removeItem(storageKey);
  return "cleared";
}

export function isConfirmedFreshRejection(status: unknown): status is number {
  return typeof status === "number" && status >= 400 && status < 500 && ![408, 429].includes(status);
}
