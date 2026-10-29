import { useCallback, useEffect, useRef, useState } from "react";
import { closeDirectInvoiceTaxPreviewIntent, closePosTaxPreviewIntent, getWorkspaceResponsibility } from "@workspace/api-client-react";

type CloseFn = (b: { requestKey: string; body: Record<string, unknown> }) => Promise<{ state?: unknown; result?: unknown }>;
/** Generated close-intent clients (same API base path as every generated call). */
const CLOSERS: Record<string, CloseFn> = {
  "/pos/tax-preview/close-intent": closePosTaxPreviewIntent as unknown as CloseFn,
  "/sales/invoices/tax-preview/close-intent": closeDirectInvoiceTaxPreviewIntent as unknown as CloseFn,
};
import { clearIntentIfKey, intentStorageKey, isConfirmedFreshRejection, readIntent, saveIntent, type StoredIntent } from "@/lib/durable-intent";

export type IntentOutcome<R> =
  | { kind: "created"; result: R; recovered: boolean }
  | { kind: "rejected"; status: number; data: unknown; message: string }
  | { kind: "unknown" };
export type CloseOutcome<R> = { kind: "completed"; result: R } | { kind: "closed" };

type Options<B, R> = {
  /** Financial POST path, also part of the storage scope. */
  endpoint: string;
  /** Close-intent path (POST {requestKey, body}). */
  closePath: string;
  userId: number | string | null | undefined;
  companyId: number | string | null | undefined;
  /** Sends with the caller-owned key so financialFetch never mints or deletes one. */
  send: (body: B, key: string) => Promise<R>;
  isValid: (r: unknown) => r is R;
  /** Maps the saved financialTransaction result returned by close-intent to R. */
  normalizeClosed?: (r: unknown) => unknown;
};

export const UNCERTAIN_TEXT = "تعذر تأكيد نتيجة العملية؛ قد تكون حُفظت بالفعل. لا تبدأ عملية جديدة. استخدم «استرجاع النتيجة» لإعادة الطلب نفسه، أو «تحقق وأغلق» لسؤال الخادم عن مصيره.";
const MISMATCH_TEXT = "توجد عملية غير مؤكدة سُجلت تحت مسؤولية أخرى. لن تُرسل تحت المسؤولية الحالية؛ ارجع إلى المسؤولية الأصلية من «عملي» ثم استرجعها.";
const UNREADABLE_TEXT = "تعذر قراءة العملية غير المؤكدة المحفوظة. استعد تخزين الجلسة ثم أعد التحميل؛ لا تبدأ عملية جديدة قبل مراجعة السابقة.";
const STORAGE_FAIL = "تعذر حفظ العملية بأمان قبل إرسالها. لم يُرسل أي طلب؛ فعّل تخزين الجلسة وأعد المحاولة.";
const SECRET_TEXT = "تتطلب هذه العملية بيانات اعتماد المدير الأصلية، ولا تُحفظ لأسباب أمنية. أدخلها مجددًا كما هي لإعادة الطلب نفسه أو للتحقق منه.";

/**
 * Durable, user+company+endpoint scoped financial intent. The exact body is
 * saved BEFORE sending; unknown outcomes survive reloads and are only resolved
 * by an exact replay or the server close-intent check. Quote-bound attempts
 * also require that check after fresh 4xx responses; the accepted unquoted
 * legacy rejection classification remains unchanged.
 */
export function useDurableIntent<B extends Record<string, unknown>, R, M = unknown>(o: Options<B, R>) {
  const storageKey = o.userId != null && o.companyId != null ? intentStorageKey(o.endpoint, o.userId, o.companyId) : null;
  const scopeRef = useRef(storageKey);
  scopeRef.current = storageKey;
  const optsRef = useRef(o);
  optsRef.current = o;
  const secrets = useRef<{ key: string; values: Record<string, unknown> } | null>(null);
  const inFlight = useRef(false);
  const [st, setSt] = useState<{ scope: string | null; ready: boolean; attempt: StoredIntent<B, M> | null; error: string; busy: boolean; recoveryRejected: boolean }>(
    { scope: null, ready: false, attempt: null, error: "", busy: false, recoveryRejected: false });

  useEffect(() => {
    if (!storageKey) { setSt({ scope: null, ready: false, attempt: null, error: "", busy: false, recoveryRejected: false }); return; }
    const r = readIntent<B, M>(storageKey, o.endpoint);
    if (r === "unreadable") setSt({ scope: storageKey, ready: false, attempt: null, error: UNREADABLE_TEXT, busy: false, recoveryRejected: false });
    else setSt({ scope: storageKey, ready: true, attempt: r, error: r ? UNCERTAIN_TEXT : "", busy: false, recoveryRejected: false });
  }, [storageKey, o.endpoint]);

  const current = st.scope === storageKey;
  const attempt = current ? st.attempt : null;
  const update = useCallback((sk: string, ch: Partial<typeof st>) => {
    if (scopeRef.current === sk) setSt((s) => ({ ...s, ...ch }));
  }, []);

  const exactBody = (a: StoredIntent<B, M>, supplied?: Record<string, unknown>): B | null => {
    const need = a.secretFields ?? [];
    if (!need.length) return a.body;
    const vals = supplied ?? (secrets.current?.key === a.key ? secrets.current.values : null);
    if (!vals || need.some((f) => vals[f] === undefined)) return null;
    if (supplied) secrets.current = { key: a.key, values: supplied };
    // Secret fields are always appended last, exactly as on the first send.
    const out: Record<string, unknown> = { ...a.body };
    for (const f of need) out[f] = vals[f];
    return out as B;
  };

  const cleanup = (sk: string, key: string): boolean => {
    try { clearIntentIfKey(sk, key); return true; } catch { return false; }
  };

  async function run(a: StoredIntent<B, M>, body: B, recovering: boolean): Promise<IntentOutcome<R>> {
    const sk = storageKey!;
    update(sk, { attempt: a, busy: true, error: "" });
    let res: R;
    try {
      res = await optsRef.current.send(body, a.key);
    } catch (e) {
      const status = (e as { status?: unknown } | null)?.status;
      // Preserve accepted unquoted legacy behaviour, but a quoted financial
      // attempt must be sealed on the server before its identity is replaced.
      // A 4xx response is not a durable nonexecution receipt.
      if (isConfirmedFreshRejection(status) && !recovering && !a.body.taxPreviewToken) {
        if (!cleanup(sk, a.key)) { update(sk, { error: "رفض الخادم العملية، لكن تعذر تنظيفها من التخزين. استعد التخزين ثم أعد الطلب نفسه." }); return { kind: "unknown" }; }
        secrets.current = null;
        const message = e instanceof Error ? e.message : "رفض الخادم العملية";
        update(sk, { attempt: null, error: message });
        return { kind: "rejected", status, data: (e as { data?: unknown }).data ?? null, message };
      }
      update(sk, recovering && isConfirmedFreshRejection(status)
        ? { recoveryRejected: true, error: `رفض الخادم إعادة الطلب (${status}). لا يثبت ذلك أن العملية الأصلية لم تُحفظ؛ استخدم «تحقق وأغلق» أو راجع السجل مع المسؤول.` }
        : { error: UNCERTAIN_TEXT });
      return { kind: "unknown" };
    }
    if (!optsRef.current.isValid(res)) { update(sk, { error: UNCERTAIN_TEXT }); return { kind: "unknown" }; }
    if (!cleanup(sk, a.key)) {
      update(sk, { error: "تم حفظ العملية، لكن تعذر تنظيفها من التخزين. استعد التخزين ثم استرجع النتيجة؛ لا تبدأ عملية جديدة." });
      return { kind: "unknown" };
    }
    secrets.current = null;
    update(sk, { attempt: null, error: "", recoveryRejected: false });
    return { kind: "created", result: res, recovered: recovering };
  }

  async function guard<T>(fn: (sk: string) => Promise<T | null>): Promise<T | null> {
    if (!storageKey || !current || !st.ready || inFlight.current) return null;
    inFlight.current = true;
    try { return await fn(storageKey); } finally { inFlight.current = false; update(storageKey, { busy: false }); }
  }

  /** New attempt. Ignored (returns null) if an unresolved intent exists. */
  function submit(body: B, opts?: { meta?: M; secrets?: Record<string, unknown>; secretHints?: Record<string, unknown> }) {
    return guard(async (sk) => {
      if (attempt) { update(sk, { error: UNCERTAIN_TEXT }); return null; }
      const secretFields = Object.keys(opts?.secrets ?? {});
      const stored: StoredIntent<B, M> = { v: 1, key: crypto.randomUUID(), endpoint: o.endpoint, body, responsibility: getWorkspaceResponsibility(),
        createdAt: new Date().toISOString(), ...(opts?.meta !== undefined ? { meta: opts.meta } : {}),
        ...(secretFields.length ? { secretFields, secretHints: opts?.secretHints ?? {} } : {}) };
      try { saveIntent(sk, stored); } catch { update(sk, { error: STORAGE_FAIL }); return null; }
      if (secretFields.length) secrets.current = { key: stored.key, values: opts!.secrets! };
      return run(stored, exactBody(stored)!, false);
    });
  }

  /** Exact replay of the saved intent under its original key and responsibility. */
  function recover(supplied?: Record<string, unknown>) {
    return guard(async (sk) => {
      if (!attempt) return null;
      if (attempt.responsibility !== getWorkspaceResponsibility()) { update(sk, { error: MISMATCH_TEXT }); return null; }
      const body = exactBody(attempt, supplied);
      if (!body) { update(sk, { error: SECRET_TEXT }); return null; }
      return run(attempt, body, true);
    });
  }

  /** Ask the server for the fate of the saved intent; clears only on a definite answer. */
  function close(supplied?: Record<string, unknown>) {
    return guard<CloseOutcome<R>>(async (sk) => {
      if (!attempt) return null;
      if (attempt.responsibility !== getWorkspaceResponsibility()) { update(sk, { error: MISMATCH_TEXT }); return null; }
      const body = exactBody(attempt, supplied);
      if (!body) { update(sk, { error: SECRET_TEXT }); return null; }
      update(sk, { busy: true, error: "" });
      let res: { state?: unknown; result?: unknown };
      try {
        const closer = CLOSERS[o.closePath];
        if (!closer) throw new Error("close endpoint unavailable");
        res = await closer({ requestKey: attempt.key, body: body as Record<string, unknown> });
      } catch (e) {
        const status = (e as { status?: unknown }).status;
        update(sk, { error: `تعذر التحقق من العملية${typeof status === "number" ? ` (${status})` : ""}. بقيت محفوظة كما هي؛ أعد المحاولة لاحقًا أو راجع السجل مع المسؤول.` });
        return null;
      }
      const completedResult = res?.state === "completed" ? (optsRef.current.normalizeClosed ?? ((x: unknown) => x))(res.result) : undefined;
      const definite = res?.state === "closed_without_execution" || (res?.state === "completed" && optsRef.current.isValid(completedResult));
      if (!definite) { update(sk, { error: "رد التحقق غير مفهوم؛ بقيت العملية محفوظة." }); return null; }
      if (!cleanup(sk, attempt.key)) { update(sk, { error: "تأكدت النتيجة، لكن تعذر تنظيف التخزين. استعد التخزين ثم تحقق مجددًا." }); return null; }
      secrets.current = null;
      update(sk, { attempt: null, error: "", recoveryRejected: false });
      return res.state === "completed" ? { kind: "completed", result: completedResult as R } : { kind: "closed" };
    });
  }

  return {
    ready: current && st.ready,
    attempt,
    error: current ? st.error : "",
    busy: st.busy || inFlight.current,
    recoveryRejected: current && st.recoveryRejected,
    scopeMismatch: !!attempt && attempt.responsibility !== getWorkspaceResponsibility(),
    needsSecrets: !!attempt && !!attempt.secretFields?.length && !(secrets.current?.key === attempt.key),
    submit, recover, close,
  };
}
