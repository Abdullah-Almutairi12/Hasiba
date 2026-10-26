import {useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {createSupplierInvoiceDraft,updateSupplierInvoiceDraft,useGetSupplierInvoiceDraftOptions,
  type SupplierInvoiceDraftInput} from "@workspace/api-client-react";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";

export function refreshSupplierInvoices(client:ReturnType<typeof useQueryClient>) {
  return client.invalidateQueries({predicate:q=>/invoices|suppliers|accounting|procurement/.test(String(q.queryKey[0]))});
}
export function SupplierInvoiceDraftDialog({allowed,id,initial,onSaved}:{allowed:boolean;id?:number;
  initial?:SupplierInvoiceDraftInput;onSaved?:(id:number)=>void}) {
  const [open,setOpen]=useState(false);
  if(!allowed)return null;
  return <><Button variant="outline" onClick={()=>setOpen(true)}>{id?"تعديل المسودة":"إنشاء مسودة فاتورة مورد"}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent dir="rtl" className="max-w-5xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{id?"تعديل مسودة فاتورة المورد":"مسودة فاتورة مورد"}</DialogTitle>
        <DialogDescription>بالريال السعودي. الحفظ لا ينشئ استلامًا أو قيدًا أو صرفًا. تعديل الحقائق يبطل المراجعة السابقة ويحفظ نسختها.</DialogDescription></DialogHeader>
      {open&&<DraftForm id={id} initial={initial} onSaved={value=>{setOpen(false);onSaved?.(value);}}/>}
    </DialogContent></Dialog></>;
}
const empty:SupplierInvoiceDraftInput={supplierId:0,branchId:0,invoiceNumber:"",invoiceDate:"",
  kind:"expense",items:[{description:"",quantity:1,unitPrice:0,taxRate:0,unit:"piece"}]};
type FormInput=Omit<SupplierInvoiceDraftInput,"items">&{
  items:Array<Omit<SupplierInvoiceDraftInput["items"][number],"unitPrice">&{unitPrice:number|""}>};
function DraftForm({id,initial,onSaved}:{id?:number;initial?:SupplierInvoiceDraftInput;onSaved:(id:number)=>void}) {
  const options=useGetSupplierInvoiceDraftOptions(id?{invoiceId:id}:{});
  const [body,setBody]=useState<FormInput>(initial??{...empty,invoiceDate:new Date().toISOString().slice(0,10)});
  const [attempt]=useState(()=>crypto.randomUUID());
  const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
  const client=useQueryClient();
  const update=(patch:Partial<FormInput>)=>setBody(old=>({...old,...patch}));
  const source=options.data?.orders.find(o=>o.id===body.poId);
  async function save(event:React.FormEvent) {
    event.preventDefault();setPending(true);setError("");
    try {
      if(body.items.some(l=>l.unitPrice==="")){setError("أدخل أسعار بنود الفاتورة الأصلية؛ لا يستبدل السعر المحجوب بصفر.");return;}
      const data:SupplierInvoiceDraftInput={...body,items:body.items.map(l=>({...l,unitPrice:Number(l.unitPrice)}))};
      const result=id?await updateSupplierInvoiceDraft(id,data,{headers:{"Idempotency-Key":attempt}})
        :await createSupplierInvoiceDraft(data,{headers:{"Idempotency-Key":attempt}});
      await refreshSupplierInvoices(client);onSaved(result.id);
    } catch(e){
      const status=typeof e==="object"&&e&&"status" in e?Number(e.status):0;
      setUncertain(!(status>=400&&status<500));
      setError(e instanceof Error?e.message:"تعذر حفظ المسودة. لم تحذف مدخلاتك.");
    }
    finally{setPending(false);}
  }
  if(options.isLoading)return <p>جارٍ قراءة المراجع المصرح بها…</p>;
  if(options.isError)return <p role="alert">تعذر تحميل مراجع المسودة. تحقق من مسؤولية الإنشاء أو التعديل ونطاقها.</p>;
  return <form onSubmit={save} className="space-y-4">
    <fieldset disabled={pending||uncertain} className="space-y-4">
    <div className="grid gap-3 md:grid-cols-3">
      <label>رقم فاتورة المورد<Input required value={body.invoiceNumber} onChange={e=>update({invoiceNumber:e.target.value})}/></label>
      <label>تاريخ فاتورة المورد<Input type="date" required value={body.invoiceDate} onChange={e=>update({invoiceDate:e.target.value})}/></label>
      <label>نوع الفاتورة<select className="w-full border rounded p-2" value={body.kind} onChange={e=>update({kind:e.target.value as SupplierInvoiceDraftInput["kind"]})}>
        <option value="goods">بضاعة / بنود مختلطة</option><option value="service">خدمة</option><option value="expense">مصروف</option></select></label>
      <label>مرجع أمر الشراء<select className="w-full border rounded p-2" value={body.poId??""} onChange={e=>{
        const order=options.data?.orders.find(o=>o.id===Number(e.target.value));
        if(!order){update({poId:null,items:empty.items});return;}
        update({poId:order.id,supplierId:order.supplierId??0,branchId:order.branchId,
          kind:order.lines.some(l=>l.productId!=null)?"goods":"service",
          items:order.lines.map(l=>({description:l.description,quantity:l.quantity?Number(l.quantity):1,unitPrice:l.unitPrice==null?"":Number(l.unitPrice),
            unit:l.unit,productId:l.productId,poLineId:l.id,taxRate:0}))});
      }}><option value="">دون أمر — خدمة أو مصروف فقط</option>{options.data?.orders.map(o=><option key={o.id} value={o.id}>{o.reference}</option>)}</select></label>
      <label>المورد<select required className="w-full border rounded p-2" value={body.supplierId||""} disabled={!!body.poId}
        onChange={e=>update({supplierId:Number(e.target.value)})}><option value="">اختر المورد</option>
        {options.data?.suppliers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      <label>فرع الفاتورة<select required className="w-full border rounded p-2" value={body.branchId||""} disabled={!!body.poId}
        onChange={e=>update({branchId:Number(e.target.value)})}><option value="">اختر الفرع</option>
        {options.data?.branches.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      <label>حساب المصروف / فرق السعر<select className="w-full border rounded p-2" value={body.expenseAccountId??""}
        onChange={e=>update({expenseAccountId:e.target.value?Number(e.target.value):null})}><option value="">غير محدد</option>
        {options.data?.accounts.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    </div>
    {source?.referenceOnly&&<p>هذا مرجع ربط فقط ضمن حد المسؤولية. أسعار وكميات أمر الشراء الكاملة محجوبة؛ أدخل بنود فاتورة المورد الأصلية.</p>}
    <p className="text-sm text-muted-foreground">البضاعة تفوتر الكمية المستلمة غير المفوترة فقط؛ بنود الخدمة لا تفرض استلامًا مخزنيًا. المجموع والحدود يحسبهما الخادم.</p>
    {body.items.map((item,index)=><fieldset className="border rounded p-3 grid gap-2 md:grid-cols-5" key={index}>
      <legend>بند {index+1}{source?` — سطر المصدر ${item.poLineId}`:""}</legend>
      {(["description","quantity","unitPrice"] as const).map(field=><label key={field}>
        {{description:"وصف البند",quantity:"الكمية",unitPrice:"سعر الوحدة"}[field]} {index+1}
        <Input required type={field==="description"?"text":"number"} min={field==="quantity"?"0.000001":field==="unitPrice"?"0":undefined}
          step={field==="description"?undefined:"0.000001"} value={item[field]}
          onChange={e=>update({items:body.items.map((l,i)=>i===index?{...l,[field]:field==="description"?e.target.value:
            field==="unitPrice"&&e.target.value===""?"":Number(e.target.value)}:l)})}/>
      </label>)}
      <label>الضريبة {index+1}<select className="w-full border rounded p-2" value={item.taxRate??0} onChange={e=>update({
        items:body.items.map((l,i)=>i===index?{...l,taxRate:Number(e.target.value) as 0|15}:l)})}><option value={0}>0%</option><option value={15}>15%</option></select></label>
      <div><p>الوحدة: {item.unit}</p><Button type="button" variant="outline" disabled={body.items.length===1}
        onClick={()=>update({items:body.items.filter((_,i)=>i!==index)})}>حذف البند {index+1}</Button></div>
    </fieldset>)}
    {!body.poId&&<Button type="button" variant="outline" onClick={()=>update({items:[...body.items,{...empty.items[0]}]})}>إضافة بند</Button>}
    <label className="block">ملاحظات المسودة<Input value={body.notes??""} onChange={e=>update({notes:e.target.value})}/></label>
    </fieldset>
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    <Button disabled={pending}>{pending?"جارٍ الحفظ…":uncertain?"استرجاع نتيجة محاولة الحفظ":"حفظ المسودة"}</Button>
    <p className="text-xs">مرجع محاولة الحفظ: {attempt}. عند فقد الرد أعد المحاولة دون تغيير البيانات لحسم النتيجة.</p>
  </form>;
}
