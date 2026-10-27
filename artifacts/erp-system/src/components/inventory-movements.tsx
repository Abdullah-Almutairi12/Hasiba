import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkspaceInventoryMovementOptions } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Link } from "wouter";

type Intent={key:string;transfer:boolean;body:Record<string,string|number|null>};
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
 const [kind,setKind]=useState(onlyTransfer?"transfer":"issue"),[product,setProduct]=useState(""),[variant,setVariant]=useState(""),[warehouse,setWarehouse]=useState(""),
  [destination,setDestination]=useState(""),[quantity,setQuantity]=useState("1"),[notes,setNotes]=useState(""),
  [pending,setPending]=useState(false),[message,setMessage]=useState("");
 const [lot,setLot]=useState(""),[lotNumber,setLotNumber]=useState(""),[expiry,setExpiry]=useState("");
 const options=query.data,action=(v:string)=>v==="transfer"?"inventory.transfer.send":`inventory.move.${v}`;
 const actions=Object.keys(labels).filter(v=>(!onlyTransfer||v==="transfer")&&options?.actions.includes(action(v)));
 const effective=actions.includes(kind)?kind:actions[0]??kind;
 const selectedProduct=options?.products.find(p=>p.id===Number(product));
 const lots=options?.lots?.filter(l=>l.productId===Number(product))??[];
 const lotMode=selectedProduct?.tracking==="lot";
 const balances=lots.map(l=>({...l,balance:l.balances.find(b=>b.warehouseId===Number(warehouse))}));
 let remaining=Number(quantity);
 const allocation=balances.flatMap(l=>{const take=Math.min(Math.max(0,remaining),Number(l.balance?.availableQuantity??0));
  remaining-=take;return take>0?[`${l.lotNumber}: ${take} ${selectedProduct?.unit??""} (صلاحية ${l.expiryDate??"غير محددة"})`]:[];});
  const lotUnavailable=!!(lotMode&&effective!=="receipt"&&warehouse&&Number(quantity)>0&&
   (lot?Number(balances.find(l=>l.id===Number(lot))?.balance?.availableQuantity??0)<Number(quantity):remaining>1e-9));
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
    if(selectedProduct?.requiresVariant&&!selectedProduct.variants?.some(v=>v.id===Number(variant)))
     throw new Error("اختر متغيرًا متاحًا للصنف المحدد");
    if(effective==="transfer"&&(!target||target.id===Number(warehouse)))throw new Error("اختر وجهة مختلفة مصرحًا بها صراحةً");
    if(lotMode&&effective==="receipt"&&!lot&&!lotNumber.trim())throw new Error("اختر الدفعة أو أدخل رقم الدفعة الجديدة");
    const existing=lots.find(l=>l.lotNumber===lotNumber.trim());
    if(lotMode&&effective==="receipt"&&!lot&&existing&&(existing.expiryDate??null)!==(expiry||null))
      throw new Error("رقم الدفعة موجود بصلاحية مختلفة؛ اختر السجل الأصلي ولا تغير تاريخه");
    if(lotMode&&effective!=="receipt"){
      if(lot){const selected=balances.find(l=>l.id===Number(lot));if(Number(selected?.balance?.availableQuantity??0)<qty)throw new Error("الدفعة غير متاحة أو منتهية أو رصيدها غير كافٍ");}
      else if(remaining>1e-9)throw new Error("الرصيد المتاح للدفعات غير المنتهية غير كافٍ");
    }
    next={key:crypto.randomUUID(),transfer:effective==="transfer",body:{productId:Number(product),...(variant?{variantId:Number(variant)}:{}),
     ...(lotMode?(lot?{lotId:Number(lot)}:effective==="receipt"?{lotNumber:lotNumber.trim(),expiryDate:expiry||null}:{}):{}),quantity:Number(quantity),notes:notes.trim(),
     ...(effective==="transfer"?{fromWarehouseId:Number(warehouse),toWarehouseId:target!.id,destinationResponsibilityId:target!.responsibilityId}:
      {warehouseId:Number(warehouse),kind:effective})}};
    // Do not send if durable local intent cannot be saved. Scope never comes from this storage.
    localStorage.setItem(storageKey,JSON.stringify(next));setIntent(next);
   }
   setPending(true);setMessage("جارٍ تأكيد الحركة؛ لا تنشئ محاولة بديلة.");
   const response=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/,"")}/api/inventory/${next.transfer?"transfers":"moves"}`,{
    method:"POST",credentials:"include",headers:{...headers,"Content-Type":"application/json","Idempotency-Key":next.key},body:JSON.stringify(next.body)});
   const result=await response.json();
   if(!response.ok){setMessage(`رفض الخادم هذا الطلب: ${result.error||response.status}. احتفظ بمعرف المحاولة وتحقق من السجل أو استعد النتيجة؛ الرفض لا يلغي نتيجة قديمة مؤكدة.`);return;}
   if(!Number.isInteger(result.moveId)||!Array.isArray(result.moveIds))throw new Error("لم يصل إثبات كامل لنتيجة الحركة");
   localStorage.removeItem(storageKey);setIntent(null);
   setMessage(`حركة مؤكدة #${result.moveId}؛ ${next.transfer?"البضاعة في الطريق ولم تستلم بعد.":"اكتملت الحركة وأثرها الآلي."}`);
   setNotes("");setQuantity("1");
   await client.invalidateQueries();
  }catch(error){setMessage(`${error instanceof Error?error.message:"تعذر تأكيد الحركة"}. ${next?"النتيجة غير مؤكدة؛ استعد المحاولة المحفوظة بنفس المعرف ولا تنشئ حركة بديلة.":"لم ترسل حركة جديدة."}`);}
  finally{setPending(false);}
 }
 return <section className="space-y-3 border-t p-4" data-testid="inventory-movements">
  <h3 className="font-semibold">حركات المخزون المصرح بها</h3>
  {!onlyTransfer&&<Link className="text-sm underline" href="/inventory/transfers">فتح صفحة التحويلات الأصلية</Link>}
   <p className="text-xs text-muted-foreground">للأصناف والمتغيرات غير المتتبعة وللدفعات العادية، دون جمع المتغير والدفعة أو تعديل تكلفة أو تسوية جرد أو قيود يدوية. يحافظ الجرد المتحرك على نقطة العد والمصالحة. القائمة حتى1000صنف.</p>
  {query.isLoading?<p role="status">جارٍ تحميل الأذونات…</p>:query.error?<p role="alert">تعذر تحميل الأذونات الحالية؛ حدّث الصفحة.</p>:null}
  {!actions.length&&!intent?<p>لا تملك إذن حركة هنا.</p>:<>
   {intent?<p role="alert">محاولة محفوظة: {JSON.stringify(intent.body)}. أعد تأكيد نتيجتها قبل أي حركة جديدة.</p>:<fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
    <label>الفعل<select className="block w-full rounded border bg-background p-2" value={effective} onChange={e=>setKind(e.target.value)}>{actions.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
    <label>الصنف<select className="block w-full rounded border bg-background p-2" value={product} onChange={e=>{setProduct(e.target.value);setVariant("");setLot("");setLotNumber("");setExpiry("");}}><option value="">اختر الصنف</option>{options?.products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label>
    {lotMode&&<>
      <label>الدفعة<select className="block w-full rounded border bg-background p-2" value={lot} onChange={e=>setLot(e.target.value)}>
        <option value="">{effective==="receipt"?"دفعة جديدة":"تخصيص FEFO — الأقرب انتهاءً أولًا"}</option>
        {balances.map(l=><option key={l.id} value={l.id}>{l.lotNumber} · {l.expiryDate??"صلاحية غير محددة"} · فعلي {l.balance?.quantity??"0"} · متاح {l.balance?.availableQuantity??"0"}</option>)}
      </select></label>
      {effective==="receipt"&&!lot&&<><label>رقم الدفعة<Input value={lotNumber} onChange={e=>setLotNumber(e.target.value)}/></label>
       <label>تاريخ الصلاحية<Input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/><span>فارغ يعني غير محدد، وليس تاريخًا مفترضًا.</span></label></>}
      {effective!=="receipt"&&!lot&&<p role="note">التخصيص المتوقع من الأرصدة الحالية: {allocation.join("؛ ")||"لا دفعات متاحة"}. يستبعد المنتهي. قد تتغير الأرصدة قبل التنفيذ؛ المرجع المؤكد وأرقام الدفعات في سجل الحركات.</p>}
    </>}
    {selectedProduct?.requiresVariant&&<label>المتغير<select className="block w-full rounded border bg-background p-2" value={variant} onChange={e=>setVariant(e.target.value)}><option value="">اختر المتغير</option>{selectedProduct.variants?.map(v=><option key={v.id} value={v.id}>{v.sku} · {Object.entries(v.attributes).map(([k,value])=>`${k}: ${String(value)}`).join(" · ")}</option>)}</select></label>}
    {selectedProduct&&<p className="text-sm">وحدة القياس: {selectedProduct.unit??"—"}</p>}
    <label>{effective==="transfer"?"مستودع المصدر":"المستودع"}<select className="block w-full rounded border bg-background p-2" value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">اختر المستودع</option>{options?.sources.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    {effective==="transfer"&&<label>مستودع الوجهة المصرح به<select className="block w-full rounded border bg-background p-2" value={destination} onChange={e=>setDestination(e.target.value)}><option value="">اختر الوجهة</option>{options?.destinations.map(w=><option key={`${w.responsibilityId}:${w.id}`} value={`${w.responsibilityId}:${w.id}`}>{w.name} · مسؤولية#{w.responsibilityId}</option>)}</select></label>}
    <label>الكمية<Input inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <label>السبب / مرجع المصدر<Input value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   </fieldset>}
    {!intent&&lotUnavailable&&<p role="alert">{lot?"الدفعة غير متاحة أو منتهية أو رصيدها غير كافٍ":"الرصيد المتاح للدفعات غير المنتهية غير كافٍ"}</p>}
    <Button disabled={pending||(!intent&&(!actions.length||lotUnavailable))} onClick={()=>void run()}>{pending?"جارٍ انتظار التأكيد…":intent?"استعادة نتيجة المحاولة المحفوظة":"تأكيد الحركة"}</Button>
  </>}
  {message&&<p role="status">{message}</p>}
  {!!options?.recent?.length&&<div className="space-y-1 text-sm" data-testid="recent-inventory-movements"><h4 className="font-semibold">آخر40حركة مفوضة ضمن مستودعات المسؤولية</h4>
   {options.recent.map(m=><p key={m.id}>حركة#{m.id} · {m.productName}{m.variantId?` · ${m.variantSku??`متغير#${m.variantId}`}`:""}{m.lotId?` · دفعة ${m.lotNumber} · صلاحية ${m.expiryDate??"غير محددة"}`:""} · {m.quantity} {m.unit??""} · {m.sourceWarehouse??"—"} ← {m.destinationWarehouse??"—"} · {m.kind==="transfer"?"تحويل":m.kind==="receipt"?"استلام":"صرف"} · {m.state==="in_transit"?"في الطريق":m.state==="done"?"مكتملة":m.state}</p>)}</div>}
 </section>;
}
