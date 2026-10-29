import { useEffect, useRef, useState } from "react";
import { clearIntentIfKey } from "@/lib/durable-intent";
import { closePosTaxPreviewIntent, createPosOrder, getWorkspaceResponsibility, type CreatePosOrderBody } from "@workspace/api-client-react";

export type PosProduct = {
  id: number;
  name: string;
  nameAr?: string;
  price: number;
  imageUrl?: string | null;
  stock?: number | null;
  categoryId?: number | null;
};
export type PosCartItem = { product: PosProduct; quantity: number };
type Attempt = {
  key: string;
  body: CreatePosOrderBody;
  cart: PosCartItem[];
  /**
   * Responsibility header the intent was first sent under (null = none,
   * e.g. owners). Older saved attempts lack it and are treated as null.
   * Recovery is only ever re-sent under this exact header.
   */
  responsibility?: string | null;
};

const scopeMismatchText = "لديك عملية بيع غير مؤكدة سُجلت تحت مسؤولية أخرى. لن يُعاد إرسالها تحت المسؤولية الحالية. ارجع إلى «عملي» واختر المسؤولية الأصلية ثم افتح نقطة البيع لاسترجاع النتيجة. لا تعاود التحصيل.";

/**
 * Read-only peek at the saved unresolved checkout for a scope, using the
 * same storage key and validator as the hook. Never modifies storage.
 * Returns "unreadable" when evidence exists but cannot be parsed.
 */
export function readPendingPosAttempt(scope: string | null): { responsibility: string | null } | "unreadable" | null {
  if (!scope) return null;
  let raw: string | null;
  try { raw = sessionStorage.getItem(`hasba:pos-checkout:${scope}`); } catch { return "unreadable"; }
  if (!raw) return null;
  try { return { responsibility: readAttempt(raw).responsibility ?? null }; } catch { return "unreadable"; }
}
const uncertain = "تعذر تأكيد نتيجة البيع؛ قد تكون العملية حُفظت بالفعل. لا تعاود تحصيل المبلغ. اضغط «استرجاع نتيجة البيع» لإعادة الطلب نفسه دون إنشاء فاتورة مكررة.";
const storageFailure = "تعذر حفظ محاولة البيع بأمان. لم يُرسل طلب جديد؛ فعّل تخزين الجلسة وأعد المحاولة.";
const cleanupFailure = "تم تسجيل البيع بالفعل، لكن تعذر تنظيف محاولة البيع من تخزين الجلسة. فعّل التخزين ثم اضغط «استرجاع نتيجة البيع» لتأكيدها، ولا تعاود تحصيل المبلغ.";

function readAttempt(raw: string): Attempt {
  const value = JSON.parse(raw) as Attempt;
  if (!value || typeof value.key !== "string" || !/^[a-zA-Z0-9_.:-]{8,128}$/.test(value.key) ||
    !Number.isInteger(value.body?.sessionId) || !Array.isArray(value.body?.items) ||
    !Array.isArray(value.cart) || value.cart.length === 0 ||
    value.cart.length !== value.body.items.length ||
    !["cash", "card", "stc", "transfer", "deferred"].includes(value.body.paymentMethod ?? "") ||
    value.cart.some((item, index) => !Number.isInteger(item?.product?.id) ||
      typeof item.product.name !== "string" || !Number.isFinite(Number(item.product.price)) ||
      !Number.isFinite(item.quantity) || item.quantity <= 0 ||
      item.product.id !== value.body.items[index]?.productId ||
      item.quantity !== value.body.items[index]?.quantity)) {
    throw new Error("Invalid saved POS checkout");
  }
  return value;
}

/**
 * Own the durable intent key explicitly. The generic transport deliberately
 * does not clear caller-owned keys. Thus a browser cleanup failure after a
 * confirmed response can still replay the SAME committed sale safely.
 * Only product/cart snapshots are stored; never payment-card credentials.
 */
export function usePosCheckout(scope: string | null) {
  const storageKey = scope ? `hasba:pos-checkout:${scope}` : null;
  const scopeRef = useRef(storageKey);
  scopeRef.current = storageKey;
  const inFlight = useRef(false);
  const [state, setState] = useState<{
    scope: string | null; ready: boolean; attempt: Attempt | null; error: string; busy: boolean;
  }>({ scope: null, ready: false, attempt: null, error: "", busy: false });

  useEffect(() => {
    if (!storageKey) {
      setState({ scope: null, ready: false, attempt: null, error: "", busy: false });
      return;
    }
    try {
      const raw = sessionStorage.getItem(storageKey);
      const attempt = raw ? readAttempt(raw) : null;
      setState({ scope: storageKey, ready: true, attempt, error: attempt ? uncertain : "", busy: false });
    } catch {
      // Never discard an unreadable intent: it may already have committed.
      setState({ scope: storageKey, ready: false, attempt: null,
        error: "تعذر قراءة محاولة البيع المحفوظة. استعد إمكانية تخزين الجلسة ثم أعد تحميل الصفحة؛ لا تبدأ تحصيلًا جديدًا قبل مراجعة نتيجة البيع السابق.", busy: false });
    }
  }, [storageKey]);

  const isCurrent = state.scope === storageKey;
  /**
   * `onRejected` fires ONLY for a confirmed, fresh 4xx rejection (the saved
   * intent was cleared). It never fires for ambiguous results or for a
   * recovery replay, so callers can never replace unknown evidence.
   */
  async function pay(body: CreatePosOrderBody, cart: PosCartItem[], opts?: { onRejected?: (status: number, data: unknown) => void }) {
    if (!storageKey || !isCurrent || !state.ready || inFlight.current) return null;
    // Never replay an unknown intent under a different responsibility: a 403
    // there proves nothing about whether the original committed.
    if (state.attempt && (state.attempt.responsibility ?? null) !== getWorkspaceResponsibility()) {
      setState((old) => ({ ...old, error: scopeMismatchText }));
      return null;
    }
    inFlight.current = true;
    const wasRecovery = !!state.attempt;
    let attempt = state.attempt;
    const update = (changes: Partial<typeof state>) => {
      if (scopeRef.current === storageKey) setState((old) => ({ ...old, ...changes }));
    };
    try {
      if (!attempt) {
        try {
          attempt = { key: crypto.randomUUID(), body, cart, responsibility: getWorkspaceResponsibility() };
          sessionStorage.setItem(storageKey, JSON.stringify(attempt));
        } catch {
          update({ error: storageFailure });
          return null;
        }
      }
      update({ attempt, busy: true, error: "" });
      let created;
      try {
        created = await createPosOrder(attempt.body, {
          headers: { "Idempotency-Key": attempt.key },
        });
      } catch (error) {
        const status = (error as { status?: number } | null)?.status;
        const rejected = typeof status === "number" && status >= 400 && status < 500 &&
          ![408, 429].includes(status);
        // A fresh 4xx is a confirmed rejection. A 4xx on recovery (e.g.
        // revoked permission) cannot prove that the ORIGINAL sale rolled back.
        if (rejected && !wasRecovery) {
          try {
            sessionStorage.removeItem(storageKey);
            update({ attempt: null, error: error instanceof Error ? error.message : "رفض الخادم البيع." });
            opts?.onRejected?.(status!, (error as { data?: unknown }).data ?? null);
          } catch {
            update({ error: "رفض الخادم البيع، لكن تعذر تنظيف المحاولة. استعد تخزين الجلسة ثم أعد الطلب نفسه." });
          }
        } else {
          update({ error: uncertain });
        }
        return null;
      }
      // A malformed "success" must not unlock a second financial intent.
      if (!created || !Number.isInteger(created.id) || !created.orderNumber ||
        !Number.isFinite(Number(created.total))) {
        update({ error: uncertain });
        return null;
      }
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        update({ error: cleanupFailure });
        return null;
      }
      update({ attempt: null, error: "" });
      return scopeRef.current === storageKey ? created : null;
    } finally {
      inFlight.current = false;
      update({ busy: false });
    }
  }

  /**
   * Narrow server check for the saved attempt (same key + exact body). Clears
   * only on a definite answer and only if storage still holds THIS key.
   * A completed answer is the original sale's result, never a new sale.
   */
  async function close(): Promise<{ kind: "completed"; result: NonNullable<Awaited<ReturnType<typeof createPosOrder>>> } | { kind: "closed" } | null> {
    const attempt = isCurrent ? state.attempt : null;
    if (!storageKey || !attempt || inFlight.current) return null;
    if ((attempt.responsibility ?? null) !== getWorkspaceResponsibility()) { setState((o) => ({ ...o, error: scopeMismatchText })); return null; }
    inFlight.current = true;
    const update = (changes: Partial<typeof state>) => { if (scopeRef.current === storageKey) setState((old) => ({ ...old, ...changes })); };
    update({ busy: true });
    try {
      let res: { state?: unknown; result?: unknown };
      try {
        res = await closePosTaxPreviewIntent({ requestKey: attempt.key, body: attempt.body } as unknown as Parameters<typeof closePosTaxPreviewIntent>[0]) as { state?: unknown; result?: unknown };
      } catch (e) {
        const status = (e as { status?: unknown }).status;
        update({ error: `تعذر التحقق من عملية البيع${typeof status === "number" ? ` (${status})` : ""}. بقيت محفوظة كما هي؛ لا تعاود التحصيل.` });
        return null;
      }
      const result = res?.state === "completed" ? res.result as Awaited<ReturnType<typeof createPosOrder>> : null;
      const ok = res?.state === "closed_without_execution" ||
        (!!result && Number.isInteger(result.id) && !!result.orderNumber && Number.isFinite(Number(result.total)));
      if (!ok) { update({ error: "رد التحقق غير مفهوم؛ بقيت عملية البيع محفوظة." }); return null; }
      try { clearIntentIfKey(storageKey, attempt.key); } catch { update({ error: cleanupFailure }); return null; }
      update({ attempt: null, error: "" });
      return result ? { kind: "completed", result } : { kind: "closed" };
    } finally {
      inFlight.current = false;
      update({ busy: false });
    }
  }

  const attemptNow = isCurrent ? state.attempt : null;
  return {
    pay,
    close,
    /** True when a saved unknown attempt belongs to another responsibility. */
    scopeMismatch: !!attemptNow && (attemptNow.responsibility ?? null) !== getWorkspaceResponsibility(),
    attempt: isCurrent ? state.attempt : null,
    error: isCurrent ? state.error : "",
    ready: isCurrent && state.ready,
    isPending: state.busy || inFlight.current,
  };
}
