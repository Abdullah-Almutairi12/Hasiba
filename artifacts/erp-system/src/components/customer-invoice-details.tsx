import {useApiQuery} from "@/hooks/use-api";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
type Detail={reference:string;customerName:string;invoiceDate:string;dueDate:string;currencyCode:string;subtotal:number;discount:number;vat:number;total:number;
  lines:Array<{id:number;description:string;quantity:number;unitPrice:number;discountPct:number;taxRate:number;lineTotal:number}>};
type History={historicalIdentityAvailable:boolean;identity:null|{
  creator:{id:number|null;name:string|null};cashier:null|{id:number;name:string};
  sellers:Array<{invoiceLineId:number;employeeId:number|null;name:string}>};
  events:Array<{id:string|number;action:string;actorId:number|null;actorName:string|null;at:string;reason:string|null;approvalId:number|null;
    before:unknown;after:unknown;facts:unknown}>};
const actionLabels:Record<string,string>={issued:"إصدار الفاتورة",approval_approve:"اعتماد مرتبط",approval_reject:"رفض مرتبط",
  approval_comment:"تعليق على الموافقة",approval_request_changes:"طلب تعديل",approval_delegated:"تفويض مسجل",
  file_generated:"إنشاء ملف PDF",print_requested:"طلب طباعة (دون تأكيد الجهاز)",export_requested:"طلب تصدير PDF",
  seller_corrected:"تصحيح نسبة البيع",partial_or_full_return:"مرتجع مرتبط بالفاتورة",refund_recorded:"تسجيل استرداد"};
/** Read-only native details: never fetches a PDF or adds print/export rights. */
export function CustomerInvoiceDetails({id,onClose}:{id:number|null;onClose:()=>void}){
  const {data,isLoading,error}=useApiQuery<Detail>(id?`/sales/invoices/${id}`:"/sales/invoices/0",{enabled:id!==null});
  const history=useApiQuery<History>(id?`/sales/invoices/${id}/history`:"/sales/invoices/0/history",{enabled:id!==null});
  if(id===null)return null;
  const money=(v:number)=>`${Number(v).toLocaleString("ar-SA",{minimumFractionDigits:2,maximumFractionDigits:2})} ${data?.currencyCode??""}`;
  return <Dialog open={id!==null} onOpenChange={open=>{if(!open)onClose();}}>
    <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto" data-testid="customer-invoice-details">
      <DialogHeader><DialogTitle>{data?.reference??"عرض الفاتورة"}</DialogTitle>
        <DialogDescription>عرض البيانات فقط؛ الطباعة وتصدير PDF يحتاجان منحًا مستقلة في المسؤولية.</DialogDescription></DialogHeader>
      {isLoading?<p>جاري تحميل الفاتورة…</p>:error?<p role="alert">تعذر عرض الفاتورة؛ تحقق من الصلاحية الحالية.</p>:data?<>
        <p>{data.customerName}</p>
        <p className="text-sm">تاريخ الفاتورة: {data.invoiceDate} — الاستحقاق: {data.dueDate}</p>
        <table className="w-full text-sm"><thead><tr>{["الوصف","الكمية","سعر الوحدة","الخصم","الضريبة","الإجمالي"].map(h=><th key={h} className="p-2 text-start">{h}</th>)}</tr></thead>
          <tbody>{data.lines.map(line=><tr key={line.id} className="border-t"><td className="p-2">{line.description}</td><td>{line.quantity}</td><td>{money(line.unitPrice)}</td><td>{line.discountPct}%</td><td>{line.taxRate}%</td><td>{money(line.lineTotal)}</td></tr>)}</tbody></table>
        <dl className="space-y-2">{[["قبل الضريبة",data.subtotal],["الخصم",data.discount],["ضريبة القيمة المضافة",data.vat],["الإجمالي",data.total]].map(([label,value])=><div key={String(label)} className="flex justify-between"><dt>{label}</dt><dd>{money(Number(value))}</dd></div>)}</dl>
        <section className="border-t pt-3 space-y-2" data-testid="invoice-document-history">
          <h3 className="font-semibold">هوية البيع وسجل المستند</h3>
          {history.isLoading?<p>جاري تحميل السجل…</p>:history.error?<p role="alert">تعذر تحميل سجل المستند؛ تحقق من الصلاحية الحالية.</p>:history.data?<>
            {history.data.identity?<dl className="text-sm space-y-1">
              <div>المنشئ: {history.data.identity.creator.name??"غير محفوظ"} — المعرّف: {history.data.identity.creator.id??"غير محفوظ"}</div>
              <div>المحصل: {history.data.identity.cashier?`${history.data.identity.cashier.name} — ${history.data.identity.cashier.id}`:"لا يوجد تحصيل مثبت في هوية الإصدار"}</div>
              <div>البائع عند الإصدار: {[...new Set(history.data.identity.sellers.filter(s=>s.employeeId!==null).map(s=>`${s.name} — ${s.employeeId}`))].join("، ")||"غير منسوب"}</div>
            </dl>:<p>لا توجد هوية بيع تاريخية محفوظة بهذه الصيغة؛ لم يُفترض بائع أو محصل.</p>}
            <p className="text-xs text-muted-foreground">هوية الإصدار لا تتغير بتصحيح نسبة التقرير. الأسماء في أحداث قديمة بلا لقطة اسم قد تأتي من الحساب الحالي؛ المعرّف هو المرجع. إنشاء الملف لا يثبت الطباعة الفعلية.</p>
            {history.data.events.length?history.data.events.map(event=><article key={event.id} className="rounded border p-2 text-sm">
              <p className="font-medium">{actionLabels[event.action]??event.action}</p>
              <p>{event.actorName??"اسم غير محفوظ"} — المعرّف: {event.actorId??"غير محفوظ"} — {new Date(event.at).toLocaleString("ar-SA")}</p>
              {event.reason&&<p>السبب: {event.reason}</p>}
              {event.approvalId&&<p>مرجع الموافقة: {event.approvalId}</p>}
              {event.before!==null&&<details><summary>قبل التصحيح وبعده</summary><pre className="whitespace-pre-wrap" dir="auto">{JSON.stringify({قبل:event.before,بعد:event.after},null,2)}</pre></details>}
              {event.facts!==null&&<details><summary>مرجع المستند والحالة</summary><pre className="whitespace-pre-wrap" dir="auto">{JSON.stringify(event.facts,null,2)}</pre></details>}
            </article>):<p>لا توجد أحداث إضافية مسجلة.</p>}
          </>:null}
        </section>
      </>:<p>لا توجد بيانات متاحة.</p>}
    </DialogContent>
  </Dialog>;
}
