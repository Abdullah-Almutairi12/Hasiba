import {useRef,useState} from "react";
import {getWorkspaceResponsibility} from "@workspace/api-client-react";
import type {usePosResumedBasket,ResumedBasket} from "./use-pos-resumed-basket";

const stale="عُدّلت هذه السلة في تبويب آخر. اعرض النسخة الأحدث وراجعها قبل الدفع.";
type Basket=Pick<ReturnType<typeof usePosResumedBasket>,"value"|"save">;
/** Local durability and server confirmation are separate states. Never replace an uncertain save. */
export function usePosResumedVersion(basket:Basket){
  const latest=useRef(basket);latest.current=basket;
  const sending=useRef(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const pending=!!basket.value?.syncIntent;
  const dirty=!!basket.value&&(basket.value.serverDirty===true||basket.value.source.version===undefined);
  const persist=(value:ResumedBasket)=>{
    if(!latest.current.save(value))return false;
    latest.current={...latest.current,value};return true;
  };
  async function sync(action:"save"|"read"){
    if(sending.current||!latest.current.value)return null;
    const original=latest.current.value;
    if(action==="read"&&original.syncIntent)return null;
    sending.current=true;setBusy(true);setMessage("");
    try{
      let value=original;
      if(action==="save"&&!value.syncIntent){
        value={...value,syncIntent:{key:crypto.randomUUID(),responsibility:getWorkspaceResponsibility()??null,
          body:{action:"save",sessionId:value.source.sessionId,requestId:value.source.requestId,
            version:value.source.version??0,items:value.cart.map(i=>({productId:i.product.id,quantity:i.quantity})),
            customerId:value.customer?.id??null}}};
        if(!persist(value))throw Error("تعذر حفظ محاولة تأكيد التعديلات؛ لم يُرسل طلب إلى الخادم.");
      }
      const intent=action==="save"?value.syncIntent:null;
      const responsibility=intent?intent.responsibility:getWorkspaceResponsibility();
      const response=await fetch(`${import.meta.env.BASE_URL}api/pos/orders/${value.source.id}/resumed-basket`,{
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json",
          ...(intent?{"Idempotency-Key":intent.key}:{}),
          ...(responsibility?{"X-Responsibility-Id":responsibility}:{})},
        body:JSON.stringify(intent?.body??{...value.source,version:value.source.version??0,action:"read"})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error??"تعذر تأكيد تعديلات السلة؛ احتُفظ بالمحاولة الأصلية.");
      const now=latest.current.value;
      if(!now||now.source.id!==value.source.id||now.source.requestId!==value.source.requestId||
        (intent&&now.syncIntent?.key!==intent.key))return null; // A late reply cannot replace a newer basket.
      if(data.id!==value.source.id||data.sessionId!==value.source.sessionId)throw Error("رد حفظ السلة لا يخص المحاولة الأصلية.");
      if(data.state==="completed"){
        if(!persist({...now,syncIntent:undefined,serverDirty:true,serverFinalized:true}))
          throw Error("تعذر حفظ نتيجة التحقق؛ استرجع المحاولة الأصلية.");
        setMessage("اكتمل بيع هذه المسودة بالفعل. اعرض الإيصال الأصلي؛ لن تُعدّل الفاتورة ولن يُحصّل مبلغ جديد.");
        return data;
      }
      if(data.state==="conflict"&&intent){
        // A permanent outcome explicitly proves this exact write did not apply.
        const next={...now,syncIntent:undefined,serverDirty:true,serverConflict:true};
        if(!persist(next))throw Error("تعذر حفظ نتيجة التحقق؛ أعد التحقق بالمحاولة نفسها.");
        setMessage(stale);return null;
      }
      if(data.state!=="current"||!Number.isSafeInteger(data.version)||data.version<0)throw Error("لم يؤكد الخادم نسخة صالحة للسلة.");
      if(intent&&data.version!==intent.body.version+1)throw Error("تعذر مطابقة نسخة الحفظ؛ احتُفظ بالمحاولة.");
      let next:ResumedBasket;
      if(action==="read"){
        if(!Array.isArray(data.cart)||data.cart.some((i:any)=>!Number.isSafeInteger(i.product?.id)||!(i.quantity>0))||
          (data.customer!==null&&!Number.isSafeInteger(data.customer?.id)))throw Error("تعذر قراءة محتوى النسخة الأحدث.");
        next={...now,cart:data.cart,customer:data.customer,source:{...now.source,version:data.version},
          serverDirty:false,serverConflict:false,syncIntent:undefined};
      }else next={...now,source:{...now.source,version:data.version},serverDirty:false,serverConflict:false,syncIntent:undefined};
      if(!persist(next))throw Error("أكد الخادم الحفظ لكن تعذر حفظ إقراره محليًا؛ استرجع المحاولة الأصلية.");
      setMessage(action==="read"?"عُرضت النسخة المؤكدة من الخادم. راجع العميل والكميات ومعاينة المبلغ قبل الدفع.":"تم تأكيد حفظ تعديلات السلة لدى الخادم.");
      return {...data,basket:next};
    }catch(e){setMessage(e instanceof Error?e.message:"تعذر تأكيد الحفظ؛ احتُفظ بالمحاولة الأصلية.");return null;}
    finally{sending.current=false;setBusy(false);}
  }
  return {busy,pending,dirty,message:message||(basket.value?.serverFinalized
    ?"اكتمل بيع هذه المسودة؛ اعرض الإيصال الأصلي ولا تعاود التحصيل.":basket.value?.serverConflict?stale:""),
    confirm:()=>sync("save"),refresh:()=>sync("read")};
}
