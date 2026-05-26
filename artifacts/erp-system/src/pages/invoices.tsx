import React, { useRef, useState } from "react";
import {
  useListInvoices,
  useGetInvoiceStats,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRiyal } from "@/components/riyal";
import {
  FileText, UploadCloud, CheckCircle2, Clock, AlertTriangle, AlertCircle,
  Camera, Sparkles, Trash2, Plus, Loader2, ScanLine, Lock, Undo2, Printer,
} from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/use-permissions";
import { useVatEnabled } from "@/hooks/use-vat-status";
import { PdfPreviewSheet } from "@/components/pdf-preview-sheet";

type ExtractedItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Optional PO line linkage for 3-way match. */
  poLineId?: number | null;
};

type PoSuggestion = {
  id: number; reference: string; supplierId: number; supplierName: string;
  status: string; total: number; orderDate?: string | null; confidence: number;
};
type PoLine = {
  id: number; description: string; quantity: string;
  receivedQty: string; billedQty: string; unitPrice: string;
};
type PoDetail = PoSuggestion & { lines: PoLine[] };

type Extracted = {
  supplierName: string;
  supplierVatNumber: string | null;
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  subtotal: number;
  vat: number;
  total: number;
  items: ExtractedItem[];
  confidence: number;
  /** URL of the source photo persisted by /invoices/scan; carried into /from-scan. */
  fileUrl?: string | null;
};

const API_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

// Resize a File to <=1600px wide JPEG (data URI). Keeps OCR cost low and stays under 20mb.
async function resizeImage(file: File, maxDim = 1600, quality = 0.85): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to load image"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export default function Invoices() {
  const { canManageFinance } = usePermissions();
  const vatEnabled = useVatEnabled();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [scanOpen, setScanOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<{ id: number; number: string } | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<{ id: number; number: string } | null>(null);

  async function submitReverse() {
    if (!reverseTarget) return;
    if (reverseReason.trim().length < 3) {
      toast.error("الرجاء كتابة سبب القيد العكسي.");
      return;
    }
    try {
      setReversing(true);
      const res = await fetch(`${API_BASE}/invoices/${reverseTarget.id}/reverse`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reverseReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "فشل إنشاء القيد العكسي");
      toast.success("تم إنشاء قيد عكسي وتسجيل القيود المحاسبية.");
      setReverseTarget(null);
      setReverseReason("");
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل القيد العكسي");
    } finally {
      setReversing(false);
    }
  }
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [poSuggestions, setPoSuggestions] = useState<PoSuggestion[]>([]);
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);
  const [selectedPoDetail, setSelectedPoDetail] = useState<PoDetail | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: stats, isLoading: isLoadingStats } = useGetInvoiceStats();
  const { data: invoices, isLoading: isLoadingInvoices } = useListInvoices({
    status: statusFilter === "all" ? undefined : (statusFilter as any),
  });

  function resetScanner() {
    setImagePreview(null);
    setExtracted(null);
    setScanning(false);
    setCommitting(false);
    setPoSuggestions([]);
    setSelectedPoId(null);
    setSelectedPoDetail(null);
  }

  // Fetch open PO suggestions for the detected supplier so the user can
  // link this scanned invoice to a Purchase Order (3-way match). Passing
  // `amount` lets the backend rank by total-similarity and gives us a
  // confidence score per suggestion.
  async function loadPoSuggestions(supplierName: string, amount?: number) {
    if (!supplierName.trim()) {
      setPoSuggestions([]);
      void pickPo(null);
      return;
    }
    try {
      const qs = new URLSearchParams({ supplierName });
      if (amount != null && amount > 0) qs.set("amount", String(amount));
      const res = await fetch(
        `${API_BASE}/procurement/po-suggestions?${qs.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const data = await res.json();
      const list: PoSuggestion[] = Array.isArray(data) ? data : [];
      setPoSuggestions(list);
      // If a PO was previously selected but the new supplier has no
      // suggestions (or the previous selection is no longer offered),
      // clear the linkage to avoid stale UI state.
      if (list.length === 0) {
        void pickPo(null);
        return;
      }
      if (selectedPoId && !list.some((p) => p.id === selectedPoId)) {
        void pickPo(null);
      }
      // Auto-select the top match when the backend is highly confident
      // (>= 0.9). The user can still change it manually.
      const top = list[0];
      if (top && top.confidence >= 0.9) {
        void pickPo(top.id);
      }
    } catch { /* non-blocking */ }
  }

  async function pickPo(poId: number | null) {
    setSelectedPoId(poId);
    setSelectedPoDetail(null);
    if (!poId) {
      // Clearing the PO link must also drop per-line poLineId mappings
      // so the UI doesn't carry stale 3-way-match references that the
      // server would either ignore or reject on commit.
      setExtracted((prev) =>
        prev ? { ...prev, items: prev.items.map((it) => ({ ...it, poLineId: null })) } : prev,
      );
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/procurement/purchase-orders/${poId}`, { credentials: "include" });
      if (!res.ok) return;
      const data: PoDetail = await res.json();
      setSelectedPoDetail(data);
      // Best-effort auto-map by description (case-insensitive substring).
      // Use the functional setter so this works even when called right
      // after setExtracted (e.g. high-confidence auto-select on scan).
      setExtracted((prev) => {
        if (!prev) return prev;
        const items = prev.items.map((it) => {
          if (it.poLineId) return it;
          const match = data.lines.find((ln) => {
            const d = ln.description.toLowerCase();
            const q = it.description.toLowerCase().trim();
            return q && (d.includes(q) || q.includes(d));
          });
          return match ? { ...it, poLineId: match.id } : it;
        });
        return { ...prev, items };
      });
    } catch { /* non-blocking */ }
  }

  function openScanner() {
    resetScanner();
    setScanOpen(true);
  }

  async function handleFileSelected(file: File) {
    try {
      setScanning(true);
      setExtracted(null);
      const dataUri = await resizeImage(file);
      setImagePreview(dataUri);
      const res = await fetch(`${API_BASE}/invoices/scan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUri }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `فشل المسح (${res.status})`);
      }
      const data: Extracted = await res.json();
      setExtracted(data);
      toast.success(`تم استخراج البيانات (ثقة ${Math.round(data.confidence * 100)}%)`);
      void loadPoSuggestions(data.supplierName, data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل تحليل الفاتورة");
    } finally {
      setScanning(false);
    }
  }

  async function handleCommit() {
    if (!extracted) return;
    if (!extracted.supplierName.trim() || !extracted.invoiceNumber.trim() || extracted.total <= 0) {
      toast.error("الرجاء استكمال اسم المورد ورقم الفاتورة والإجمالي");
      return;
    }
    try {
      setCommitting(true);
      const res = await fetch(`${API_BASE}/invoices/from-scan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName: extracted.supplierName,
          supplierVatNumber: extracted.supplierVatNumber,
          invoiceNumber: extracted.invoiceNumber,
          invoiceDate: extracted.invoiceDate,
          dueDate: extracted.dueDate,
          subtotal: extracted.subtotal,
          vat: extracted.vat,
          total: extracted.total,
          confidence: extracted.confidence,
          items: extracted.items.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            total: it.total,
            poLineId: it.poLineId ?? null,
          })),
          fileUrl: extracted.fileUrl ?? null,
          // When linked to a PO, defer inventory effects to the GRN flow
          // (server posts to GR-IR clearing instead of debiting Inventory).
          addToInventory: !selectedPoId,
          postToAccounting: true,
          poId: selectedPoId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "فشل حفظ الفاتورة");

      const matched = data.inventoryUpdates?.length ?? 0;
      const created = data.newProducts?.length ?? 0;
      const journals = data.journalEntryIds?.length ?? 0;
      toast.success(
        `تم حفظ الفاتورة. ${matched} منتج محدّث، ${created} منتج جديد، ${journals} قيد محاسبي.`,
      );
      await qc.invalidateQueries();
      setScanOpen(false);
      resetScanner();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حفظ الفاتورة");
    } finally {
      setCommitting(false);
    }
  }

  function updateItem(idx: number, patch: Partial<ExtractedItem>) {
    if (!extracted) return;
    const items = [...extracted.items];
    items[idx] = { ...items[idx]!, ...patch };
    setExtracted({ ...extracted, items });
  }
  function removeItem(idx: number) {
    if (!extracted) return;
    setExtracted({ ...extracted, items: extracted.items.filter((_, i) => i !== idx) });
  }
  function addItem() {
    if (!extracted) return;
    setExtracted({
      ...extracted,
      items: [...extracted.items, { description: "", quantity: 1, unitPrice: 0, total: 0 }],
    });
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "done":
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-none"><CheckCircle2 className="size-3 mr-1" /> مكتمل</Badge>;
      case "processing":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-none"><Clock className="size-3 mr-1" /> قيد المعالجة</Badge>;
      case "needs_review":
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200"><AlertTriangle className="size-3 mr-1" /> يحتاج مراجعة</Badge>;
      case "failed":
        return <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100 border-none"><AlertCircle className="size-3 mr-1" /> فشل</Badge>;
      default:
        return <Badge variant="outline">معلق</Badge>;
    }
  };

  const fmt = (n: number) =>
    formatRiyal(n);

  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">فواتير الموردين (AI)</h1>
          <p className="text-muted-foreground">استخراج بيانات الفواتير تلقائياً وإضافتها للمخزون والمحاسبة</p>
        </div>
        <Button size="lg" onClick={openScanner} className="gap-2 shadow-md" data-testid="button-open-scanner">
          <Sparkles className="size-4" /> تصوير فاتورة جديدة
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">فواتير اليوم</p>
              <FileText className="size-4 text-muted-foreground" />
            </div>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{stats?.todayCount || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">قيد المعالجة</p>
              <Clock className="size-4 text-blue-500" />
            </div>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{stats?.processingCount || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">تحتاج مراجعة</p>
              <AlertTriangle className="size-4 text-yellow-500" />
            </div>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{stats?.needsReviewCount || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">نسبة الدقة (AI)</p>
              <CheckCircle2 className="size-4 text-green-500" />
            </div>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold text-green-600">{stats?.accuracyRate || 0}%</div>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card
          className="md:col-span-1 border-dashed border-2 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
          onClick={openScanner}
          data-testid="card-upload-zone"
        >
          <CardContent className="p-10 flex flex-col items-center justify-center text-center h-full min-h-[300px]">
            <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <ScanLine className="size-8 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-1">صوّر أو ارفع فاتورة</h3>
            <p className="text-sm text-muted-foreground mb-4">سيقوم الوكيل الذكي بقراءتها وإضافة بنودها للمخزون والمحاسبة</p>
            <Button className="gap-2"><Camera className="size-4" /> ابدأ الآن</Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
            <CardTitle>أحدث الفواتير</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant={statusFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("all")}>الكل</Button>
              <Button variant={statusFilter === "needs_review" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("needs_review")}>للمراجعة</Button>
              <Button variant={statusFilter === "processing" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("processing")}>قيد المعالجة</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-16">صورة</TableHead>
                  <TableHead>رقم الفاتورة</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead className="text-center">الدقة</TableHead>
                  <TableHead className="text-left">الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingInvoices ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-10 w-10 rounded" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                      <TableCell className="text-left"><Skeleton className="h-6 w-24 ml-auto rounded-full" /></TableCell>
                    </TableRow>
                  ))
                ) : invoices?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">لا توجد فواتير</TableCell>
                  </TableRow>
                ) : (
                  invoices?.map((invoice) => (
                    <TableRow key={invoice.id} data-testid={`row-invoice-${invoice.id}`}>
                      <TableCell>
                        {invoice.fileUrl ? (
                          <a
                            href={invoice.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block size-10 rounded overflow-hidden border hover:ring-2 hover:ring-primary transition"
                            data-testid={`thumb-invoice-${invoice.id}`}
                          >
                            <img src={invoice.fileUrl} alt="فاتورة" className="size-full object-cover" />
                          </a>
                        ) : (
                          <div className="size-10 rounded border border-dashed flex items-center justify-center text-muted-foreground">
                            <FileText className="size-4" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{invoice.invoiceNumber || '---'}</TableCell>
                      <TableCell className="font-medium">{invoice.supplierName || 'جاري الاستخراج...'}</TableCell>
                      <TableCell className="font-semibold">
                        {invoice.amount ? fmt(Number(invoice.amount)) : '---'}
                      </TableCell>
                      <TableCell className="text-center">
                        {invoice.confidence != null ? (
                          (() => {
                            const pct = invoice.confidence > 1 ? invoice.confidence : invoice.confidence * 100;
                            return (
                              <span className={pct > 90 ? "text-green-600" : pct > 70 ? "text-yellow-600" : "text-red-600"}>
                                {Math.round(pct)}%
                              </span>
                            );
                          })()
                        ) : '---'}
                      </TableCell>
                      <TableCell className="text-left">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {getStatusBadge(invoice.status)}
                          {(invoice as { isLocked?: boolean }).isLocked && !(invoice as { reversedById?: number | null }).reversedById && !(invoice as { reversesId?: number | null }).reversesId && (
                            <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300 gap-1" data-testid={`badge-locked-${invoice.id}`}>
                              <Lock className="size-3" /> مقفلة
                            </Badge>
                          )}
                          {(invoice as { reversedById?: number | null }).reversedById && (
                            <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300" data-testid={`badge-reversed-${invoice.id}`}>
                              ملغاة بقيد عكسي
                            </Badge>
                          )}
                          {(invoice as { reversesId?: number | null }).reversesId && (
                            <Badge variant="outline" className="bg-purple-50 text-purple-800 border-purple-300">
                              قيد عكسي
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-left">
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            data-testid={`button-print-${invoice.id}`}
                            onClick={() => setPreviewTarget({ id: invoice.id, number: invoice.invoiceNumber || `#${invoice.id}` })}
                          >
                            <Printer className="size-3.5" /> طباعة
                          </Button>
                          {canManageFinance
                            && (invoice as { isLocked?: boolean }).isLocked
                            && !(invoice as { reversedById?: number | null }).reversedById
                            && !(invoice as { reversesId?: number | null }).reversesId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              data-testid={`button-reverse-${invoice.id}`}
                              onClick={() => {
                                setReverseTarget({ id: invoice.id, number: invoice.invoiceNumber });
                                setReverseReason("");
                              }}
                            >
                              <Undo2 className="size-3.5" /> قيد عكسي
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ====== Scanner Dialog ====== */}
      <Dialog open={scanOpen} onOpenChange={(o) => { if (!o) resetScanner(); setScanOpen(o); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-scanner">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" /> الوكيل الذكي لمسح فواتير الموردين
            </DialogTitle>
            <DialogDescription>
              صوّر الفاتورة بالكاميرا أو ارفع صورة، وسيقوم الوكيل بقراءتها واقتراح إضافة بنودها للمخزون وقيد محاسبي مزدوج.
            </DialogDescription>
          </DialogHeader>

          {/* Step 1: Choose source */}
          {!imagePreview && !scanning && (
            <div className="grid gap-4 md:grid-cols-2 py-4">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-3 hover:bg-muted/50 transition-colors"
                data-testid="button-take-photo"
              >
                <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <Camera className="size-7 text-primary" />
                </div>
                <div className="text-base font-semibold">التقاط صورة بالكاميرا</div>
                <div className="text-sm text-muted-foreground">صوّر الفاتورة الآن</div>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-3 hover:bg-muted/50 transition-colors"
                data-testid="button-upload-photo"
              >
                <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <UploadCloud className="size-7 text-primary" />
                </div>
                <div className="text-base font-semibold">رفع صورة من الجهاز</div>
                <div className="text-sm text-muted-foreground">JPG / PNG حتى 10 ميجا</div>
              </button>
            </div>
          )}

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            data-testid="input-camera"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelected(f);
              e.target.value = "";
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="input-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelected(f);
              e.target.value = "";
            }}
          />

          {/* Step 2: Loading */}
          {scanning && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
              {imagePreview && (
                <img src={imagePreview} alt="preview" className="max-h-48 rounded-md border opacity-70" />
              )}
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="font-medium">الوكيل يقرأ الفاتورة الآن…</p>
              <p className="text-sm text-muted-foreground">قد يستغرق ذلك بضع ثوان</p>
            </div>
          )}

          {/* Step 3: Review extracted data */}
          {extracted && !scanning && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-primary/5 border border-primary/20">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-green-600" />
                  <span>تم الاستخراج بثقة</span>
                  <span className="font-bold text-primary">{Math.round(extracted.confidence * 100)}%</span>
                </div>
                {imagePreview && (
                  <a href={imagePreview} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                    عرض الصورة الأصلية
                  </a>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>اسم المورد</Label>
                  <Input
                    value={extracted.supplierName}
                    onChange={(e) => setExtracted({ ...extracted, supplierName: e.target.value })}
                    onBlur={(e) => loadPoSuggestions(e.target.value, extracted.total)}
                    data-testid="input-supplier-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>رقم الفاتورة</Label>
                  <Input
                    value={extracted.invoiceNumber}
                    onChange={(e) => setExtracted({ ...extracted, invoiceNumber: e.target.value })}
                    data-testid="input-invoice-number"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>تاريخ الفاتورة</Label>
                  <Input
                    type="date"
                    value={extracted.invoiceDate ?? ""}
                    onChange={(e) => setExtracted({ ...extracted, invoiceDate: e.target.value || null })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>تاريخ الاستحقاق</Label>
                  <Input
                    type="date"
                    value={extracted.dueDate ?? ""}
                    onChange={(e) => setExtracted({ ...extracted, dueDate: e.target.value || null })}
                  />
                </div>
              </div>

              {/* PO matching (3-way): link the scanned invoice to an open PO so the
                  server validates received-but-unbilled quantities and price tolerance.
                  Suggestions are ranked by amount-similarity; high-confidence matches
                  (>= 0.9) are auto-selected when suggestions load. */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm">ربط بأمر شراء (مطابقة ثلاثية)</Label>
                  {selectedPoId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => pickPo(null)}
                      data-testid="button-clear-po"
                    >
                      إلغاء الربط
                    </Button>
                  )}
                </div>

                {poSuggestions.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    لا توجد أوامر شراء مفتوحة لهذا المورد. سيُضاف للمخزون مباشرة.
                  </div>
                )}

                {poSuggestions.length > 0 && (
                  <div className="grid gap-2">
                    {poSuggestions.map((p) => {
                      const pct = Math.round(p.confidence * 100);
                      const isSelected = selectedPoId === p.id;
                      const tone =
                        p.confidence >= 0.9
                          ? "bg-green-100 text-green-800 border-green-200"
                          : p.confidence >= 0.7
                          ? "bg-yellow-100 text-yellow-800 border-yellow-200"
                          : "bg-muted text-muted-foreground";
                      return (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => pickPo(isSelected ? null : p.id)}
                          className={
                            "flex items-center justify-between gap-3 text-right border rounded-md px-3 py-2 transition-colors " +
                            (isSelected
                              ? "border-primary bg-primary/10"
                              : "bg-background hover:bg-muted/50")
                          }
                          data-testid={`suggest-po-${p.id}`}
                        >
                          <div className="flex flex-col items-start gap-0.5">
                            <div className="font-medium text-sm">{p.reference}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.supplierName} • {formatRiyal(Number(p.total))} •{" "}
                              {p.status === "fully_received"
                                ? "مستلم بالكامل"
                                : p.status === "partially_received"
                                ? "مستلم جزئياً"
                                : "مؤكد"}
                            </div>
                          </div>
                          <Badge className={`border ${tone} text-xs whitespace-nowrap`}>
                            ثقة {pct}%
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedPoId && !selectedPoDetail && (
                  <div className="text-xs text-muted-foreground">جارٍ تحميل بنود أمر الشراء…</div>
                )}
                {selectedPoDetail && (
                  <div className="text-xs text-muted-foreground">
                    تم تحميل {selectedPoDetail.lines.length} بنداً من {selectedPoDetail.reference}. اختر سطر أمر الشراء لكل بند أدناه.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>البنود</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addItem} className="gap-1">
                    <Plus className="size-3.5" /> إضافة بند
                  </Button>
                </div>
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>الوصف</TableHead>
                        <TableHead className="w-20">الكمية</TableHead>
                        <TableHead className="w-28">سعر الوحدة</TableHead>
                        <TableHead className="w-28">الإجمالي</TableHead>
                        {selectedPoDetail && <TableHead className="w-44">سطر أمر الشراء</TableHead>}
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {extracted.items.length === 0 && (
                        <TableRow><TableCell colSpan={selectedPoDetail ? 6 : 5} className="text-center text-sm text-muted-foreground py-6">لا توجد بنود</TableCell></TableRow>
                      )}
                      {extracted.items.map((it, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Input value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} className="h-8" />
                          </TableCell>
                          <TableCell>
                            <Input type="number" min={0} value={it.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })} className="h-8" />
                          </TableCell>
                          <TableCell>
                            <Input type="number" min={0} step="0.01" value={it.unitPrice} onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) || 0 })} className="h-8" />
                          </TableCell>
                          <TableCell>
                            <Input type="number" min={0} step="0.01" value={it.total} onChange={(e) => updateItem(idx, { total: Number(e.target.value) || 0 })} className="h-8" />
                          </TableCell>
                          {selectedPoDetail && (
                            <TableCell>
                              <select
                                className="border rounded h-8 px-1 text-xs bg-background w-full"
                                value={it.poLineId ?? ""}
                                onChange={(e) => updateItem(idx, { poLineId: e.target.value ? Number(e.target.value) : null })}
                                data-testid={`select-po-line-${idx}`}
                              >
                                <option value="">— لا ربط —</option>
                                {selectedPoDetail.lines.map((ln) => {
                                  const remaining = Number(ln.receivedQty) - Number(ln.billedQty);
                                  return (
                                    <option key={ln.id} value={ln.id} disabled={remaining <= 0}>
                                      {ln.description.slice(0, 40)} • متاح للفوترة {remaining}
                                    </option>
                                  );
                                })}
                              </select>
                            </TableCell>
                          )}
                          <TableCell>
                            <Button type="button" size="icon" variant="ghost" onClick={() => removeItem(idx)}>
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className={`grid ${vatEnabled ? "grid-cols-3" : "grid-cols-2"} gap-3`}>
                <div className="space-y-1.5">
                  <Label>المجموع الفرعي</Label>
                  <Input type="number" step="0.01" value={extracted.subtotal} onChange={(e) => setExtracted({ ...extracted, subtotal: Number(e.target.value) || 0 })} />
                </div>
                {vatEnabled && (
                  <div className="space-y-1.5">
                    <Label>ضريبة القيمة المضافة</Label>
                    <Input type="number" step="0.01" value={extracted.vat} onChange={(e) => setExtracted({ ...extracted, vat: Number(e.target.value) || 0 })} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>الإجمالي</Label>
                  <Input type="number" step="0.01" value={extracted.total} onChange={(e) => setExtracted({ ...extracted, total: Number(e.target.value) || 0 })} data-testid="input-total" />
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex-row gap-2 justify-between sm:justify-between">
            <Button variant="ghost" onClick={() => { setScanOpen(false); resetScanner(); }} disabled={committing}>
              إلغاء
            </Button>
            {extracted && !scanning && (
              <Button onClick={handleCommit} disabled={committing} className="gap-2" data-testid="button-commit">
                {committing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                حفظ وإضافة للمخزون والمحاسبة
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reverseTarget} onOpenChange={(o) => { if (!o) { setReverseTarget(null); setReverseReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إنشاء قيد عكسي</DialogTitle>
            <DialogDescription>
              سيتم إنشاء فاتورة مورد بقيمة سالبة مرتبطة بالفاتورة {reverseTarget?.number} مع قيد محاسبي عكسي. لا يمكن التراجع عن هذه العملية.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reverse-reason">سبب القيد العكسي</Label>
            <Textarea
              id="reverse-reason"
              data-testid="input-reverse-reason"
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              rows={3}
              placeholder="مثلاً: خطأ في إدخال المبلغ، إرجاع كامل للمورد..."
            />
          </div>
          <DialogFooter className="flex-row gap-2 justify-between sm:justify-between">
            <Button variant="ghost" onClick={() => { setReverseTarget(null); setReverseReason(""); }} disabled={reversing}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={submitReverse}
              disabled={reversing || reverseReason.trim().length < 3}
              data-testid="button-confirm-reverse"
              className="gap-2"
            >
              {reversing ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
              تأكيد القيد العكسي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PdfPreviewSheet
        open={!!previewTarget}
        onOpenChange={(o) => { if (!o) setPreviewTarget(null); }}
        pdfUrl={previewTarget ? `${API_BASE}/invoices/${previewTarget.id}/pdf` : null}
        title={previewTarget ? `فاتورة ${previewTarget.number}` : "معاينة الفاتورة"}
        downloadName={previewTarget ? `${previewTarget.number}.pdf` : "invoice.pdf"}
      />
    </div>
  );
}
