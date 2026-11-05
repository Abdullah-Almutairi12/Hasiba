import {useEffect,useRef,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {financialFetch,getWorkspaceResponsibility} from "@workspace/api-client-react";
import type {WarehouseAlertRule as Rule} from "@workspace/api-client-react";
import {apiGet} from "@/hooks/use-api";
import {useAuth} from "@/hooks/use-auth";
import {useSelectedResponsibility} from "@/lib/workspace-responsibility";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog,DialogContent,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from "@/components/ui/select";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "@/components/ui/table";
import {Badge} from "@/components/ui/badge";

type Product={id:number;nameAr:string;sku:string;unit:string;trackingMode?:string;isVariantParent?:boolean};
type Warehouse={id:number;nameAr:string};
type Body={productId:number;warehouseId:number;minQty:number;maxQty:number;eoq:number;isActive:boolean;alertEnabled:boolean;revision?:number};
type Intent={key:string;body:Body};
const statusName=(s:string)=>({open:"نقص مستمر",recovered:"تعافى الرصيد",disabled:"عُطّل التنبيه",unsupported:"خارج نطاق الدعم"}[s]??s);
const apiBase=import.meta.env.BASE_URL.replace(/\/$/,"");
export default function ReorderRulesPage(){
 const {user}=useAuth(),selected=useSelectedResponsibility();
 const scope=`${user?.id}:${user?.companyId}:${selected?.id??"legacy"}`;
 // Key the whole form/attempt by authority context; never render previous-company data.
 return <ReorderScope key={scope} scope={scope} canManage={user?.role==="scoped"?
  selected?.resource==="inventory"&&selected.actions.includes("inventory.reorder.manage"):
  ["owner","manager","inventory"].includes(user?.role??"")}/>;
}
function ReorderScope({scope,canManage}:{scope:string;canManage:boolean}){
 const qc=useQueryClient(),live=useRef(true),sending=useRef(false);
 const storage=`hasiba:warehouse-alert-rule:${scope}`;
 const [intent,setIntent]=useState<Intent|null>(()=>{try{return JSON.parse(sessionStorage.getItem(storage)??"null");}catch{return null;}});
 const [open,setOpen]=useState(!!intent),[editing,setEditing]=useState<Rule|null>(null);
 const [productId,setProductId]=useState(""),[warehouseId,setWarehouseId]=useState("");
 const [minQty,setMinQty]=useState("0"),[maxQty,setMaxQty]=useState("0"),[enabled,setEnabled]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const rules=useQuery<Rule[]>({queryKey:["warehouse-alert-rules",scope],queryFn:()=>apiGet("/inventory/reorder-rules"),refetchInterval:5000});
 const options=useQuery<{products:Product[];warehouses:Warehouse[]}>({queryKey:["warehouse-alert-options",scope],queryFn:()=>apiGet("/inventory/reorder-options"),enabled:canManage});
 const product=options.data?.products.find(p=>String(p.id)===productId);
 function edit(rule?:Rule){
  setEditing(rule??null);setProductId(rule?String(rule.productId):"");setWarehouseId(rule?String(rule.warehouseId):"");
  setMinQty(String(rule?.minQty??0));setMaxQty(String(rule?.maxQty??0));setEnabled(rule?.alertEnabled??false);setError("");setOpen(true);
 }
 async function save(){
  if(sending.current||!canManage)return;
  if(!intent&&(!productId||!warehouseId||!Number.isFinite(Number(minQty))||!Number.isFinite(Number(maxQty))||
   Number(minQty)<0||Number(maxQty)<Number(minQty))){setError("اختر الصنف والمستودع وأدخل حدًا ومستهدفًا صحيحين؛ المستهدف لا يقل عن الحد.");return;}
  let current=intent;
  if(!current){
   current={key:crypto.randomUUID(),body:{productId:Number(productId),warehouseId:Number(warehouseId),
    minQty:Number(minQty),maxQty:Number(maxQty),eoq:editing?.eoq??0,isActive:editing?.isActive??false,
    alertEnabled:enabled,...(editing?{revision:editing.revision}:{})}};
   try{sessionStorage.setItem(storage,JSON.stringify(current));}catch{setError("تعذر حفظ هوية المحاولة محليًا؛ لم يُرسل الطلب.");return;}
   setIntent(current);
  }
  sending.current=true;setBusy(true);setError("");
  try{
   const responsibility=getWorkspaceResponsibility();
   const response=await financialFetch(`${apiBase}/api/inventory/reorder-rules`,{method:"POST",credentials:"include",
    headers:{"Content-Type":"application/json","Idempotency-Key":current.key,...(responsibility?{"X-Workspace-Responsibility":responsibility}:{})},
    body:JSON.stringify(current.body)});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error??"تعذر حفظ القاعدة");
   if(body.rejected===true&&body.id===null){
    if(!live.current)return;
    sessionStorage.removeItem(storage);setIntent(null);setOpen(false);setError("");
    setNotice(body.message+" — لم تُنفذ هذه المحاولة وأُغلقت بمفتاحها؛ افتح القاعدة من جديد لتعديلها.");
    await qc.invalidateQueries({queryKey:["warehouse-alert-rules",scope]});return;
   }
   if(!Number.isInteger(body.id)||body.id<=0)throw new Error("لم يصل تأكيد حفظ صالح. أعد التحقق بالمحاولة نفسها.");
   if(!live.current)return;
   sessionStorage.removeItem(storage);setIntent(null);setOpen(false);setNotice("حُفظت القاعدة. التقييم الداخلي يتحدث خلال دورة الفحص؛ لا شراء أو إرسال خارجي.");
   await qc.invalidateQueries({queryKey:["warehouse-alert-rules",scope]});
  }catch(e){if(live.current)setError((e as Error).message+" — محفوظة للمراجعة بالمفتاح والمحتوى نفسيهما؛ لا تعتبر فشل الوصول دليلًا على عدم الحفظ.");}
  finally{sending.current=false;if(live.current)setBusy(false);}
 }
 return <div className="space-y-5" dir="rtl">
  <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">حدود المخزون والتنبيه الداخلي</h1>
   <p className="text-muted-foreground">لكل صنف ومستودع — تنبيه فقط، لا طلب شراء أو إرسال خارجي</p></div>
   {canManage&&<Button onClick={()=>intent?setOpen(true):edit()}>قاعدة جديدة</Button>}</div>
  <p>الرصيد المعروض فعلي في المستودع وليس توقعًا أو صافي احتياج. المستهدف إعداد محفوظ؛ الفرق عنه لا يراعي الوارد والمحجوزات وليس توصية شراء مكتملة.</p>
  <p>الدعم الحالي: أصناف عادية غير متتبعة فقط. إعدادات المتغيرات والدفعات والأرقام التسلسلية السابقة محفوظة دون اختزالها للصنف الأب.</p>
  {notice&&<p role="status">{notice}</p>}
  {intent&&<div role="alert" className="rounded border p-3">توجد محاولة حفظ لم تُحسم. <Button onClick={()=>setOpen(true)}>استرجاع محاولة الحفظ الأصلية</Button></div>}
  {rules.isPending?<p role="status">جارٍ تحميل حالة المخزون…</p>:rules.isError?<div role="alert">تعذر تحميل حالة المخزون. <Button onClick={()=>rules.refetch()}>إعادة التحقق</Button></div>:
  <Card><CardHeader><CardTitle>القواعد والحالة الحالية</CardTitle></CardHeader><CardContent>
   {!rules.data?.length?<p>لا توجد قواعد ضمن النطاق الحالي. لا تنبيهات جديدة دون تفعيل صريح.</p>:
    <Table><TableHeader><TableRow>{["الصنف / الوحدة","الفرع / المستودع","رصيد فعلي","حد التنبيه","المستهدف","التنبيه","التحرير"].map(s=><TableHead key={s}>{s}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{rules.data.map(r=><TableRow key={r.id}>
     <TableCell>{r.productName} ({r.sku}) — {r.unit}</TableCell><TableCell>{r.branchName} / {r.warehouseName}</TableCell>
     <TableCell>{r.onHand} {r.unit}</TableCell><TableCell>{r.minQty}</TableCell><TableCell>{r.maxQty}</TableCell>
     <TableCell><Badge>{!r.supported?"خارج نطاق الدعم":r.alertEnabled?"مفعّل صراحة":"غير مفعّل"}</Badge>
      {r.cycles.map(c=><div className="text-xs mt-2" key={c.id}>دورة #{c.id}: {statusName(c.status)} — الرصيد {c.quantity} / الحد {c.threshold}
       <div>التقييم: {new Date(c.evaluated_at).toLocaleString("ar-SA")}</div></div>)}</TableCell>
     <TableCell>{canManage&&r.canManage&&r.supported?<Button variant="outline" onClick={()=>intent?setOpen(true):edit(r)}>تعديل / تعطيل</Button>:"قراءة فقط"}</TableCell>
    </TableRow>)}</TableBody></Table>}
  </CardContent></Card>}
  <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent><DialogHeader><DialogTitle>حدود وتنبيه الصنف في المستودع</DialogTitle></DialogHeader>
   {intent?<p>التحقق يعيد نتيجة الطلب الأصلي دون تعديل محتواه. الصنف #{intent.body.productId}، المستودع #{intent.body.warehouseId}، الحد {intent.body.minQty}، المستهدف {intent.body.maxQty}، التنبيه {intent.body.alertEnabled?"مفعّل":"غير مفعّل"}.</p>:
   <div className="space-y-3">
    <Label>الصنف</Label><Select value={productId} onValueChange={setProductId} disabled={!!editing}><SelectTrigger aria-label="الصنف"><SelectValue placeholder="اختر الصنف"/></SelectTrigger><SelectContent>
     {(options.data?.products??[]).map(p=><SelectItem key={p.id} value={String(p.id)}>{p.nameAr} — {p.sku}</SelectItem>)}
    </SelectContent></Select>
    <Label>المستودع</Label><Select value={warehouseId} onValueChange={setWarehouseId} disabled={!!editing}><SelectTrigger aria-label="المستودع"><SelectValue placeholder="اختر المستودع"/></SelectTrigger><SelectContent>
     {(options.data?.warehouses??[]).map(w=><SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>)}</SelectContent></Select>
    <p>وحدة القياس الأساسية: {editing?.unit??product?.unit??"اختر الصنف لعرض الوحدة"}</p>
    <Label htmlFor="alert-min">حد التنبيه</Label><Input id="alert-min" type="number" min="0" value={minQty} onChange={e=>setMinQty(e.target.value)}/>
    <Label htmlFor="alert-target">المخزون المستهدف</Label><Input id="alert-target" type="number" min="0" value={maxQty} onChange={e=>setMaxQty(e.target.value)}/>
    <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>تفعيل التنبيه الداخلي لهذا المستودع صراحة</label>
    <p className="text-xs">التفعيل ينقل تنبيه هذا الصنف من المسار القديم العام إلى تنبيه داخلي حسب المستودع، دون رسائل خارجية. التعطيل لا يعيد الإرسال القديم. لا تُفعّل قواعد المنشآت الأخرى.</p>
   </div>}
   {error&&<p role="alert" className="text-destructive">{error}</p>}
   {options.isError&&!intent&&<p role="alert">تعذر تحميل دليل الأصناف أو المستودعات؛ لا يمكن الحفظ قبل اختيار بيانات صالحة.</p>}
   <Button disabled={busy||!canManage||(!intent&&(!productId||!warehouseId))} onClick={save}>{busy?"جارٍ التحقق…":intent?"التحقق من محاولة الحفظ الأصلية":"حفظ القاعدة"}</Button>
  </DialogContent></Dialog>
 </div>;
}
