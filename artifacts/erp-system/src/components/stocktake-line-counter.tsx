import {useEffect,useRef,useState} from "react";
import {apiPost} from "@/hooks/use-api";
import {countHeaders} from "@/lib/stocktake-intent";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";

type Point={checkpointId:string;expectedRevision:string;expectedQty:number;expiresAt:string};
type Intent={key:string;body:{countedQty:number;expectedRevision:string;checkpointId:string}};
/** A physical count starts explicitly; a lost absolute-count response keeps the
 * exact request identity across reloads, independently from barcode scan intent.
 */
export function StocktakeLineCounter({takeId,line,scope,disabled,onConfirmed}:{
 takeId:number;line:{id:number;productId:number;productName:string;countedQty:number|null};
 scope:string;disabled:boolean;onConfirmed:()=>void;
}){
 const storageKey=`${scope}:absolute:${line.id}`;
 const [point,setPoint]=useState<Point|null>(null),[value,setValue]=useState(""),[busy,setBusy]=useState(false);
 const [pending,setPending]=useState<Intent|null>(null),[message,setMessage]=useState(""),[blocked,setBlocked]=useState(false);
 const sending=useRef(false);
 useEffect(()=>{
  try{
   const raw=localStorage.getItem(storageKey);
   if(raw){const saved=JSON.parse(raw) as Intent;
    if(typeof saved.key!=="string"||typeof saved.body?.checkpointId!=="string"||!Number.isFinite(saved.body.countedQty))
     throw new Error("invalid intent");
    setPending(saved);setValue(String(saved.body.countedQty));setMessage("عدد غير محسوم محفوظ؛ استعد نتيجته أولًا");
   }
  }catch{setBlocked(true);setMessage("تعذر قراءة سجل الاستعادة؛ العد متوقف لحماية المحاولة");}
 },[storageKey]);
 async function begin(){
  setBusy(true);
  try{
   const p=await apiPost<Point>(`/inventory/stock-takes/${takeId}/checkpoint`,{productId:line.productId});
   setPoint(p);setValue("");setMessage(`ابدأ العد الفعلي الآن، ثم أكده قبل ${new Date(p.expiresAt).toLocaleTimeString("ar-SA")}. إذا تحرك الصنف سيُطلب إعادة عده.`);
  }catch(e){setMessage(e instanceof Error?e.message:"تعذر بدء العد");}
  finally{setBusy(false);}
 }
 async function save(){
  if(sending.current||busy||blocked||(!pending&&(!point||disabled)))return;
  const n=Number(value);
  if(!pending&&(value.trim()===""||!Number.isFinite(n)||n<0)){setMessage("أدخل عددًا صحيح القيمة وغير سالب");return;}
  sending.current=true;setBusy(true);
  let intent=pending;
  try{
   const saved=localStorage.getItem(storageKey);
   if(saved)intent=JSON.parse(saved) as Intent;
   if(!intent){intent={key:crypto.randomUUID(),body:{countedQty:n,checkpointId:point!.checkpointId,expectedRevision:point!.expectedRevision}};
    localStorage.setItem(storageKey,JSON.stringify(intent));setPending(intent);}
   const r=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/,"")}/api/inventory/stock-takes/${takeId}/lines/${line.id}`,{
    method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json","Idempotency-Key":intent.key,...countHeaders()},
    body:JSON.stringify(intent.body),
   });
   const body=await r.json();
   if(!r.ok){
    // This server rejection is conclusive for this absolute intent: no cached
    // receipt exists for the same key (the service checks it before execution).
    // Keep unknown/proxy failures; do not silently resubmit a fresh operation.
    if([400,409,428].includes(r.status)){localStorage.removeItem(storageKey);setPending(null);setPoint(null);}
    throw new Error(body.error??"لم يتأكد حفظ العدد");
   }
   if(body.ok!==true)throw new Error("استجابة غير مكتملة؛ استعد بنفس المعرف");
   localStorage.removeItem(storageKey);setPending(null);setPoint(null);
   setMessage("تم تأكيد العدد ونقطة العد من الخادم؛ لم يتغير المخزون أو القيود");onConfirmed();
  }catch(e){setMessage(e instanceof Error?e.message:"نتيجة غير مؤكدة؛ استعد بنفس المعرف");}
  finally{sending.current=false;setBusy(false);}
 }
 async function guardedSave(){
  if(!navigator.locks){setMessage("المتصفح لا يوفر قفل العد بين النوافذ؛ استخدم متصفحًا مدعومًا");return;}
  await navigator.locks.request(storageKey,{ifAvailable:true},async lock=>{
   if(!lock){setMessage("توجد محاولة عد لهذا السطر في نافذة أخرى؛ انتظر استعادتها");return;}
   await save();
  });
 }
 return <div className="min-w-64 space-y-2">
  <span>المؤكد: {line.countedQty??"—"}</span>
  {!pending&&<Button size="sm" variant="outline" disabled={disabled||busy||blocked} onClick={()=>void begin()}>
   بدء عد الصنف
  </Button>}
  {(point||pending)&&<>
   {point&&<p className="text-xs">رصيد نقطة العد: {point.expectedQty}</p>}
   <Input aria-label={`العدد المطلق — ${line.productName}`} type="number" min="0" step="any"
    value={value} disabled={busy||!!pending} onChange={e=>setValue(e.target.value)}/>
   <Button size="sm" disabled={busy||blocked||disabled&&!pending} onClick={()=>void guardedSave()}>
    {pending?"استعادة نتيجة العدد":"تأكيد العدد"}
   </Button>
  </>}
  {message&&<p role="status" className="text-xs">{message}</p>}
 </div>;
}
