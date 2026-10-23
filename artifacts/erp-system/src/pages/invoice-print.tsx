import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer, Download, RefreshCw } from "lucide-react";
import { downloadPdf, DownloadError } from "@/lib/download-file";
import { withBase } from "@/lib/print-docs";

/** This route owns SUPPLIER invoice IDs (/api/invoices/:id), not sales invoices.
 *  It previews the server's PDF of the saved supplier invoice and never renders
 *  any company identity itself. (No generated URL helper exists for this endpoint.) */
export const issuedInvoicePdfUrl = (id: number) =>
  withBase(`/api/invoices/${encodeURIComponent(String(id))}/pdf`);

type State =
  | { kind: "loading" }
  | { kind: "ready"; href: string }
  | { kind: "error"; message: string; ref: string };

export default function InvoicePrint() {
  const [, params] = useRoute("/invoices/:id/print");
  const id = params?.id && /^\d+$/.test(params.id) ? Number(params.id) : 0;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!id) { setState({ kind: "error", message: "رقم الفاتورة غير صالح", ref: "INVALID_ID" }); return; }
    let href = "";
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const r = await fetch(issuedInvoicePdfUrl(id), { credentials: "include", headers: { Accept: "application/pdf" } });
        const ok = r.ok && (r.headers.get("content-type") ?? "").toLowerCase().includes("application/pdf");
        if (!ok) {
          let message = "تعذر تحميل ملف فاتورة المورد", ref = r.headers.get("x-diagnostic-ref") ?? `HTTP-${r.status}`;
          try { const b = await r.json(); if (typeof b.error === "string") message = b.error.slice(0, 250); if (typeof b.diagnosticRef === "string") ref = b.diagnosticRef; } catch { /* not json */ }
          if (!cancelled) setState({ kind: "error", message, ref });
          return;
        }
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
          if (!cancelled) setState({ kind: "error", message: "الاستجابة ليست ملف PDF صالحًا", ref: "INVALID_PDF_RESPONSE" });
          return;
        }
        href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        if (cancelled) { URL.revokeObjectURL(href); return; }
        setState({ kind: "ready", href });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "تعذر الاتصال؛ أعد المحاولة", ref: "DOWNLOAD_CONNECTION" });
      }
    })();
    return () => { cancelled = true; if (href) URL.revokeObjectURL(href); };
  }, [id, nonce]);

  const [dlError, setDlError] = useState<string | null>(null);
  const download = async () => {
    setDlError(null);
    try { await downloadPdf(issuedInvoicePdfUrl(id), `supplier-invoice-${id}.pdf`); }
    catch (e) { setDlError(e instanceof DownloadError ? `${e.message} (${e.diagnosticRef})` : "تعذر التنزيل"); }
  };
  const print = () => {
    const w = frame.current?.contentWindow;
    if (w) { w.focus(); w.print(); }
  };

  return (
    <div className="min-h-screen bg-muted/30" dir="rtl">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-6 flex justify-between items-center print:hidden">
          <h1 className="text-2xl font-bold">معاينة الفاتورة</h1>
          <div className="flex gap-2">
            <Button onClick={print} className="gap-2" disabled={state.kind !== "ready"} data-testid="button-invoice-print">
              <Printer className="size-4" />
              طباعة
            </Button>
            <Button variant="outline" className="gap-2" onClick={download} disabled={!id} data-testid="button-invoice-download">
              <Download className="size-4" />
              تنزيل PDF
            </Button>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          ملف PDF للقراءة فقط، يُنشئه الخادم من فاتورة المورد المحفوظة.
        </p>
        {dlError && <p role="alert" className="mb-3 rounded border border-destructive/40 p-2 text-sm">{dlError}</p>}

        {state.kind === "loading" && <Skeleton className="h-[80vh] w-full rounded-lg" data-testid="invoice-pdf-loading" />}
        {state.kind === "error" && (
          <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-card p-6 text-sm" data-testid="invoice-pdf-error">
            <p>{state.message}</p>
            <p dir="ltr" className="text-xs text-muted-foreground">{state.ref}</p>
            <Button variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)}><RefreshCw className="me-1 size-4" />إعادة المحاولة</Button>
          </div>
        )}
        {state.kind === "ready" && (
          <iframe ref={frame} src={state.href} title="فاتورة المورد" className="h-[80vh] w-full rounded-lg border bg-card" data-testid="invoice-pdf-frame" />
        )}
      </div>
    </div>
  );
}
