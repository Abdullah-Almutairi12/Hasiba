import { useState } from "react";
import { Printer, Loader2 } from "lucide-react";
import {
  getGetPosReceiptPdfUrl,
  getGetCreditNotePdfUrl,
  getGetRefundVoucherPdfUrl,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { downloadPdf, DownloadError } from "@/lib/download-file";

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
  id, url, filename, label, testId, size = "sm", variant = "outline",
}: {
  id: unknown; url: (id: number) => string; filename: string; label: string; testId?: string;
  size?: "sm" | "default"; variant?: "outline" | "ghost" | "default";
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!validId(id)) return null;
  const run = async () => {
    setBusy(true);
    try {
      await downloadPdf(url(id), filename);
    } catch (e) {
      const ref = e instanceof DownloadError ? e.diagnosticRef : "";
      toast({ title: e instanceof Error ? e.message : "تعذر إنشاء الملف", description: ref ? `مرجع: ${ref}` : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" size={size} variant={variant} onClick={run} disabled={busy} data-testid={testId}>
      {busy ? <Loader2 className="me-1 size-4 animate-spin" /> : <Printer className="me-1 size-4" />}
      {label}
    </Button>
  );
}
