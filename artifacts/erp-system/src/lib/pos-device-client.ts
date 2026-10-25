/**
 * POS trusted-device client (browser software proof).
 *
 * IMPORTANT: this is a BROWSER SOFTWARE key held by WebCrypto in IndexedDB
 * with a NON-EXTRACTABLE private key. It is NOT a Windows TPM / hardware
 * attestation. The private key is never exported, never serialised to JWK
 * and never written to localStorage, the URL or logs. PINs and activation
 * tokens are never persisted anywhere by this module.
 */

const DB_NAME = "hasba-pos-device";
const STORE = "keys";
const KEY_ID = "device-key";
/** Registration id is NOT secret; persisted so activation survives reload. */
const REG_KEY = "hasba:pos-device:registration";
/** Per-tab POS mode marker (sessionStorage only). */
const MODE_KEY = "hasba:pos-device:mode";

export type PublicJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };
export type Proof = { id: string; nonce: string; signature: string };

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const apiUrl = (p: string) => `${BASE}/api${p}`;

// ---------- IndexedDB ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      let result: T;
      r.onsuccess = () => { result = r.result as T; if (mode === "readonly") resolve(result); };
      r.onerror = () => reject(r.error);
      // Writes count only once the transaction is durably committed.
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    });
  } finally { db.close(); }
}

type StoredPair = { privateKey: CryptoKey; publicKey: CryptoKey };

export function deviceCryptoSupported(): boolean {
  return typeof indexedDB !== "undefined" && !!globalThis.crypto?.subtle;
}

async function loadPair(): Promise<StoredPair | null> {
  const v = await idb<StoredPair | undefined>("readonly", (s) => s.get(KEY_ID));
  return v && v.privateKey && v.publicKey ? v : null;
}

let keyInFlight: Promise<StoredPair> | null = null;

/**
 * Returns existing key pair or creates one (private key NON-extractable).
 * Concurrent callers share ONE in-flight promise, so StrictMode double
 * effects can never create two different pairs. Resolves only after the
 * IndexedDB write transaction has completed and the pair is re-read.
 */
export function ensureDeviceKey(): Promise<StoredPair> {
  if (!keyInFlight) {
    keyInFlight = createOrLoadKey().finally(() => { keyInFlight = null; });
  }
  return keyInFlight;
}

async function createOrLoadKey(): Promise<StoredPair> {
  const existing = await loadPair();
  if (existing) return existing;
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const stored: StoredPair = { privateKey: pair.privateKey, publicKey: pair.publicKey };
  await idb("readwrite", (s) => s.put(stored, KEY_ID));
  const persisted = await loadPair();
  if (!persisted) throw new Error("device key was not persisted");
  return persisted;
}

export async function hasDeviceKey(): Promise<boolean> {
  try { return !!(await loadPair()); } catch { return false; }
}

/** Exports ONLY kty/crv/x/y of the public key. */
export async function getPublicJwk(): Promise<PublicJwk> {
  const { publicKey } = await ensureDeviceKey();
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  if (!jwk.x || !jwk.y) throw new Error("public key export failed");
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

/**
 * Why discarding this browser's device key is refused, or null if allowed.
 * Refuses while POS mode is on or ANY unresolved local financial evidence
 * (any actor) exists, so no intent is ever orphaned.
 */
export function forgetBlockReason(): string | null {
  if (isPosMode()) return "جلسة الكاشير ما زالت مفتوحة في هذا التبويب. اقفل الجهاز أولاً.";
  const pending = findAnyPendingEvidence();
  if (pending.length) return `توجد عمليات مالية غير مؤكدة على هذا المتصفح (${pending.map((p) => p.label).join("، ")}). يجب أن يسترجعها الكاشير الأصلي قبل إزالة التسجيل.`;
  return null;
}

/** Discards this browser's key and registration. Caller must end the server session first. */
export async function forgetDevice(): Promise<void> {
  const reason = forgetBlockReason();
  if (reason) throw new Error(reason);
  await idb("readwrite", (s) => s.delete(KEY_ID));
  setRegistrationId(null);
  clearActor();
}

export function parsePublicJwk(text: string): PublicJwk | null {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    const ok = (s: unknown) => typeof s === "string" && /^[A-Za-z0-9_-]{40,46}$/.test(s);
    if (v.kty !== "EC" || v.crv !== "P-256" || !ok(v.x) || !ok(v.y) || "d" in v) return null;
    return { kty: "EC", crv: "P-256", x: v.x as string, y: v.y as string };
  } catch { return null; }
}

// ---------- registration / mode ----------
export function getRegistrationId(): string | null {
  try { return localStorage.getItem(REG_KEY); } catch { return null; }
}
export function setRegistrationId(id: string | null): void {
  try { if (id) localStorage.setItem(REG_KEY, id); else localStorage.removeItem(REG_KEY); } catch { /* ignore */ }
}
export function isPosMode(): boolean {
  try { return sessionStorage.getItem(MODE_KEY) === "1"; } catch { return false; }
}
export function setPosMode(on: boolean): void {
  try { if (on) sessionStorage.setItem(MODE_KEY, "1"); else sessionStorage.removeItem(MODE_KEY); } catch { /* ignore */ }
}

// ---------- signing ----------
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlText(text: string): string { return b64url(new TextEncoder().encode(text)); }

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function bindingFor(method: string, pathWithQuery: string, body: unknown): Promise<string> {
  return sha256Hex(`${method.toUpperCase()}:${pathWithQuery}:${JSON.stringify(body ?? {})}`);
}

let originalFetch: typeof fetch = (...a) => fetch(...a);

/**
 * Issues a challenge through the ORIGINAL fetch (never recursive) and signs
 * UTF-8(payload) with ECDSA P-256/SHA-256 (IEEE-P1363 raw signature).
 */
export async function signProof(
  purpose: "activate" | "unlock" | "request",
  method: string,
  pathWithQuery: string,
  body: unknown,
  issue?: (input: { deviceId: string; purpose: "activate" | "unlock" | "request"; binding: string }) => Promise<{ id: string; nonce: string; payload: string }>,
): Promise<Proof> {
  const deviceId = getRegistrationId();
  if (!deviceId) throw new Error("هذا المتصفح غير مسجل كجهاز نقطة بيع.");
  const pair = await loadPair();
  if (!pair) throw new Error("مفتاح الجهاز غير موجود في هذا المتصفح.");
  const binding = await bindingFor(method, pathWithQuery, body);
  const ch = issue ? await issue({ deviceId, purpose, binding }) : await challengeViaOriginal(deviceId, purpose, binding);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(ch.payload),
  );
  return { id: ch.id, nonce: ch.nonce, signature: b64url(sig) };
}

async function challengeViaOriginal(deviceId: string, purpose: string, binding: string): Promise<{ id: string; nonce: string; payload: string }> {
  const res = await originalFetch(apiUrl("/pos-device/challenge"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, purpose, binding }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw Object.assign(new Error(e.error ?? `تعذر إصدار تحدي الجهاز (${res.status})`), { status: res.status });
  }
  return (await res.json()) as { id: string; nonce: string; payload: string };
}

// ---------- fetch wrapper ----------
const EXCLUDED = new Set([
  "/api/pos-device/challenge",
  "/api/pos-device/activate",
  "/api/pos-device/unlock",
  "/api/pos-device/lock",
  "/api/auth/logout",
]);

let installed = false;

/** Install ONCE in main.tsx before any query runs. No-op unless POS mode is on. */
export function installPosDeviceFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = window.fetch.bind(window);
  originalFetch = orig;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isPosMode()) return orig(input, init);
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    } catch { return orig(input, init); }
    if (url.origin !== window.location.origin) return orig(input, init);
    const apiPrefix = `${BASE}/api/`;
    if (!url.pathname.startsWith(apiPrefix)) return orig(input, init);
    const serverPath = url.pathname.slice(BASE.length);
    if (EXCLUDED.has(serverPath)) return orig(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let body: unknown = {};
    if (typeof init?.body === "string" && init.body.length) {
      try { body = JSON.parse(init.body); } catch { body = {}; }
    }
    const proof = await signProof("request", method, url.pathname + url.search, body);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("X-POS-Proof", b64urlText(JSON.stringify(proof)));
    return orig(input, { ...init, headers });
  };
}

// ---------- pending financial evidence ----------
export type PendingEvidence = { kind: string; label: string };

/**
 * Read-only scan of existing persistent financial-intent namespaces for the
 * current employee + company. Never modifies or deletes anything.
 */
export function findPendingEvidence(userId: number | null | undefined, companyId: number | null | undefined): PendingEvidence[] {
  const out: PendingEvidence[] = [];
  const scope = userId && companyId ? `${userId}:${companyId}` : null;
  const scan = (st: Storage | undefined) => {
    if (!st) return;
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (!k) continue;
      if (k.startsWith("hasba:financial-request:")) out.push({ kind: "financial", label: "طلب مالي لم تتأكد نتيجته" });
      if (!scope) continue;
      if (k === `hasba:pos-checkout:${scope}`) out.push({ kind: "pos-checkout", label: "عملية بيع غير مؤكدة في نقطة البيع" });
      else if (k === `hasba:pos-session-open:${scope}`) out.push({ kind: "pos-session", label: "طلب فتح وردية لم يتأكد" });
      else if (/^hasba:returns:(request|payout|expense):/.test(k) && k.includes(`:${scope}:`)) out.push({ kind: "returns", label: "إجراء مرتجع أو صرف لم يتأكد" });
      else if (k.startsWith(`hasiba:stocktake-scan:v1:${scope}:`)) out.push({ kind: "stocktake", label: "مسحة جرد لم تتأكد" });
    }
  };
  try { scan(sessionStorage); } catch { out.push({ kind: "unreadable", label: "تعذر قراءة تخزين الجلسة للتحقق من العمليات المعلقة" }); }
  try { scan(localStorage); } catch { out.push({ kind: "unreadable", label: "تعذر قراءة التخزين المحلي للتحقق من العمليات المعلقة" }); }
  return out;
}

const ANY_PATTERNS: Array<[RegExp, PendingEvidence]> = [
  [/^hasba:financial-request:/, { kind: "financial", label: "طلب مالي لم تتأكد نتيجته" }],
  [/^hasba:pos-checkout:\d+:\d+$/, { kind: "pos-checkout", label: "عملية بيع غير مؤكدة" }],
  [/^hasba:pos-session-open:/, { kind: "pos-session", label: "طلب فتح وردية لم يتأكد" }],
  [/^hasba:returns:(request|payout|expense):/, { kind: "returns", label: "إجراء مرتجع أو صرف لم يتأكد" }],
  [/^hasiba:stocktake-scan:v1:/, { kind: "stocktake", label: "مسحة جرد لم تتأكد" }],
];

/** Read-only scan for unresolved evidence of ANY actor. Fails closed. */
export function findAnyPendingEvidence(): PendingEvidence[] {
  const out: PendingEvidence[] = [];
  const scan = (st: Storage) => {
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (!k) continue;
      for (const [re, ev] of ANY_PATTERNS) if (re.test(k)) { out.push(ev); break; }
    }
  };
  try { scan(sessionStorage); } catch { out.push({ kind: "unreadable", label: "تعذر قراءة تخزين الجلسة" }); }
  try { scan(localStorage); } catch { out.push({ kind: "unreadable", label: "تعذر قراءة التخزين المحلي" }); }
  return out;
}

// ---------- original actor (non-secret) ----------
const ACTOR_KEY = "hasba:pos-device:actor";
export type PosActor = { personId: number | null; userId: number | null; companyId: number | null };

export function readActor(): PosActor | null | "unreadable" {
  let raw: string | null;
  try { raw = localStorage.getItem(ACTOR_KEY); } catch { return "unreadable"; }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const n = (x: unknown) => (Number.isInteger(x) && (x as number) > 0 ? (x as number) : null);
    return { personId: n(v.personId), userId: n(v.userId), companyId: n(v.companyId) };
  } catch { return "unreadable"; }
}
export function rememberActor(patch: Partial<PosActor>): void {
  const cur = readActor();
  const base: PosActor = cur && cur !== "unreadable" ? cur : { personId: null, userId: null, companyId: null };
  try { localStorage.setItem(ACTOR_KEY, JSON.stringify({ ...base, ...patch })); } catch { /* ignore */ }
}
function clearActor(): void { try { localStorage.removeItem(ACTOR_KEY); } catch { /* ignore */ } }

/**
 * Whether unlocking `personId` must be refused because the previous cashier
 * on this device still has unresolved evidence. Same person is always allowed
 * (so they can recover). Never modifies evidence. Fails closed.
 */
export function unlockBlockReason(personId: number): string | null {
  const actor = readActor();
  if (actor === "unreadable") return "تعذر قراءة هوية الكاشير السابق على هذا الجهاز؛ لا يمكن التحقق من العمليات المعلقة.";
  if (!actor || actor.personId === null || actor.personId === personId) return null;
  const pending = actor.userId && actor.companyId ? findPendingEvidence(actor.userId, actor.companyId) : findAnyPendingEvidence();
  if (!pending.length) return null;
  return `الكاشير السابق (رقم ${actor.personId}) لديه عمليات غير مؤكدة: ${pending.map((p) => p.label).join("، ")}. يجب أن يفتح الجهاز بنفسه ويسترجع نتيجتها من نقطة البيع، أو يسوّيها مسؤول مخوّل من جلسة المنصة. لن تُحذف ولن تُعاد تحت كاشير آخر.`;
}

/** Ephemeral, already-confirmed UI state that may be cleared on switch. */
export function clearEphemeralPosState(userId: number | null | undefined, companyId: number | null | undefined): void {
  if (!userId || !companyId) return;
  try { sessionStorage.removeItem(`hasba:pos-checkout:${userId}:${companyId}:last-receipt`); } catch { /* ignore */ }
}
