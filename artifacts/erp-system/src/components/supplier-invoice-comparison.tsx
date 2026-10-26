import { useEffect } from "react";
import { usePreviewSupplierInvoiceMatch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

export function SupplierInvoiceComparison({ poId, items, invoiceId }: {
  poId: number; invoiceId?: number; items: Array<{ poLineId?: number | null; quantity: number; unitPrice: number }>;
}) {
  const comparison = usePreviewSupplierInvoiceMatch();
  const identity = JSON.stringify({ poId, items, invoiceId });
  useEffect(() => { comparison.reset(); }, [identity]);
  const complete = items.length > 0 && items.every(i => i.poLineId && i.quantity > 0);
  return <section className="rounded border p-3 space-y-3" aria-label="مطابقة فاتورة المورد">
    <h3 className="font-semibold">مقارنة الطلب والاستلام والفوترة</h3>
    <p className="text-sm text-muted-foreground">معاينة من الخادم، لا اعتماد أو ترحيل أو حجز للكميات.</p>
    <Button type="button" variant="outline" disabled={!complete || comparison.isPending}
      onClick={() => comparison.mutate({ data: { poId, ...(invoiceId?{invoiceId}:{}),
        items: items.map(i => ({ poLineId: i.poLineId!, quantity: i.quantity, unitPrice: i.unitPrice })) } })}>
      {comparison.isPending ? "جارٍ إعداد المقارنة…" : "معاينة فروق المطابقة"}
    </Button>
    {!complete && <p className="text-sm">اربط كل بند بسطر أمر الشراء وأدخل كمية موجبة أولًا.</p>}
    {comparison.isError && <p role="alert" className="text-sm text-destructive">تعذرت معاينة المطابقة. تحقق من الصلاحية والنطاق وبيانات البنود.</p>}
    {comparison.data && <div className="space-y-2">
      <p className="font-medium">{comparison.data.source.reference} — {comparison.data.requiresReview ? "توجد فروق تحتاج مراجعة" : "لا توجد فروق وفق البيانات الحالية"}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr>{["البند / الوحدة", "المطلوب", "المستلم", "المفوتر سابقًا", "الحالي", "مبلغ الحالي قبل الضريبة", "المراجعة"].map(t => <th className="p-2 text-start" key={t}>{t}</th>)}</tr></thead>
        <tbody>{comparison.data.lines.map(l => <tr key={l.id} className="border-t">
          <td className="p-2">{l.description} / {l.unit}</td>
          <td>{l.ordered}</td><td>{l.received}</td><td>{l.billed}</td><td>{l.current}</td>
          <td>{l.currentAmount} {comparison.data.currency}</td>
          <td>{l.messages.length ? l.messages.map(m => <p key={m} className="text-amber-700">{m}</p>) : "مطابق"}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="text-sm">{comparison.data.explanation}</p>
      <p className="text-xs text-muted-foreground">{comparison.data.evidenceLimit}</p>
    </div>}
  </section>;
}
