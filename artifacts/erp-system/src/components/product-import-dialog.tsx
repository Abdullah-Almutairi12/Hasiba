import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getListProductCategoriesQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RotateCcw, Search, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  importOptions,
  productImport,
  ProductImportError,
  type ImportCell,
  type ImportOptions,
  type ImportOutcome,
  type ImportPreview,
} from "@/lib/product-import-api";
import { clearIntentIfKey, intentStorageKey, readIntent, saveIntent, type StoredIntent } from "@/lib/durable-intent";

export const IMPORT_ENDPOINT = "/api/products/imports";
type CommitBody = { action: "commit"; token: string };
type Meta = { fileName: string; validRows: number };

const FIELD_LABELS: Record<string, string> = {
  nameAr: "الاسم العربي",
  name: "الاسم الإنجليزي",
  sku: "رمز SKU",
  categoryId: "رقم الفئة",
  price: "سعر البيع",
  costPrice: "سعر التكلفة",
  unit: "الوحدة",
  barcode: "الباركود",
};
const label = (f: string) => FIELD_LABELS[f] ?? f;

function errText(e: unknown, fallback: string) {
  if (e instanceof ProductImportError) return `${e.message} (رمز ${e.status})`;
  return e instanceof Error && e.message ? `${fallback}: ${e.message}` : fallback;
}

function newKey() {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `product-import:${rnd}`;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("تعذر قراءة الملف"));
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(file);
  });
}

function csvCell(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
}

export function buildTemplateCsv(options: ImportOptions): string {
  const cat = options.categories[0];
  const unit = options.units[0] ?? "";
  const sample: Record<string, string[]> = {
    nameAr: ["قهوة عربية محمصة 250غ", "تمر سكري فاخر 1كغ"],
    name: ["Arabic Roasted Coffee 250g", "Sukkari Dates 1kg"],
    sku: ["000417", "000418"],
    categoryId: [String(cat?.id ?? ""), String(cat?.id ?? "")],
    price: ["38.50", "64.75"],
    costPrice: ["24.10", "41.30"],
    unit: [unit, unit],
    barcode: ["06281234500017", ""],
  };
  const lines = [options.fields.map(csvCell).join(",")];
  for (let i = 0; i < 2; i++) lines.push(options.fields.map((f) => csvCell(sample[f]?.[i] ?? "")).join(","));
  return "\ufeff" + lines.join("\r\n");
}

function downloadTemplate(options: ImportOptions) {
  const blob = new Blob([buildTemplateCsv(options)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "hasiba-products-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

type Parsed = { fileName: string; headers: string[]; rows: ImportCell[][] };

export function ProductImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const companyId = user?.companyId ?? null;
  const storageKey = userId != null && companyId != null ? intentStorageKey(IMPORT_ENDPOINT, userId, companyId) : null;

  const optionsQuery = useQuery<ImportOptions, unknown>({
    queryKey: ["product-import-options", userId, companyId],
    queryFn: importOptions,
    enabled: open && storageKey != null,
    retry: false,
  });
  const options = optionsQuery.data;

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "parse" | "preview" | "commit" | "recover" | "close">(null);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<StoredIntent<CommitBody, Meta> | null | "unreadable">(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Every async request captures the scope it started in; responses that come
  // back after the user/company changed are ignored (their saved intent stays).
  const scopeRef = useRef<string | null>(storageKey);
  const genRef = useRef(0);

  useLayoutEffect(() => {
    if (scopeRef.current !== storageKey) {
      scopeRef.current = storageKey;
      genRef.current += 1;
      busyRef.current = false;
      setBusy(null);
      setParsed(null);
      setMapping({});
      setPreview(null);
      setOutcome(null);
      setError(null);
      setPending(null);
    }
    if (!open || !storageKey) return;
    setPending(readIntent<CommitBody, Meta>(storageKey, IMPORT_ENDPOINT));
  }, [open, storageKey]);
  const live = (sk: string | null) => scopeRef.current === sk;

  const blocked = pending !== null;

  const mappingIssues = useMemo(() => {
    if (!parsed || !options) return [];
    const issues: string[] = [];
    const used = new Map<string, number>();
    parsed.headers.forEach((h, i) => {
      const f = mapping[i];
      if (!f) issues.push(`العمود "${h || `#${i + 1}`}" غير مربوط بحقل مدعوم. احذفه من الملف ثم أعد رفعه.`);
      else used.set(f, (used.get(f) ?? 0) + 1);
    });
    for (const [f, n] of used) if (n > 1) issues.push(`الحقل "${label(f)}" مربوط بأكثر من عمود.`);
    for (const r of options.required) if (!used.has(r)) issues.push(`الحقل الإلزامي "${label(r)}" غير موجود في الملف.`);
    return issues;
  }, [parsed, mapping, options]);

  const guard = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const gen = genRef.current;
    setBusy(kind);
    try { await fn(); } finally {
      if (genRef.current === gen) { busyRef.current = false; setBusy(null); }
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file || blocked) return;
    const sk = storageKey;
    void guard("parse", async () => {
      setError(null);
      setPreview(null);
      setOutcome(null);
      setParsed(null);
      setMapping({});
      try {
        if (options && file.size > options.limits.bytes) throw new Error(`حجم الملف يتجاوز ${Math.round(options.limits.bytes / 1024)} كيلوبايت`);
        const base64 = await readBase64(file);
        const res = await productImport<{ headers: string[]; rows: ImportCell[][] }>({ action: "parse", fileName: file.name, base64 });
        if (!live(sk)) return;
        const guess: Record<number, string> = {};
        res.headers.forEach((h, i) => {
          const t = String(h ?? "").trim();
          const f = options?.fields.find((x) => x.toLowerCase() === t.toLowerCase() || label(x) === t);
          if (f) guess[i] = f;
        });
        setParsed({ fileName: file.name, headers: res.headers, rows: res.rows });
        setMapping(guess);
      } catch (e) {
        if (live(sk)) setError(errText(e, "تعذر قراءة الملف"));
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  const changeMapping = (col: number, field: string) => {
    if (blocked) return;
    setPreview(null);
    setMapping((m) => {
      const next = { ...m };
      if (field) next[col] = field; else delete next[col];
      return next;
    });
  };

  const runPreview = () => {
    if (!parsed || mappingIssues.length || blocked) return;
    const sk = storageKey;
    void guard("preview", async () => {
      setError(null);
      const map: Record<string, number> = {};
      for (const [col, f] of Object.entries(mapping)) map[f] = Number(col);
      try {
        const res = await productImport<ImportPreview>({ action: "preview", document: { headers: parsed.headers, rows: parsed.rows, mapping: map } });
        if (live(sk)) setPreview(res);
      } catch (e) {
        if (live(sk)) setError(errText(e, "تعذرت المعاينة"));
      }
    });
  };

  const finish = async (sk: string, stored: StoredIntent<CommitBody, Meta>, result: ImportOutcome) => {
    let cas: string;
    try { cas = clearIntentIfKey(sk, stored.key); } catch { cas = "error"; }
    if (cas === "error") {
      setError("تم تأكيد النتيجة من الخادم لكن تعذر تنظيف سجل المحاولة المحفوظ في المتصفح.");
      setPending(stored);
    } else if (cas === "newer") {
      setPending(readIntent<CommitBody, Meta>(sk, IMPORT_ENDPOINT));
    } else {
      setPending(null);
    }
    setOutcome(result);
    if (result.state === "completed") {
      setParsed(null);
      setMapping({});
      setPreview(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/api/products"] }),
        qc.invalidateQueries({ queryKey: ["/api/products/stats"] }),
        qc.invalidateQueries({ queryKey: getListProductCategoriesQueryKey() }),
      ]);
    }
  };

  const send = async (sk: string, stored: StoredIntent<CommitBody, Meta>, action: "commit" | "recover" | "close") => {
    setError(null);
    try {
      const result = await productImport<ImportOutcome>({ action, token: stored.body.token }, stored.key);
      if (!live(sk)) return;
      if ((result.state !== "completed" && result.state !== "closed") ||
        (action === "commit" && result.state !== "completed")) {
        setError("لم يؤكد الخادم اكتمال الاستيراد. المحاولة الأصلية محفوظة.");
        return;
      }
      await finish(sk, stored, result);
    } catch (e) {
      if (!live(sk)) return;
      setError(
        `${errText(e, "تعذر الاتصال بالخادم")}. هذا لا يثبت أن الاستيراد لم يُنفذ؛ المحاولة الأصلية محفوظة. أعد المحاولة أو استعلم أو أغلقها بأمان.`,
      );
      setPending(stored);
    }
  };

  const commit = () => {
    if (!preview?.canCommit || !preview.token || blocked) return;
    const token = preview.token;
    const sk = storageKey;
    void guard("commit", async () => {
      setError(null);
      if (!sk) { setError("تعذر تحديد المستخدم أو الشركة الحالية؛ لم يُرسل شيء."); return; }
      const existing = readIntent<CommitBody, Meta>(sk, IMPORT_ENDPOINT);
      if (existing !== null) {
        setPending(existing);
        setError("توجد محاولة استيراد محفوظة لم تُحسم بعد؛ لم يُرسل شيء. احسمها أولاً.");
        return;
      }
      const stored: StoredIntent<CommitBody, Meta> = {
        v: 1,
        key: newKey(),
        endpoint: IMPORT_ENDPOINT,
        body: { action: "commit", token },
        responsibility: null,
        createdAt: new Date().toISOString(),
        meta: { fileName: parsed?.fileName ?? "", validRows: preview.validRows },
      };
      try {
        saveIntent(sk, stored);
        const back = readIntent<CommitBody, Meta>(sk, IMPORT_ENDPOINT);
        if (!back || back === "unreadable" || back.key !== stored.key) throw new Error("verify");
      } catch {
        setError("تعذر حفظ سجل المحاولة في المتصفح، لذلك لم يُرسل الاستيراد. فعّل التخزين المؤقت للجلسة ثم أعد المحاولة.");
        return;
      }
      setPending(stored);
      await send(sk, stored, "commit");
    });
  };

  const pendingAction = (action: "commit" | "recover" | "close") => {
    if (!pending || pending === "unreadable") return;
    const stored = pending;
    const sk = storageKey;
    if (!sk) return;
    void guard(action, () => send(sk, stored, action));
  };

  const reset = () => {
    setOutcome(null);
    setError(null);
  };

  const denied = optionsQuery.error instanceof ProductImportError && optionsQuery.error.status === 403;
  const previewRows = preview?.products.slice(0, 8) ?? [];
  const errorsByRow = useMemo(() => {
    const m = new Map<number, string[]>();
    preview?.errors.forEach((e) => m.set(e.row, [...(m.get(e.row) ?? []), `${label(e.field)}: ${e.message}`]));
    return m;
  }, [preview]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-4xl w-[calc(100vw-1rem)] max-h-[92dvh] overflow-y-auto p-4 sm:p-6" data-testid="dialog-product-import">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-primary" /> استيراد منتجات جديدة من CSV / XLSX
          </DialogTitle>
          <DialogDescription>
            ثلاث خطوات: ارفع الملف، اربط كل عمود بحقل، راجع المعاينة ثم أكّد. لا يُحفظ أي منتج قبل التأكيد.
          </DialogDescription>
        </DialogHeader>

        {storageKey && (pending !== null || error || outcome) && (
          <div className="space-y-4 mb-4">
            {pending === "unreadable" && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="status-intent-unreadable">
                يوجد سجل محاولة استيراد سابقة لا يمكن قراءته. لن نحذفه ولن نسمح باستيراد جديد حتى لا يتكرر التنفيذ. تواصل مع الدعم أو راجع قائمة المنتجات.
              </div>
            )}

            {pending && pending !== "unreadable" && (
              <section className="rounded-lg border-2 border-amber-500/50 bg-amber-500/5 p-4 space-y-3" data-testid="panel-pending-import">
                <div className="flex gap-3">
                  <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-sm space-y-1">
                    <p className="font-semibold">محاولة استيراد غير مؤكدة</p>
                    <p className="text-muted-foreground">
                      أُرسل تأكيد استيراد {pending.meta?.validRows ?? "?"} منتج
                      {pending.meta?.fileName ? ` من "${pending.meta.fileName}"` : ""} ولم تصلنا نتيجة مؤكدة. قد يكون نُفذ. لا يمكن تغيير الملف أو الربط حتى تُحسم.
                    </p>
                    <p className="font-mono text-xs text-muted-foreground break-all" data-testid="text-pending-key">{pending.key}</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                  <Button size="sm" className="gap-2" disabled={!!busy} onClick={() => pendingAction("commit")} data-testid="button-retry-original">
                    <RotateCcw className="size-4" /> {busy === "commit" ? "جارٍ الإرسال..." : "إعادة إرسال المحاولة الأصلية"}
                  </Button>
                  <Button size="sm" variant="outline" className="gap-2" disabled={!!busy} onClick={() => pendingAction("recover")} data-testid="button-recover-only">
                    <Search className="size-4" /> {busy === "recover" ? "جارٍ الاستعلام..." : "استعلام عن النتيجة فقط"}
                  </Button>
                  <Button size="sm" variant="outline" className="gap-2" disabled={!!busy} onClick={() => pendingAction("close")} data-testid="button-safe-close">
                    <ShieldCheck className="size-4" /> {busy === "close" ? "جارٍ الإغلاق..." : "إغلاق آمن للمحاولة"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">الإغلاق الآمن يعيد النتيجة إن كانت محفوظة، أو يمنع تنفيذها لاحقاً نهائياً.</p>
              </section>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="text-import-error">
                {error}
              </div>
            )}

            {outcome && (
              <section
                className={`rounded-lg border p-4 space-y-3 ${outcome.state === "completed" ? "border-emerald-500/40 bg-emerald-500/5" : "bg-muted/30"}`}
                data-testid={`status-import-${outcome.state}`}
              >
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="size-5 text-emerald-600" />
                  {outcome.state === "completed"
                    ? `اكتمل الاستيراد: ${outcome.accepted} منتج مقبول، ${outcome.rejected} مرفوض`
                    : "أُغلقت المحاولة دون تنفيذ. يمكنك تصحيح الملف والبدء من جديد."}
                </div>
                {outcome.products?.length ? (
                  <div className="max-h-48 overflow-y-auto rounded border bg-background">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50"><tr><th className="p-2 text-right">المعرّف</th><th className="p-2 text-right">SKU</th><th className="p-2 text-right">الاسم</th></tr></thead>
                      <tbody>
                        {outcome.products.map((p) => (
                          <tr key={p.id} className="border-t" data-testid={`row-imported-${p.id}`}>
                            <td className="p-2 font-mono">{p.id}</td>
                            <td className="p-2 font-mono" dir="ltr">{p.sku}</td>
                            <td className="p-2">{p.nameAr}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <Button size="sm" variant="outline" onClick={reset} data-testid="button-import-another">استيراد ملف آخر</Button>
              </section>
            )}

          </div>
        )}
        {!storageKey ? (
          <Skeleton className="h-24 w-full" />
        ) : optionsQuery.isLoading ? (
          <div className="space-y-3" data-testid="status-import-loading">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-10 w-1/2" />
          </div>
        ) : denied ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 flex gap-3" data-testid="status-import-denied">
            <ShieldAlert className="size-6 text-destructive shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">ليست لديك صلاحية استيراد المنتجات في هذه الشركة</p>
              <p className="text-sm text-muted-foreground">
                رفض الخادم الطلب لحسابك الحالي. اطلب من مالك الشركة أو المدير منحك صلاحية إدارة المنتجات، أو أضف المنتجات يدوياً إن كانت متاحة لك.
              </p>
            </div>
          </div>
        ) : optionsQuery.error || !options ? (
          <div className="rounded-lg border p-5 space-y-3" data-testid="status-import-options-error">
            <p className="text-sm">{errText(optionsQuery.error, "تعذر تحميل إعدادات الاستيراد")}</p>
            <Button variant="outline" size="sm" onClick={() => optionsQuery.refetch()} data-testid="button-retry-options">
              إعادة المحاولة
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="grid gap-3 md:grid-cols-[1.4fr_1fr] rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="space-y-1.5">
                <p className="font-semibold">قبل الرفع</p>
                <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
                  <li>منتجات جديدة فقط؛ لا يحدّث هذا الاستيراد أي منتج موجود.</li>
                  <li>في Excel نسّق عمودي SKU والباركود كنص قبل الكتابة، وإلا ستُحذف الأصفار البادئة.</li>
                  <li>ورقة عمل واحدة، حتى {options.limits.rows} صف و{Math.round(options.limits.bytes / 1024)} كيلوبايت و{options.limits.columns} عموداً و{options.limits.cellLength} حرفاً للخلية.</li>
                  <li>لا يدعم المخزون أو الضريبة أو التتبع أو المتغيرات. احذف أي عمود غير مدعوم من الملف.</li>
                </ul>
              </div>
              <div className="space-y-1.5" data-testid="text-import-defaults">
                <p className="font-semibold">القيم الافتراضية للمنتجات الجديدة</p>
                <p className="text-muted-foreground">
                  المخزون {options.defaults.stock}، الحد الأدنى {options.defaults.minStock}، التتبع {options.defaults.trackingMode}، التكلفة {options.defaults.costingMethod}.
                </p>
                <p className="text-muted-foreground">لا تُنشأ أي حركة مخزون أو قيد مالي. الاستيراد ذري: كل الصفوف أو لا شيء.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 mt-1"
                  disabled={!options.categories.length}
                  onClick={() => downloadTemplate(options)}
                  data-testid="button-download-template"
                >
                  <Download className="size-4" /> تنزيل قالب CSV
                </Button>
                {!options.categories.length && <p className="text-xs text-destructive">أنشئ فئة واحدة على الأقل أولاً.</p>}
              </div>
            </section>

            <details className="rounded-lg border p-3 text-sm" data-testid="panel-import-reference">
              <summary className="cursor-pointer font-semibold">مرجع القيم المسموحة: أرقام الفئات والوحدات</summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground mb-1">ضع رقم الفئة (categoryId) لا اسمها:</p>
                  {options.categories.length ? (
                    <ul className="max-h-36 overflow-y-auto rounded border divide-y">
                      {options.categories.map((c) => (
                        <li key={c.id} className="flex justify-between gap-2 px-2 py-1" data-testid={`text-ref-category-${c.id}`}>
                          <span className="truncate">{c.nameAr || c.name}</span>
                          <span className="font-mono shrink-0" dir="ltr">{c.id}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-destructive">لا توجد فئات بعد.</p>}
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">الوحدة (unit) يجب أن تطابق إحدى القيم حرفياً:</p>
                  <div className="flex flex-wrap gap-1" data-testid="list-ref-units">
                    {options.units.map((u) => <Badge key={u} variant="outline">{u}</Badge>)}
                  </div>
                </div>
              </div>
            </details>

            <section className="space-y-2">
              <p className="font-semibold text-sm">١. الملف</p>
              <label className={`flex items-center gap-3 rounded-lg border border-dashed p-4 ${blocked || busy ? "opacity-50" : "cursor-pointer hover:bg-muted/40"}`}>
                <Upload className="size-5 text-primary" />
                <span className="text-sm">{parsed ? parsed.fileName : "اختر ملف CSV أو XLSX"}</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  disabled={blocked || !!busy}
                  onChange={(e) => onFile(e.target.files?.[0])}
                  data-testid="input-import-file"
                />
              </label>
              {busy === "parse" && <Skeleton className="h-8 w-full" />}
            </section>

            {parsed && (
              <section className="space-y-2">
                <p className="font-semibold text-sm">٢. ربط الأعمدة ({parsed.rows.length} صف)</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {parsed.headers.map((h, i) => (
                    <div key={i} className="flex flex-col items-stretch gap-1 rounded-md border p-2 sm:flex-row sm:items-center sm:gap-2">
                      <span className="text-sm flex-1 truncate" title={h}>{h || `عمود ${i + 1}`}</span>
                      <select
                        className="h-9 w-full sm:w-auto min-w-0 rounded-md border bg-background px-2 text-sm"
                        value={mapping[i] ?? ""}
                        disabled={blocked || !!busy}
                        onChange={(e) => changeMapping(i, e.target.value)}
                        aria-label={`ربط العمود ${h}`}
                        data-testid={`select-map-${i}`}
                      >
                        <option value="">غير مربوط</option>
                        {options.fields.map((f) => (
                          <option key={f} value={f}>{label(f)}{options.required.includes(f) ? " *" : ""}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {mappingIssues.length > 0 && (
                  <ul className="text-sm text-destructive list-disc pr-5 space-y-0.5" data-testid="list-mapping-issues">
                    {mappingIssues.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                )}
                <Button
                  variant="outline"
                  disabled={mappingIssues.length > 0 || blocked || !!busy}
                  onClick={runPreview}
                  data-testid="button-import-preview"
                >
                  {busy === "preview" ? "جارٍ الفحص..." : "معاينة دون حفظ"}
                </Button>
              </section>
            )}

            {preview && (
              <section className="space-y-3" data-testid="panel-import-preview">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <p className="font-semibold">٣. المعاينة</p>
                  <span className="text-xs text-muted-foreground basis-full sm:basis-auto">أرقام الصفوف تعدّ السجلات بعد سطر العناوين؛ الخلية متعددة الأسطر في CSV تبقى سجلاً واحداً، فقد لا يطابق الرقم سطر المحرر النصي.</span>
                  <Badge variant="outline">الإجمالي {preview.total}</Badge>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">صالح {preview.validRows}</Badge>
                  <Badge variant="outline" className="border-destructive/40 text-destructive">أخطاء {preview.errors.length}</Badge>
                </div>
                {preview.errors.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded border p-2 text-sm space-y-1" data-testid="list-preview-errors">
                    {[...errorsByRow.entries()].map(([row, msgs]) => (
                      <li key={row}><span className="font-mono">صف {row}</span>: {msgs.join("، ")}</li>
                    ))}
                  </ul>
                )}
                {previewRows.length > 0 && (
                  <div className="overflow-x-auto rounded border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>{options.fields.map((f) => <th key={f} className="p-2 text-right whitespace-nowrap">{label(f)}</th>)}</tr>
                      </thead>
                      <tbody>
                        {previewRows.map((p, i) => (
                          <tr key={i} className="border-t">
                            {options.fields.map((f) => <td key={f} className="p-2 whitespace-nowrap">{p[f] == null ? "" : String(p[f])}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!preview.canCommit && <p className="text-sm text-muted-foreground">صحّح الأخطاء في الملف ثم أعد رفعه. لن يُستورد أي صف ما دام هناك خطأ.</p>}
                <Button
                  disabled={!preview.canCommit || !preview.token || blocked || !!busy}
                  onClick={commit}
                  data-testid="button-import-commit"
                >
                  {busy === "commit" ? "جارٍ الاستيراد..." : `تأكيد استيراد ${preview.validRows} منتج`}
                </Button>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
