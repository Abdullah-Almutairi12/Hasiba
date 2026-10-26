import { useGetInvoice, useGetSupplierInvoiceEvidence } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatRiyal } from "@/components/riyal";
import { SupplierInvoiceComparison } from "./supplier-invoice-comparison";
import { useSelectedResponsibility } from "@/lib/workspace-responsibility";
import { SupplierInvoiceActions } from "./supplier-invoice-actions";

export function SupplierInvoiceDetails({ id, onClose,legacyFinance=false }: { id: number | null; onClose: () => void;legacyFinance?:boolean }) {
  const query = useGetInvoice(id ?? 0, { query: { enabled: id != null } });
  const evidence = useGetSupplierInvoiceEvidence(id ?? 0, { query: { enabled: id != null } });
  const grant = useSelectedResponsibility();
  const canCompare = grant == null || grant.resource === "procurement" && grant.actions.includes("procurement.invoices.compare");
  const file = (query.data as unknown as { fileUrl?: string } | undefined)?.fileUrl;
  const privateFile = file && /^\/api\/storage\/objects\/invoices\//.test(file)
    ? `${import.meta.env.BASE_URL.replace(/\/$/, "")}${file}` : null;
  return <Dialog open={id != null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent dir="rtl" className="max-w-5xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>تفاصيل فاتورة المورد</DialogTitle>
      <DialogDescription>البيانات والمرفق الأصلي ضمن صلاحية القراءة الحالية، دون تنفيذ عملية مالية.</DialogDescription></DialogHeader>
      {query.isLoading && <p>جارٍ تحميل التفاصيل…</p>}
      {query.isError && <p role="alert">تعذر عرض الفاتورة؛ قد تكون الصلاحية سحبت أو المستند خارج النطاق.</p>}
      {query.data && !query.isError && <dl className="space-y-3">
        <dt>رقم الفاتورة</dt><dd>{query.data.invoiceNumber}</dd>
        <dt>المورد</dt><dd>{query.data.supplierName}</dd>
        <dt>المبلغ</dt><dd>{formatRiyal(query.data.amount)}</dd>
        <dt>الحالة</dt><dd>{query.data.status}</dd>
        <dt>المرفق الأصلي</dt><dd>{privateFile
          ? <a className="underline text-primary" href={privateFile} target="_blank" rel="noopener noreferrer">عرض المرفق المصرح به</a>
          : "لا يوجد مرفق خاص متاح"}</dd>
      </dl>}
      {evidence.isLoading && <p>جارٍ تحميل البنود الأصلية…</p>}
      {evidence.isError && <p role="alert">تعذر قراءة دليل البنود؛ لم تستخدم بنود الأمر بدلًا عنه.</p>}
      {evidence.data?.historicalLimit && <p>{evidence.data.historicalLimit}</p>}
      {evidence.data?.version===1 && <section aria-label="بنود الفاتورة الأصلية">
        <h3>بنود الفاتورة الأصلية</h3>
        <table className="w-full text-sm"><thead><tr><th>البند</th><th>الكمية</th><th>سعر الوحدة</th><th>الصافي المحسوب</th></tr></thead>
          <tbody>{evidence.data.lines.map(l=><tr key={l.id}><td>{l.description}</td><td>{l.quantity}</td><td>{l.unitPrice}</td><td>{l.netAmount}</td></tr>)}</tbody></table>
        {!!evidence.data.receipts?.length&&<section aria-label="دليل ربط الاستلام">
          <h4>إسناد الاستلام المحفوظ عند الترحيل</h4>
          <ul>{evidence.data.receipts.map(r=><li key={r.id}>{r.reference} — الكمية {r.quantity} — تكلفة المصدر {r.unitCost}
            {r.reversedAt?" — عكس الإسناد بسند، مع بقاء الدليل":""}</li>)}</ul>
        </section>}
        {canCompare && !query.data?.reversesId && evidence.data.poId && id && <SupplierInvoiceComparison poId={evidence.data.poId} invoiceId={id}
          items={evidence.data.lines.map(l=>({poLineId:l.poLineId,quantity:Number(l.quantity),unitPrice:Number(l.unitPrice)}))}/>}
      </section>}
      {query.data?.lifecycleVersion===1&&evidence.data&&<SupplierInvoiceActions legacyFinance={legacyFinance} invoice={query.data} evidence={evidence.data}/>}
    </DialogContent>
  </Dialog>;
}
