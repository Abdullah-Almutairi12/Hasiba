import { useEffect, useRef, useState } from "react";
import { clearIntentIfKey, readIntent, saveIntent, type StoredIntent } from "@/lib/durable-intent";
import type { PosCartItem } from "./use-pos-checkout";
import type { PosCustomerChoice } from "@/components/pos-customer-picker";

export type ParkBody = {
  sessionId: number; customerId?: number; label: string | null;
  items: { productId: number; quantity: number; priceSnapshot: number; nameSnapshot: string }[];
  subtotal: number; tax: number; discount: number; total: number;
};
type Meta = { cart: PosCartItem[]; customer: PosCustomerChoice | null };
export type ParkingIntent = StoredIntent<ParkBody, Meta>;
const endpoint = "pos/orders/park";
export const parkingStorageKey = (scope: string) => `hasba:pos-park:${scope}`;
export const parkingLabelError = (label: string | null) => (label ?? "").trim().length > 60
  ? "اسم المسودة يجب ألا يتجاوز 60 حرفًا؛ صحح الاسم دون فقد السلة أو العميل." : "";
const uncertain = "تعذر تأكيد التعليق؛ احتُفظ بالسلة والعميل. استرجع نتيجة المحاولة نفسها، ولا تنشئ مسودة بديلة.";
function read(scope: string) {
  const value = readIntent<ParkBody, Meta>(parkingStorageKey(scope), endpoint);
  if (!value || value === "unreadable") return value;
  const { body, meta } = value;
  if (!Number.isInteger(body?.sessionId) || !Array.isArray(body.items) || !body.items.length ||
    !meta || !Array.isArray(meta.cart) || meta.cart.length !== body.items.length ||
    (meta.customer?.id ?? null) !== (body.customerId ?? null) ||
    meta.cart.some((c, i) => c.product?.id !== body.items[i]?.productId || c.quantity !== body.items[i]?.quantity)) return "unreadable";
  return value;
}

/** Uses the existing durable-intent storage/CAS and server transaction receipts. */
export function usePosParking(scope: string) {
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const alive = useRef(true), sending = useRef(false);
  const [state, setState] = useState<{scope:string;ready:boolean;intent:ParkingIntent|null;busy:boolean;error:string}>(
    {scope,ready:false,intent:null,busy:false,error:""});
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const saved = read(scope);
    setState({scope,ready:saved!=="unreadable",intent:saved==="unreadable"?null:saved,busy:false,
      error:saved==="unreadable"?"تعذر قراءة محاولة التعليق المحفوظة؛ لم يُرسل طلب جديد. فعّل التخزين ثم أعد تحميل الصفحة.":""});
  }, [scope]);
  const current = state.scope === scope ? state : {ready:false,intent:null,busy:false,error:""};
  async function submit(snapshot?: {body:ParkBody;meta:Meta}, resolve = false) {
    // Synchronous fence: two clicks in the same React batch still send once.
    if (sending.current) return null;
    sending.current = true;
    const originalScope = scope;
    let intent: ParkingIntent | null = null;
    const update = (patch: Partial<typeof state>) => {
      if (alive.current && scopeRef.current === originalScope) setState(s => ({...s,...patch}));
    };
    try {
      const saved = read(originalScope);
      if (saved === "unreadable") throw Error("تعذر قراءة دليل التعليق؛ لم يُرسل طلب جديد.");
      intent = saved;
      if (!intent) {
        if (!snapshot) throw Error("لا توجد محاولة تعليق محفوظة للاسترجاع.");
        const labelError=parkingLabelError(snapshot.body.label);
        if(labelError)throw Error(labelError);
        const next = JSON.parse(JSON.stringify({v:1,key:crypto.randomUUID(),endpoint,body:snapshot.body,
          meta:snapshot.meta,responsibility:null,createdAt:new Date().toISOString()})) as ParkingIntent;
        // Persist before the first byte is sent. Never retry under a new key.
        try { saveIntent(parkingStorageKey(originalScope), next); }
        catch { throw Error("تعذر حفظ محاولة التعليق بأمان؛ لم يُرسل طلب جديد. فعّل التخزين وأعد المحاولة."); }
        intent = next;
      }
      update({intent,busy:true,error:""});
      const response = await fetch(`${import.meta.env.BASE_URL}api/${endpoint}${resolve?"/resolve":""}`, {
        method:"POST",credentials:"include",
        headers:{"Content-Type":"application/json",...(!resolve?{"Idempotency-Key":intent.key}:{})},
        body:JSON.stringify(resolve?{requestKey:intent.key,body:intent.body}:intent.body),
      });
      if (!response.ok) throw Error(uncertain);
      const payload = await response.json();
      const closed=resolve && payload?.state==="closed_without_execution" && payload.requestId===intent.key;
      const result=resolve ? payload?.state==="completed"?payload.result:null : payload;
      if (!closed && (!Number.isInteger(result?.id) || result.id <= 0 || result.requestId !== intent.key ||
        result.sessionId !== intent.body.sessionId || typeof result.orderNumber !== "string" || !result.orderNumber.trim() ||
        (result.customerId ?? null) !== (intent.body.customerId ?? null))) throw Error(uncertain);
      // Old/unmounted callers and late responses cannot erase newer evidence.
      if (!alive.current || scopeRef.current !== originalScope) return null;
      if (clearIntentIfKey(parkingStorageKey(originalScope), intent.key) !== "cleared") {
        throw Error(closed
          ? "أُغلقت المحاولة دون تنفيذ، لكن توجد محاولة أحدث أو تعذر تنظيف التخزين. احتُفظ بالسلة؛ أعد التحقق."
          : "تم حفظ المسودة، لكن توجد محاولة أحدث أو تعذر تنظيف التخزين. لم تُمسح السلة.");
      }
      update({intent:null,busy:false,error:""});
      return {intent,result,closed};
    } catch (error) {
      update({intent,error:error instanceof Error && /[\u0600-\u06ff]/.test(error.message) ? error.message : uncertain});
      return null;
    } finally {
      sending.current = false;
      update({busy:false});
    }
  }
  return {...current,submit,isLocked:()=>sending.current || read(scope)!==null};
}
