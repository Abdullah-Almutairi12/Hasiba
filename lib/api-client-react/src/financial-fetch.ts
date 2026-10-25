// Persist only a digest and random request ID, never the financial body.
// A confirmed success starts a NEW intent next time; an uncertain outcome
// retains the key across retries/reloads in this tab.
const financialPath = /\/api\/(?:sales\/(?:invoices(?:\/\d+\/reverse)?|receipts|credit-notes)|procurement\/(?:purchase-orders|goods-receipts)|pos\/orders|inventory\/moves|invoices(?:\/from-scan|\/\d+\/reverse)?)$/;
const pending = new Map<string, Promise<{ storageKey: string; key: string }>>();
const uncertainOutcomeMessage = "تعذر تأكيد نتيجة العملية؛ قد تكون حُفظت بالفعل. أعد المحاولة بنفس البيانات لاسترجاع النتيجة دون إنشاء عملية مكررة.";

export async function financialFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = url.split("?")[0];
  if ((init.method ?? "GET").toUpperCase() !== "POST" || !financialPath.test(path)) return fetch(input, init);
  const headers = new Headers(init.headers);
  if (headers.has("Idempotency-Key")) return fetch(input, init);
  if (typeof init.body !== "string") throw new Error("يلزم إرسال بيانات العملية المالية بصيغة JSON");
  const signature = `${path}\n${init.body}`;
  let reservation = pending.get(signature);
  if (!reservation) {
    reservation = (async () => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
      const digest = Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");
      const storageKey = `hasba:financial-request:${digest}`;
      const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
      return { storageKey, key };
    })();
    pending.set(signature, reservation);
  }
  let lease: { storageKey: string; key: string };
  try {
    lease = await reservation;
  } catch {
    if (pending.get(signature) === reservation) pending.delete(signature);
    throw new Error("تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.");
  }
  const { storageKey, key } = lease;
  headers.set("Idempotency-Key", key);
  let response: Response;
  try {
    response = await fetch(input, { ...init, headers });
    if (response.ok && response.status !== 204) await response.clone().json();
  } catch (cause) {
    throw new Error(uncertainOutcomeMessage, { cause });
  } finally {
    if (pending.get(signature) === reservation) pending.delete(signature);
  }
  // A proxy/server failure is not evidence that the transaction rolled back.
  // Throw before callers turn an HTML/plain-text gateway response into "HTTP 502".
  if (response.status >= 500 || [408, 429].includes(response.status)) {
    throw new Error(uncertainOutcomeMessage);
  }
  // Read/session/scope withdrawal can deny disclosure of an ALREADY committed GRN.
  // Keep its identity until confirmation; unlike validation/conflict this is not rollback evidence.
  const retainReceiptIdentity=/\/procurement\/goods-receipts$/.test(path)&&
    response.status>=400&&![400,409].includes(response.status);
  if (response.ok || (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)&&!retainReceiptIdentity)) {
    // Do not erase a later intent created by another call after our success.
    try {
      if (sessionStorage.getItem(storageKey) === key) sessionStorage.removeItem(storageKey);
    } catch (cause) {
      // Keep the form and persisted intent until cleanup succeeds. Reporting a
      // generic save failure here would hide a confirmed financial commit.
      throw new Error(response.ok
        ? "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها من تخزين الجلسة. فعّل التخزين ثم أعد المحاولة بنفس البيانات لتأكيد النتيجة دون إنشاء عملية مكررة. لا تبدأ عملية جديدة بهذه البيانات قبل اكتمال التأكيد."
        : "رفض الخادم العملية، لكن تعذر تنظيف مفتاحها من تخزين الجلسة. فعّل التخزين ثم أعد المحاولة.", { cause });
    }
  }
  return response;
}
