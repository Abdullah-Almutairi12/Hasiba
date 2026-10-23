import { useEffect, useRef, useState } from "react";
import { createPosOrder, type CreatePosOrderBody } from "@workspace/api-client-react";

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
};
const uncertain = "تعذر تأكيد نتيجة البيع؛ قد تكون العملية حُفظت بالفعل. لا تعاود تحصيل المبلغ. اضغط «استرجاع نتيجة البيع» لإعادة الطلب نفسه دون إنشاء فاتورة مكررة.";
const storageFailure = "تعذر حفظ محاولة البيع بأمان. لم يُرسل طلب جديد؛ فعّل تخزين الجلسة وأعد المحاولة.";
const cleanupFailure = "تم تسجيل البيع بالفعل، لكن تعذر تنظيف محاولة البيع من تخزين الجلسة. فعّل التخزين ثم اضغط «استرجاع نتيجة البيع» لتأكيدها، ولا تعاود تحصيل المبلغ.";

function readAttempt(raw: string): Attempt {
  const value = JSON.parse(raw) as Attempt;
  if (!value || typeof value.key !== "string" || !/^[a-zA-Z0-9_.:-]{8,128}$/.test(value.key) ||
    !Number.isInteger(value.body?.sessionId) || !Array.isArray(value.body?.items) ||
    !Array.isArray(value.cart) || value.cart.length === 0 ||
    value.cart.length !== value.body.items.length ||
    !["cash", "card", "stc", "transfer"].includes(value.body.paymentMethod ?? "") ||
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
  async function pay(body: CreatePosOrderBody, cart: PosCartItem[]) {
    if (!storageKey || !isCurrent || !state.ready || inFlight.current) return null;
    inFlight.current = true;
    const wasRecovery = !!state.attempt;
    let attempt = state.attempt;
    const update = (changes: Partial<typeof state>) => {
      if (scopeRef.current === storageKey) setState((old) => ({ ...old, ...changes }));
    };
    try {
      if (!attempt) {
        try {
          attempt = { key: crypto.randomUUID(), body, cart };
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

  return {
    pay,
    attempt: isCurrent ? state.attempt : null,
    error: isCurrent ? state.error : "",
    ready: isCurrent && state.ready,
    isPending: state.busy || inFlight.current,
  };
}
