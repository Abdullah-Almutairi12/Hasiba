import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useReturnAction,
  getGetReturnWorkspaceQueryKey,
  getListPosSessionsQueryKey,
} from "@workspace/api-client-react";
import type { ReturnActionBodyAction } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { readErr, rec, isDefinitive, type ErrInfo, type Rec } from "@/lib/returns/shared";

export type ActResult = { ok: true; res: Rec } | { ok: false; err: ErrInfo };

/**
 * Sends one returns action, then refreshes the workspace and the POS
 * session list (closing status). Only those query keys are invalidated, so
 * the POS checkout intent stored in sessionStorage is never touched.
 */
export function useAct() {
  const qc = useQueryClient();
  const m = useReturnAction();
  const mutateRef = useRef(m.mutateAsync);
  mutateRef.current = m.mutateAsync;
  const run = useCallback(async (action: ReturnActionBodyAction, payload: Rec): Promise<ActResult> => {
    try {
      const res = await mutateRef.current({ data: { action, payload } });
      return { ok: true, res: rec(res) };
    } catch (e) {
      return { ok: false, err: readErr(e) };
    } finally {
      void qc.invalidateQueries({ queryKey: getGetReturnWorkspaceQueryKey() });
      void qc.invalidateQueries({ queryKey: getListPosSessionsQueryKey() });
    }
  }, [qc]);
  return { run, pending: m.isPending };
}

/** Same scope convention as the POS checkout hook: `${userId}:${companyId}`. */
export function useActorScope(): string | null {
  const { user } = useAuth();
  return user?.id && user?.companyId ? `${user.id}:${user.companyId}` : null;
}

export type DurableKind = "payout" | "request" | "expense";
export const DURABLE_KINDS: DurableKind[] = ["request", "payout", "expense"];
/** Every stored record is treated as an attempt whose outcome is unknown. */
export type DurableIntent = { body: Rec; savedAt: string };

const PREFIX = "hasba:returns:";
const SYNC_EVENT = "hasba-returns-intents";
export const intentKey = (kind: DurableKind, scope: string, id: string) => `${PREFIX}${kind}:${scope}:${id}`;

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function read(key: string): DurableIntent | null {
  try {
    const v = rec(JSON.parse(sessionStorage.getItem(key) ?? "null"));
    const body = rec(v.body);
    return typeof body.idempotencyKey === "string" ? { body, savedAt: typeof v.savedAt === "string" ? v.savedAt : "" } : null;
  } catch { return null; }
}
/** Writes and reads back; returns false if storage is unavailable or did not persist. */
function writeVerified(key: string, intent: DurableIntent): boolean {
  try {
    const raw = JSON.stringify(intent);
    sessionStorage.setItem(key, raw);
    if (sessionStorage.getItem(key) !== raw) return false;
  } catch { return false; }
  window.dispatchEvent(new Event(SYNC_EVENT));
  return true;
}
function remove(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* nothing stored anyway */ }
  window.dispatchEvent(new Event(SYNC_EVENT));
}

/** Lists stored attempts for exactly this actor + company. Never returns other actors' keys. */
export function listScopedIntents(scope: string): Array<{ kind: DurableKind; id: string; intent: DurableIntent }> {
  const out: Array<{ kind: DurableKind; id: string; intent: DurableIntent }> = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k) continue;
      for (const kind of DURABLE_KINDS) {
        const p = `${PREFIX}${kind}:${scope}:`;
        if (!k.startsWith(p)) continue;
        const id = k.slice(p.length);
        const intent = read(k);
        if (id && !id.includes(":") && intent) out.push({ kind, id, intent });
      }
    }
  } catch { /* storage unavailable */ }
  return out;
}

/** Re-renders when any returns intent changes in this window or another tab. */
export function useIntentStorageVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    window.addEventListener(SYNC_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => { window.removeEventListener(SYNC_EVENT, bump); window.removeEventListener("storage", bump); };
  }, []);
  return v;
}

export const STORAGE_DENIED: ErrInfo = {
  status: null,
  message: "تعذّر حفظ نسخة آمنة من العملية في هذا المتصفح، لذلك لم تُرسل. فعّل تخزين الجلسة (أوقف التصفح الخاص أو حرّر مساحة) ثم أعد المحاولة.",
  diagnosticRef: "",
};

/**
 * Durable money action.
 * - Body + idempotencyKey are written (and verified) to sessionStorage
 *   before HTTP; if the write fails nothing is sent.
 * - Success clears the record.
 * - Only a *fresh first send* rejected with a 4xx clears it. Once a record
 *   has existed across an unknown outcome (5xx/transport/reload), any
 *   non-success keeps it frozen: a later 403/409 does not prove the earlier
 *   attempt was not committed.
 * - A key is minted only when nothing is stored; replays reuse body + key.
 */
export function useDurableAction(kind: DurableKind, targetId: string | null) {
  const scope = useActorScope();
  const { run, pending } = useAct();
  const version = useIntentStorageVersion();
  const key = scope && targetId ? intentKey(kind, scope, targetId) : null;
  const [intent, setIntent] = useState<DurableIntent | null>(null);
  const [error, setError] = useState<ErrInfo | null>(null);
  const inFlight = useRef(false);

  useEffect(() => { setIntent(key ? read(key) : null); }, [key, version]);
  useEffect(() => { setError(null); }, [key]);

  const send = useCallback(async (build: () => Rec): Promise<boolean> => {
    if (!key || inFlight.current) return false;
    setError(null);
    const stored = read(key);
    const fresh = !stored;
    const next: DurableIntent = stored ?? { body: { ...build(), idempotencyKey: newKey() }, savedAt: new Date().toISOString() };
    if (fresh && !writeVerified(key, next)) {
      setError(STORAGE_DENIED);
      return false;
    }
    setIntent(next);
    inFlight.current = true;
    try {
      const r = await run(kind, next.body);
      if (r.ok) { remove(key); setIntent(null); return true; }
      if (fresh && isDefinitive(r.err)) { remove(key); setIntent(null); }
      setError(r.err);
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [key, kind, run]);

  return { intent, frozen: !!intent, error, clearError: () => setError(null), send, pending, ready: !!key };
}
