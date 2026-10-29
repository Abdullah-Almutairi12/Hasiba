import { useCallback, useEffect, useRef, useState } from "react";
import { diffPreviews, factsKey, isExpired, isTaxPreview, stableKey, submitTokens, type PreviewDiff, type TaxPreview } from "@/lib/tax-preview";

type Options<B> = {
  /** Exact preview request; null when there is nothing to quote. */
  body: B | null;
  fetcher: (body: B) => Promise<TaxPreview>;
  /**
   * True while an unknown financial intent exists. The hook then does nothing:
   * no fetch, no refresh, no state change. The frozen attempt keeps its own tokens.
   */
  frozen?: boolean;
  /** Mode from a separately loaded tax context, if any. */
  knownMode?: string | null;
  debounceMs?: number;
  /** Refresh this long before expiresAt. */
  refreshLeadMs?: number;
};

type State = {
  key: string | null;
  preview: TaxPreview | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  expired: boolean;
};

export type TaxPreviewHandle = ReturnType<typeof useTaxPreview>;

export function useTaxPreview<B>({ body, fetcher, frozen = false, knownMode = null, debounceMs = 400, refreshLeadMs = 3000 }: Options<B>) {
  const key = body ? stableKey(body) : null;
  const [state, setState] = useState<State>({ key: null, preview: null, status: "idle", error: "", expired: false });
  const [reviewed, setReviewed] = useState<{ bodyKey: string; facts: string; preview: TaxPreview } | null>(null);
  const seq = useRef(0);
  const keyRef = useRef(key);
  keyRef.current = key;
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const modeRef = useRef<string | null>(knownMode);
  if (knownMode) modeRef.current = knownMode;
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  const run = useCallback(() => {
    const b = bodyRef.current, k = keyRef.current;
    if (!b || !k || frozenRef.current) return;
    const mine = ++seq.current;
    setState((s) => ({ ...s, key: k, status: "loading", error: "" }));
    fetcherRef.current(b).then((res) => {
      // Ignore races: an older request or a changed body never wins.
      if (mine !== seq.current || keyRef.current !== k || frozenRef.current) return;
      if (!isTaxPreview(res)) { setState({ key: k, preview: null, status: "error", error: "رد المعاينة غير صالح", expired: false }); return; }
      modeRef.current = res.context.mode;
      setState({ key: k, preview: res, status: "ready", error: "", expired: isExpired(res, Date.now()) });
    }, (err: unknown) => {
      if (mine !== seq.current || keyRef.current !== k || frozenRef.current) return;
      setState({ key: k, preview: null, status: "error", error: err instanceof Error ? err.message : "تعذر حساب المعاينة", expired: false });
    });
  }, []);

  // Body change: invalidate immediately, then debounce a fresh quote.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (frozen) return;
    // Unfreezing with an unchanged body keeps the still-valid quote (and review).
    const cur = stateRef.current;
    if (key && cur.key === key && cur.preview && !isExpired(cur.preview, Date.now())) return;
    seq.current++;
    if (!key) { setState({ key: null, preview: null, status: "idle", error: "", expired: false }); return; }
    setState({ key, preview: null, status: "loading", error: "", expired: false });
    const t = setTimeout(run, debounceMs);
    return () => clearTimeout(t);
  }, [key, frozen, debounceMs, run]);

  // Expiry: mark expired at expiresAt and refresh slightly before it.
  useEffect(() => {
    const p = state.preview;
    if (frozen || !p || state.key !== key) return;
    const at = Date.parse(p.expiresAt);
    if (!Number.isFinite(at)) return;
    const now = Date.now();
    const refresh = setTimeout(run, Math.max(0, at - now - refreshLeadMs));
    const expire = setTimeout(() => setState((s) => (s.preview === p ? { ...s, expired: true } : s)), Math.max(0, at - now));
    return () => { clearTimeout(refresh); clearTimeout(expire); };
  }, [state.preview, state.key, key, frozen, refreshLeadMs, run]);

  const current = state.key === key ? state : { key, preview: null, status: key ? "loading" as const : "idle" as const, error: "", expired: false };
  const preview = current.preview;
  const mode = preview?.context.mode ?? modeRef.current;
  const unified = mode === "unified";
  const expired = !!preview && (current.expired || isExpired(preview, Date.now()));
  const confirmed = !!preview && !!reviewed && reviewed.bodyKey === key && reviewed.facts === factsKey(preview);
  const diffs: PreviewDiff[] = preview && reviewed && !confirmed ? diffPreviews(reviewed.preview, preview) : [];

  // Authoritative review is required for every NEW attempt, legacy and
  // not_registered included. Unknown attempts are never gated here.
  const freshBlock: string | null = !key ? null
    : current.status === "error" ? `تعذر الحصول على معاينة الضريبة من الخادم: ${current.error}`
    : !preview ? "جارٍ حساب الضريبة من الخادم…"
    : expired ? "انتهت صلاحية المعاينة؛ جارٍ تحديثها."
    : !confirmed ? (diffs.length ? "تغيّر الحساب الضريبي منذ مراجعتك. راجع الفروق ثم أكّد." : "راجع حساب الضريبة من الخادم ثم أكّد قبل الإصدار.")
    : null;

  return {
    status: current.status,
    error: current.error,
    preview,
    mode,
    unified,
    expired,
    confirmed,
    diffs,
    previousReviewed: reviewed?.preview ?? null,
    freshBlock,
    confirm: () => { if (preview && key && !expired) setReviewed({ bodyKey: key, facts: factsKey(preview), preview }); },
    retry: run,
    /** Tokens for a fresh reviewed submission (taxContextToken only when unified). */
    tokens: () => (confirmed && !expired ? submitTokens(preview) : {}),
  };
}
