import { useEffect, useRef, useState } from "react";
import { getWorkspaceResponsibility } from "@workspace/api-client-react";
import { useSelectedResponsibility } from "@/lib/workspace-responsibility";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Printer, Download, Loader2 } from "lucide-react";

interface PdfPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfUrl: string | null;
  title: string;
  downloadName: string;
  allowDownload?: boolean;
  allowPrint?: boolean;
  printUrl?: string | null;
  downloadUrl?: string;
}

export function PdfPreviewSheet({
  open,
  onOpenChange,
  pdfUrl,
  title,
  downloadName,
  allowDownload = true,
  allowPrint = true,
  printUrl,
  downloadUrl,
}: PdfPreviewSheetProps) {
  const selection=useSelectedResponsibility();
  const requestOptions=()=>({credentials:"include" as const,headers:getWorkspaceResponsibility()?
    {"X-Workspace-Responsibility":getWorkspaceResponsibility()!}:undefined});
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventIds=useRef<Record<string,string>>({});
  const generation=useRef(0);
  function outputUrl(url:string,action:"file_generated"|"print_requested"|"export_requested"){
    if(!/\/sales\/invoices\/\d+\/pdf(?:\?|$)/.test(url))return url;
    const key=`${url}|${action}`;
    const eventId=eventIds.current[key]??(eventIds.current[key]=crypto.randomUUID());
    return `${url}${url.includes("?")?"&":"?"}intent=${action}&eventId=${eventId}`;
  }

  useEffect(() => {
    generation.current++;
    if (!open || !pdfUrl) {
      eventIds.current={};
      setBlobUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);
    fetch(outputUrl(pdfUrl,pdfUrl.includes("download=1")?"export_requested":"file_generated"), requestOptions())
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      generation.current++;
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, pdfUrl,selection?.id,allowPrint,allowDownload]);

  async function handlePrint() {
    if(!allowPrint)return;
    const captured=generation.current;
    if(printUrl){
      try{
        const response=await fetch(outputUrl(printUrl,"print_requested"),requestOptions());
        if(!response.ok)throw new Error("تعذرت الطباعة؛ تحقق من صلاحية الطباعة الحالية");
        await response.arrayBuffer();
        if(captured!==generation.current)return;
        setError(null);
      }catch(e){setError(e instanceof Error?e.message:"تعذرت الطباعة");return;}
    }
    const win = iframeRef.current?.contentWindow;
    if (win) {
      try {
        win.focus();
        win.print();
        return;
      } catch {
        // Fall through to opening in a new tab.
      }
    }
    if (blobUrl) window.open(blobUrl, "_blank", "noopener,noreferrer");
  }

  async function handleDownload() {
    if (!allowDownload) return;
    if (!blobUrl) return;
    let downloadBlobUrl: string | null = null;
    const captured=generation.current;
    if (downloadUrl) {
      try {
        const response = await fetch(outputUrl(downloadUrl,"export_requested"), requestOptions());
        if (!response.ok) throw new Error("تعذر التنزيل؛ تحقق من صلاحية التصدير الحالية");
        const blob=await response.blob();
        if(captured!==generation.current)return;
        downloadBlobUrl = URL.createObjectURL(blob);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "تعذر تنزيل الملف");
        return;
      }
    }
    const a = document.createElement("a");
    a.href = downloadBlobUrl ?? blobUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    if (downloadBlobUrl) setTimeout(() => URL.revokeObjectURL(downloadBlobUrl!), 1000);
    a.remove();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-full sm:max-w-2xl lg:max-w-3xl flex flex-col gap-3 p-4"
        data-testid="sheet-pdf-preview"
      >
        <div className="flex items-center justify-between gap-2 pe-8">
          <SheetTitle className="text-base truncate">{title}</SheetTitle>
          <div className="flex items-center gap-2">
            {allowDownload && <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleDownload}
              disabled={!blobUrl}
              data-testid="button-pdf-preview-download"
            >
              <Download className="size-3.5" /> تحميل
            </Button>}
            {allowPrint && <Button
              size="sm"
              className="gap-1.5"
              onClick={handlePrint}
              disabled={!blobUrl}
              data-testid="button-pdf-preview-print"
            >
              <Printer className="size-3.5" /> طباعة
            </Button>}
          </div>
        </div>
        {/\/sales\/invoices\/\d+\/pdf/.test(pdfUrl??"")&&<p className="text-xs text-muted-foreground">يسجل النظام إنشاء الملف وطلب الطباعة أو التصدير، ولا يؤكد خروج الورق أو يتتبع طباعة الملف خارج التطبيق.</p>}
        <div className="flex-1 min-h-0 rounded-md border bg-muted overflow-hidden">
          {loading && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin me-2" /> جاري تحميل المعاينة…
            </div>
          )}
          {error && !loading && (
            <div className="flex h-full items-center justify-center text-destructive text-sm p-4 text-center">
              تعذر تحميل المعاينة: {error}
            </div>
          )}
          {blobUrl && !loading && !error && (
            <iframe
              ref={iframeRef}
              src={blobUrl}
              title={title}
              className="w-full h-full bg-white"
              data-testid="pdf-preview-iframe"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
