import {useRef,useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {Link} from "wouter";
import {processSupplierInvoice,type Invoice,type SupplierInvoiceEvidence,type SupplierInvoiceProcessInput} from "@workspace/api-client-react";
import {useSelectedResponsibility} from "@/lib/workspace-responsibility";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {SupplierInvoiceDraftDialog,refreshSupplierInvoices} from "./supplier-invoice-draft";

export function SupplierInvoiceActions({invoice,evidence,legacyFinance=false}:{invoice:Invoice;evidence:SupplierInvoiceEvidence;legacyFinance?:boolean}) {
  const grant=useSelectedResponsibility(),client=useQueryClient();
  const can=(action:string)=>grant==null?legacyFinance:grant.resource==="procurement"&&grant.actions.includes(`procurement.invoices.${action}`);
  const [pending,setPending]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[reason,setReason]=useState("");
  const attempts=useRef(new Map<string,string>());
  async function execute(action:SupplierInvoiceProcessInput["action"]) {
    if(pending)return;
    const payload:SupplierInvoiceProcessInput={action,...(action==="reverse"?{reason}:{})};
    const identity=JSON.stringify(payload),key=attempts.current.get(identity)??crypto.randomUUID();
    attempts.current.set(identity,key);setPending(true);setError("");setNotice("");
    try{
      const result=await processSupplierInvoice(invoice.id,payload,{headers:{"Idempotency-Key":key}});
      const labels:Record<string,string>={draft:"مسودة",pending_approval:"بانتظار الاعتماد",approved:"معتمدة",
        done:"مرحلة",cancelled:"ملغاة مع حفظ الأصل",reversed:"معكوسة بسند"};
      const confirmation=action==="review"?"اكتملت المراجعة وحُفظ دليلها؛ ليست اعتمادًا أو ترحيلًا.":`الحالة: ${labels[result.status]??result.status}`;
      attempts.current.delete(identity);setNotice(`حُفظت / استُرجعت نتيجة المحاولة — ${confirmation}${result.journalEntryId?` — القيد ${result.journalEntryId}`:""}${result.reversedById?` — سند العكس ${result.reversedById}`:""}`);
      await refreshSupplierInvoices(client);
    }catch(e){setError(e instanceof Error?e.message:"تعذر استلام النتيجة؛ أعد نفس الإجراء للتحقق دون تكرار الأثر.");}
    finally{setPending(false);}
  }
  const draft=["draft","pending_approval","approved","rejected"].includes(invoice.status);
  return <section aria-label="إجراءات فاتورة المورد" className="space-y-3 border-t pt-3">
    <h3 className="font-semibold">المراجعة والاعتماد والترحيل</h3>
    <p>لا يوجد صرف في هذه الإجراءات. الترحيل يسجل الالتزام المحاسبي ولا يستلم بضاعة جديدة.</p>
    <div className="flex flex-wrap gap-2">
      {draft&&<SupplierInvoiceDraftDialog allowed={!pending&&can("edit")} id={invoice.id} initial={{
        supplierId:invoice.supplierId!,invoiceNumber:invoice.supplierDocumentNumber??invoice.invoiceNumber,
        invoiceDate:(invoice.invoiceDate??new Date().toISOString()).slice(0,10),branchId:invoice.branchId!,poId:invoice.poId,
        kind:invoice.invoiceKind as "goods"|"service"|"expense",expenseAccountId:invoice.expenseAccountId,
        notes:invoice.notes??"",items:evidence.lines.map(l=>({description:l.description,quantity:Number(l.quantity),unitPrice:Number(l.unitPrice),
          taxRate:(l.taxRate??0) as 0|15,unit:l.unit??"piece",productId:l.productId,poLineId:l.poLineId})),
      }}/>}
      {invoice.status==="draft"&&can("review")&&<Button disabled={pending} onClick={()=>execute("review")}>مراجعة الفاتورة</Button>}
      {invoice.status==="draft"&&can("submit")&&<Button disabled={pending||!invoice.reviewedBy} onClick={()=>execute("submit")}>تقديم للاعتماد</Button>}
      {invoice.status==="approved"&&can("post")&&<Button disabled={pending} onClick={()=>execute("post")}>ترحيل الفاتورة</Button>}
      {draft&&can("cancel")&&<Button variant="outline" disabled={pending} onClick={()=>execute("cancel")}>إلغاء المسودة مع حفظ التاريخ</Button>}
    </div>
    {invoice.status==="pending_approval"&&<p>بانتظار سلسلة الاعتماد في <Link href="/approvals" className="underline">صفحة الموافقات</Link>؛ صلاحية الترحيل مستقلة عن صلاحية الاعتماد.</p>}
    {invoice.status==="done"&&!invoice.reversesId&&!invoice.reversedById&&can("reverse")&&<div className="space-y-2">
      <p>العكس يصدر سندًا وقيدًا معاكسًا ويحرر الكمية المفوترة؛ لا يحذف الأصل ولا يعيد البضاعة إلى المخزون مرة ثانية.</p>
      <label>سبب عكس الفاتورة<Input value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <Button variant="destructive" disabled={pending||!reason.trim()} onClick={()=>execute("reverse")}>عكس الفاتورة بسند موثق</Button>
    </div>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="text-destructive">{error}<br/>أعد نفس الإجراء لاسترجاع النتيجة إذا فُقد الرد.</p>}
  </section>;
}
