import {useApiQuery} from "@/hooks/use-api";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
type Detail={reference:string;customerName:string;invoiceDate:string;dueDate:string;currencyCode:string;subtotal:number;discount:number;vat:number;total:number;
  lines:Array<{id:number;description:string;quantity:number;unitPrice:number;discountPct:number;taxRate:number;lineTotal:number}>};
/** Read-only native details: never fetches a PDF or adds print/export rights. */
export function CustomerInvoiceDetails({id,onClose}:{id:number|null;onClose:()=>void}){
  const {data,isLoading,error}=useApiQuery<Detail>(id?`/sales/invoices/${id}`:"/sales/invoices/0",{enabled:id!==null});
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
      </>:<p>لا توجد بيانات متاحة.</p>}
    </DialogContent>
  </Dialog>;
}
