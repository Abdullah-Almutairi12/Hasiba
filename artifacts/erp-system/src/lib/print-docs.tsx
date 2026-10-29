import { useEffect, useState, useRef, type MouseEvent } from "react";
import { Printer, Loader2, Download, ExternalLink } from "lucide-react";
import {
  getGetPosReceiptPdfUrl,
  getGetCreditNotePdfUrl,
  getGetRefundVoucherPdfUrl,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { fetchPdf, DownloadError } from "@/lib/download-file";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Prefix a generated `/api/...` URL with the artifact base path. */
export function withBase(apiPath: string): string {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  return `${base}${apiPath}`;
}

const validId = (id: unknown): id is number => typeof id === "number" && Number.isInteger(id) && id > 0;

export const docUrls = {
  receipt: (id: number, width?: 58 | 80) => withBase(getGetPosReceiptPdfUrl(id, width ? { width } : undefined)),
  creditNote: (id: number) => withBase(getGetCreditNotePdfUrl(id)),
  refund: (id: number) => withBase(getGetRefundVoucherPdfUrl(id)),
  closing: (id: number) => withBase(`/api/pos/sessions/${id}/closing.pdf`),
};

/** Only the widths the server accepts AND the company saved. */
export function configuredWidths(widths: unknown): Array<58 | 80> {
  if (!Array.isArray(widths)) return [];
  const out = widths.filter((w): w is 58 | 80 => w === 58 || w === 80);
  return Array.from(new Set(out)).sort((a, b) => b - a);
}

export const STATUS_AR: Record<string, string> = {
  paid: "مدفوع", partially_paid: "مدفوع جزئيًا", unpaid: "غير مدفوع",
  requested: "مطلوب — لم يُرسل لأي مزود", confirmed: "مؤكد", posted: "مُرحّل",
};

export function fmtDate(v: unknown): string {
  if (typeof v !== "string" && typeof v !== "number") return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ar-SA-u-nu-latn", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function PrintDocButton({
  id, url, filename, label, testId, size = "sm", variant = "outline",allowPrint=true,allowDownload=true,
}: {
  id: unknown; url: (id: number) => string; filename: string; label: string; testId?: string;
  size?: "sm" | "default"; variant?: "outline" | "ghost" | "default";
  allowPrint?:boolean;allowDownload?:boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<{ href: string; filename: string } | null>(null);
  const eventIds=useRef<Record<string,string>>({});
  const tracked=validId(id)&&/\/pos\/orders\/\d+\/receipt\.pdf/.test(url(id));
  async function requestOutput(event:MouseEvent<HTMLAnchorElement>,action:"print_requested"|"export_requested"){
    if((action==="print_requested"&&!allowPrint)||(action==="export_requested"&&!allowDownload)){event.preventDefault();return;}
    if(!tracked||!validId(id))return;
    event.preventDefault();
    if(busy)return;
    setBusy(true);
    try{
      const base=url(id),key=`${base}|${action}`,eventId=eventIds.current[key]??(eventIds.current[key]=crypto.randomUUID());
      const file=await fetchPdf(`${base}${base.includes("?")?"&":"?"}intent=${action}&eventId=${eventId}`,filename);
      if(!file)return;
      const href=URL.createObjectURL(file.blob);
      const link=document.createElement("a");link.href=href;
      if(action==="export_requested")link.download=file.filename;
      else {link.target="_blank";link.rel="noopener noreferrer";}
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(href),60_000);
    }catch(e){toast({title:"تعذر تجهيز المستند؛ تحقق من الصلاحية الحالية",description:e instanceof Error?e.message:"أعد المحاولة بنفس الطلب",variant:"destructive"});}
    finally{setBusy(false);}
  }
  // This component owns the blob URL: revoke when replaced, closed or unmounted.
  useEffect(() => () => { if (ready) URL.revokeObjectURL(ready.href); }, [ready]);
  if (!validId(id)) return null;
  const run = async () => {
    setBusy(true);
    try {
      const original=url(id);
      const got = await fetchPdf(tracked&&!allowPrint&&allowDownload?
        `${original}${original.includes("?")?"&":"?"}intent=export_requested&eventId=${eventIds.current.preview??(eventIds.current.preview=crypto.randomUUID())}`:original, filename);
      if (got) setReady({ href: URL.createObjectURL(got.blob), filename: got.filename });
    } catch (e) {
      const ref = e instanceof DownloadError ? e.diagnosticRef : "";
      toast({ title: e instanceof Error ? e.message : "تعذر إنشاء الملف", description: ref ? `مرجع: ${ref}` : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
    <Button type="button" size={size} variant={variant} onClick={run} disabled={busy} data-testid={testId}>
      {busy ? <Loader2 className="me-1 size-4 animate-spin" /> : <Printer className="me-1 size-4" />}
      {label}
    </Button>
    <Dialog open={!!ready} onOpenChange={(o) => { if (!o) setReady(null); }}>
      <DialogContent data-testid={testId ? `${testId}-ready` : "print-doc-ready"}>
        <DialogHeader>
          <DialogTitle>الملف جاهز</DialogTitle>
          <DialogDescription>تم إنشاء {label} بنجاح ({ready?.filename}). اختر التنزيل أو الفتح للطباعة.</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-start">
          {ready && <>
            {allowDownload&&<Button asChild disabled={busy}><a href={ready.href} download={ready.filename} onClick={e=>void requestOutput(e,"export_requested")} data-testid="link-pdf-download"><Download className="me-1 size-4" />تنزيل PDF</a></Button>}
            {allowPrint&&<Button asChild variant="outline" disabled={busy}><a href={ready.href} target="_blank" rel="noopener" onClick={e=>void requestOutput(e,"print_requested")} data-testid="link-pdf-open"><ExternalLink className="me-1 size-4" />فتح PDF</a></Button>}
            {tracked&&<p className="text-xs text-muted-foreground">فتح الملف طلب للطباعة وليس تأكيدًا بخروج الورق؛ لا يتتبع النظام الطباعة خارج التطبيق.</p>}
          </>}
          <Button variant="ghost" onClick={() => setReady(null)} data-testid="button-pdf-ready-close">إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
