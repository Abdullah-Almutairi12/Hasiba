import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkspaceInventoryMovementOptions } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Link } from "wouter";

type Intent={key:string;transfer:boolean;body:Record<string,string|number>};
const labels:Record<string,string>={"receipt":"استلام مخزون يدوي","issue":"صرف مخزون يدوي","transfer":"إرسال تحويل"};
export function InventoryMovements({grantId,onlyTransfer=false}:{grantId:number;onlyTransfer?:boolean}){
 const {user}=useAuth();
 if(!user?.companyId)return null;
 return <MovementForm key={`${user.id}:${user.companyId}:${grantId}`} grantId={grantId} onlyTransfer={onlyTransfer}
  storageKey={`hasiba.inventory.movement:${user.id}:${user.companyId}:${grantId}`}/>;
}
function MovementForm({grantId,storageKey,onlyTransfer}:{grantId:number;storageKey:string;onlyTransfer:boolean}){
 const client=useQueryClient(),headers={"X-Workspace-Responsibility":String(grantId)};
 const query=useQuery({queryKey:["inventory-movement-options",storageKey],queryFn:()=>getWorkspaceInventoryMovementOptions({headers}),retry:false});
 const [intent,setIntent]=useState<Intent|null>(()=>{try{return JSON.parse(localStorage.getItem(storageKey)||"null");}catch{return null;}});
 const [kind,setKind]=useState(onlyTransfer?"transfer":"issue"),[product,setProduct]=useState(""),[warehouse,setWarehouse]=useState(""),
  [destination,setDestination]=useState(""),[quantity,setQuantity]=useState("1"),[notes,setNotes]=useState(""),
  [pending,setPending]=useState(false),[message,setMessage]=useState("");
 const options=query.data,action=(v:string)=>v==="transfer"?"inventory.transfer.send":`inventory.move.${v}`;
 const actions=Object.keys(labels).filter(v=>(!onlyTransfer||v==="transfer")&&options?.actions.includes(action(v)));
 const effective=actions.includes(kind)?kind:actions[0]??kind;
 async function run(){
  if(pending)return;
  let next=intent;
  try{
   if(!next){
    const qty=Number(quantity);
    if(!options?.actions.includes(action(effective))||!product||!warehouse||!Number.isFinite(qty)||qty<0.0001||qty>999999999||
      Number(qty.toFixed(4))!==qty||notes.trim().length<3||notes.trim().length>500)
     throw new Error("اختر الصنف والمستودع وكمية من0.0001إلى999999999بأربع منازل كحد أقصى وسببًا من3إلى500حرف");
    const target=options.destinations.find(w=>`${w.responsibilityId}:${w.id}`===destination);
    if(effective==="transfer"&&(!target||target.id===Number(warehouse)))throw new Error("اختر وجهة مختلفة مصرحًا بها صراحةً");
    next={key:crypto.randomUUID(),transfer:effective==="transfer",body:{productId:Number(product),quantity:Number(quantity),notes:notes.trim(),
     ...(effective==="transfer"?{fromWarehouseId:Number(warehouse),toWarehouseId:target!.id,destinationResponsibilityId:target!.responsibilityId}:
      {warehouseId:Number(warehouse),kind:effective})}};
    // Do not send if durable local intent cannot be saved. Scope never comes from this storage.
    localStorage.setItem(storageKey,JSON.stringify(next));setIntent(next);
   }
   setPending(true);setMessage("جارٍ تأكيد الحركة؛ لا تنشئ محاولة بديلة.");
   const response=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/,"")}/api/inventory/${next.transfer?"transfers":"moves"}`,{
    method:"POST",credentials:"include",headers:{...headers,"Content-Type":"application/json","Idempotency-Key":next.key},body:JSON.stringify(next.body)});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||"تعذر تأكيد الحركة");
   if(!Number.isInteger(result.moveId)||!Array.isArray(result.moveIds))throw new Error("لم يصل إثبات كامل لنتيجة الحركة");
   localStorage.removeItem(storageKey);setIntent(null);
   setMessage(`حركة مؤكدة #${result.moveId}؛ ${next.transfer?"البضاعة في الطريق ولم تستلم بعد.":"اكتملت الحركة وأثرها الآلي."}`);
   setNotes("");setQuantity("1");
   await client.invalidateQueries();
  }catch(error){setMessage(`${error instanceof Error?error.message:"تعذر تأكيد الحركة"}. إن حُفظت المحاولة فاستعد نتيجتها بنفس المعرف؛ لا تُنشئ حركة بديلة.`);}
  finally{setPending(false);}
 }
 return <section className="space-y-3 border-t p-4" data-testid="inventory-movements">
  <h3 className="font-semibold">حركات المخزون المصرح بها</h3>
  {!onlyTransfer&&<Link className="text-sm underline" href="/inventory/transfers">فتح صفحة التحويلات الأصلية</Link>}
  <p className="text-xs text-muted-foreground">للأصناف العادية فقط، دون تعديل تكلفة أو تسوية جرد أو صلاحية قيود يدوية. الجرد المفتوح يمنع هذه الحركات. القائمة حتى1000صنف.</p>
  {query.isLoading?<p role="status">جارٍ تحميل الأذونات…</p>:query.error?<p role="alert">تعذر تحميل الأذونات الحالية؛ حدّث الصفحة.</p>:null}
  {!actions.length&&!intent?<p>لا تملك إذن حركة هنا.</p>:<>
   {intent?<p role="alert">محاولة محفوظة: {JSON.stringify(intent.body)}. أعد تأكيد نتيجتها قبل أي حركة جديدة.</p>:<fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
    <label>الفعل<select className="block w-full rounded border bg-background p-2" value={effective} onChange={e=>setKind(e.target.value)}>{actions.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
    <label>الصنف<select className="block w-full rounded border bg-background p-2" value={product} onChange={e=>setProduct(e.target.value)}><option value="">اختر الصنف</option>{options?.products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label>
    <label>{effective==="transfer"?"مستودع المصدر":"المستودع"}<select className="block w-full rounded border bg-background p-2" value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">اختر المستودع</option>{options?.sources.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    {effective==="transfer"&&<label>مستودع الوجهة المصرح به<select className="block w-full rounded border bg-background p-2" value={destination} onChange={e=>setDestination(e.target.value)}><option value="">اختر الوجهة</option>{options?.destinations.map(w=><option key={`${w.responsibilityId}:${w.id}`} value={`${w.responsibilityId}:${w.id}`}>{w.name} · مسؤولية#{w.responsibilityId}</option>)}</select></label>}
    <label>الكمية<Input inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <label>السبب / مرجع المصدر<Input value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   </fieldset>}
   <Button disabled={pending||(!intent&&!actions.length)} onClick={()=>void run()}>{pending?"جارٍ انتظار التأكيد…":intent?"استعادة نتيجة المحاولة المحفوظة":"تأكيد الحركة"}</Button>
  </>}
  {message&&<p role="status">{message}</p>}
  {!!options?.recent?.length&&<div className="space-y-1 text-sm" data-testid="recent-inventory-movements"><h4 className="font-semibold">آخر40حركة مفوضة ضمن مستودعات المسؤولية</h4>
   {options.recent.map(m=><p key={m.id}>حركة#{m.id} · {m.productName} · {m.quantity} · {m.kind==="transfer"?"تحويل":m.kind==="receipt"?"استلام":"صرف"} · {m.state==="in_transit"?"في الطريق":m.state==="done"?"مكتملة":m.state}</p>)}</div>}
 </section>;
}
