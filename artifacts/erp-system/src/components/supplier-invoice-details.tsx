import { useGetInvoice } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatRiyal } from "@/components/riyal";

export function SupplierInvoiceDetails({ id, onClose }: { id: number | null; onClose: () => void }) {
  const query = useGetInvoice(id ?? 0, { query: { enabled: id != null } });
  const file = (query.data as unknown as { fileUrl?: string } | undefined)?.fileUrl;
  const privateFile = file && /^\/api\/storage\/objects\/invoices\//.test(file)
    ? `${import.meta.env.BASE_URL.replace(/\/$/, "")}${file}` : null;
  return <Dialog open={id != null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent dir="rtl"><DialogHeader><DialogTitle>تفاصيل فاتورة المورد</DialogTitle></DialogHeader>
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
    </DialogContent>
  </Dialog>;
}
