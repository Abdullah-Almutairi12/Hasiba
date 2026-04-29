import { useEffect, useState } from "react";
import { Money, RiyalSymbol } from "@/components/riyal";
import { useRoute } from "wouter";
import { useGetInvoice } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Printer, Download } from "lucide-react";

interface ZatcaQrResponse {
  tlvBase64: string;
  dataUrl: string;
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: number;
  vatAmount: number;
}

export default function InvoicePrint() {
  const [, params] = useRoute("/invoices/:id/print");
  const id = params?.id ? Number(params.id) : 0;
  const { data: invoice, isLoading } = useGetInvoice(id, {
    query: { enabled: id > 0, queryKey: [`/api/invoices/${id}`] },
  });
  const [qr, setQr] = useState<ZatcaQrResponse | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`${import.meta.env.BASE_URL}api/invoices/${id}/zatca-qr`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setQr(data as ZatcaQrResponse))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setQrError(msg);
      });
  }, [id]);

  if (isLoading || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <p className="text-muted-foreground">جاري تحميل الفاتورة...</p>
      </div>
    );
  }

  const total = Number(invoice.amount);
  const vat = qr?.vatAmount ?? (total * 0.15) / 1.15;
  const subtotal = total - vat;

  return (
    <div className="min-h-screen bg-muted/30" dir="rtl">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-6 flex justify-between items-center print:hidden">
          <h1 className="text-2xl font-bold">معاينة الفاتورة</h1>
          <div className="flex gap-2">
            <Button onClick={() => window.print()} className="gap-2">
              <Printer className="size-4" />
              طباعة
            </Button>
            {qr && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = qr.dataUrl;
                  a.download = `zatca-qr-${invoice.invoiceNumber}.png`;
                  a.click();
                }}
              >
                <Download className="size-4" />
                تنزيل QR
              </Button>
            )}
          </div>
        </div>

        <div className="bg-white text-gray-900 rounded-lg shadow-lg p-10 print:shadow-none print:rounded-none">
          <div className="flex justify-between items-start border-b pb-6 mb-6">
            <div>
              <h2 className="text-3xl font-bold text-primary">
                {qr?.sellerName ?? "حاسبة AI"}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                الرقم الضريبي: {qr?.vatNumber ?? "—"}
              </p>
            </div>
            <div className="text-left">
              <p className="text-2xl font-bold">فاتورة ضريبية</p>
              <p className="text-sm text-gray-500">Tax Invoice</p>
              <p className="text-sm mt-2">
                <span className="text-gray-500">رقم: </span>
                <span className="font-mono">{invoice.invoiceNumber}</span>
              </p>
              <p className="text-sm">
                <span className="text-gray-500">التاريخ: </span>
                {new Date(invoice.createdAt).toLocaleDateString("ar-SA")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-8">
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">المورد / Supplier</p>
              <p className="font-semibold">{invoice.supplierName}</p>
            </div>
            <div className="text-left">
              <p className="text-xs text-gray-500 uppercase mb-1">تاريخ الاستحقاق</p>
              <p className="font-semibold">
                {invoice.dueDate
                  ? new Date(invoice.dueDate).toLocaleDateString("ar-SA")
                  : "—"}
              </p>
            </div>
          </div>

          <table className="w-full border-collapse mb-8">
            <thead>
              <tr className="bg-gray-100 text-sm">
                <th className="border p-3 text-right">البيان</th>
                <th className="border p-3 text-left w-40">المبلغ <RiyalSymbol className="opacity-60" /></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-3">فاتورة من {invoice.supplierName}</td>
                <td className="border p-3 text-left font-mono">
                  {subtotal.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="flex justify-between items-end">
            <div>
              {qr ? (
                <div className="text-center">
                  <img
                    src={qr.dataUrl}
                    alt="ZATCA QR Code"
                    className="size-40 border rounded-md"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    رمز ZATCA الضريبي / Phase 1
                  </p>
                </div>
              ) : qrError ? (
                <div className="text-xs text-red-600">تعذر إنشاء رمز QR: {qrError}</div>
              ) : (
                <div className="size-40 border rounded-md bg-gray-50 grid place-items-center text-xs text-gray-400">
                  جاري التحميل...
                </div>
              )}
            </div>
            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">المجموع قبل الضريبة</span>
                <span className="font-mono">{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">ضريبة القيمة المضافة (15%)</span>
                <span className="font-mono">{vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-bold">
                <span>الإجمالي</span>
                <span className="font-mono text-primary"><Money value={total} /></span>
              </div>
            </div>
          </div>

          <div className="mt-12 pt-6 border-t text-center text-xs text-gray-400">
            تم إنشاء هذه الفاتورة بواسطة حاسبة AI — نظام محاسبة معتمد متوافق مع متطلبات هيئة الزكاة والضريبة
          </div>
        </div>
      </div>
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          .print\\:rounded-none { border-radius: 0 !important; }
        }
      `}</style>
    </div>
  );
}
