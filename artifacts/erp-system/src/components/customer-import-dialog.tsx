import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RotateCcw, Search, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  currentResponsibility,
  CUSTOMER_FIELDS,
  CUSTOMER_IMPORT_PATH,
  customerImport,
  CustomerImportError,
  customerImportOptions,
  type CustomerCell,
  type CustomerImportOptions,
  type CustomerImportOutcome,
  type CustomerImportPreview,
  type CustomerMatch,
} from "@/lib/customer-import-api";
import { clearIntentIfKey, intentStorageKey, readIntent, saveIntent, type StoredIntent } from "@/lib/durable-intent";

export const CUSTOMER_IMPORT_ENDPOINT = CUSTOMER_IMPORT_PATH;
type CommitBody = { action: "commit"; token: string };
type Meta = { fileName: string; validRows: number };

export const customerIntentKey = (userId: number | string, companyId: number | string) =>
  intentStorageKey(CUSTOMER_IMPORT_ENDPOINT, userId, companyId);

/** True when a scoped saved customer-import intent (or unreadable evidence) exists. */
export function hasCustomerImportIntent(userId: number | string | null | undefined, companyId: number | string | null | undefined) {
  if (userId == null || companyId == null) return false;
  return readIntent(customerIntentKey(userId, companyId), CUSTOMER_IMPORT_ENDPOINT) !== null;
}

const FIELD_LABELS: Record<string, string> = {
  name: "اسم العميل",
  phone: "الهاتف",
  email: "البريد الإلكتروني",
  taxNumber: "الرقم الضريبي",
  billingAddress: "عنوان الفوترة",
  shippingAddress: "عنوان الشحن",
};
/** Natural Arabic/English headers accepted only as an initial guess for "name". */
const NAME_ALIASES = ["اسم المنشأة", "اسم الشركة", "الاسم", "اسم العميل", "company", "company name", "customer", "customer name"];
const label = (f: string) => FIELD_LABELS[f] ?? f;

/** Only fields the server returned are shown; absence is "not shown", never an inference. */
function matchText(m: CustomerMatch) {
  const parts = [`#${m.id}`];
  if (m.phone) parts.push(`الهاتف ${m.phone}`);
  if (m.email) parts.push(`البريد ${m.email}`);
  if (m.taxNumber) parts.push(`الرقم الضريبي ${m.taxNumber}`);
  return `${m.name} (${parts.join("، ")})`;
}

function errText(e: unknown, fallback: string) {
  if (e instanceof CustomerImportError) return `${e.message} (رمز ${e.status})`;
  return e instanceof Error && e.message ? `${fallback}: ${e.message}` : fallback;
}

function newKey() {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `customer-import:${rnd}`;
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

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function buildCustomerTemplateCsv(fields: readonly string[] = CUSTOMER_FIELDS): string {
  const sample: Record<string, string[]> = {
    name: ["مؤسسة واحة الجنوب التجارية", "سلمان عبدالعزيز القحطاني"],
    phone: ["0551240387", "0504418260"],
    email: ["purchasing@waha-south.sa", ""],
    taxNumber: ["300471256000003", ""],
    billingAddress: ["أبها، حي المنسك، طريق الملك فيصل", "الخبر، حي العقربية"],
    shippingAddress: ["خميس مشيط، المنطقة الصناعية الثانية", ""],
  };
  const lines = [fields.map(csvCell).join(",")];
  for (let i = 0; i < 2; i++) lines.push(fields.map((f) => csvCell(sample[f]?.[i] ?? "")).join(","));
  return "\ufeff" + lines.join("\r\n");
}

function downloadTemplate(fields: string[]) {
  const blob = new Blob([buildCustomerTemplateCsv(fields)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "hasiba-customers-template.csv";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Parsed = { fileName: string; headers: string[]; rows: CustomerCell[][] };

export function CustomerImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const companyId = user?.companyId ?? null;
  const storageKey = userId != null && companyId != null ? customerIntentKey(userId, companyId) : null;

  const optionsQuery = useQuery<CustomerImportOptions, unknown>({
    queryKey: ["customer-import-options", userId, companyId],
    queryFn: customerImportOptions,
    enabled: open && storageKey != null,
    retry: false,
  });
  const options = optionsQuery.data;

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<CustomerImportPreview | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [confirmSimilar, setConfirmSimilar] = useState(false);
  const [confirmGeneral, setConfirmGeneral] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "parse" | "preview" | "commit" | "recover" | "close">(null);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<StoredIntent<CommitBody, Meta> | null | "unreadable">(null);
  const [outcome, setOutcome] = useState<CustomerImportOutcome | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
      setConfirmSimilar(false); setConfirmGeneral(false);
      setOutcome(null);
      setError(null);
      setPending(null);
    }
    if (!open || !storageKey) return;
    setPending(readIntent<CommitBody, Meta>(storageKey, CUSTOMER_IMPORT_ENDPOINT));
  }, [open, storageKey]);
  const live = (sk: string | null) => scopeRef.current === sk;
  const blocked = pending !== null;

  const mappingIssues = useMemo(() => {
    if (!parsed || !options) return [];
    const issues: string[] = [];
    const used = new Map<string, number>();
    parsed.headers.forEach((h, i) => {
      const f = mapping[i];
      if (!f) issues.push(`العمود "${h || `#${i + 1}`}" غير مربوط بأحد الحقول الستة المدعومة. احذفه من الملف ثم أعد رفعه.`);
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
      setConfirmSimilar(false); setConfirmGeneral(false);
      try {
        if (options && file.size > options.limits.bytes) throw new Error(`حجم الملف يتجاوز ${Math.round(options.limits.bytes / 1024)} كيلوبايت`);
        const base64 = await readBase64(file);
        const res = await customerImport<{ headers: string[]; rows: CustomerCell[][] }>({ action: "parse", fileName: file.name, base64 });
        if (!live(sk)) return;
        const guess: Record<number, string> = {};
        res.headers.forEach((h, i) => {
          const t = String(h ?? "").trim();
          let f = options?.fields.find((x) => x.toLowerCase() === t.toLowerCase() || label(x) === t);
          if (!f && options?.fields.includes("name") && NAME_ALIASES.includes(t.toLowerCase())) f = "name";
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
    setConfirmSimilar(false); setConfirmGeneral(false);
    setMapping((m) => {
      const next = { ...m };
      if (field) next[col] = field; else delete next[col];
      return next;
    });
  };

  const runPreview = () => {
    if (!parsed || mappingIssues.length || blocked) return;
    const sk = storageKey;
    const confirm = confirmSimilar;
    void guard("preview", async () => {
      setError(null);
      const map: Record<string, number> = {};
      for (const [col, f] of Object.entries(mapping)) map[f] = Number(col);
      try {
        const res = await customerImport<CustomerImportPreview>({
          action: "preview",
          document: { headers: parsed.headers, rows: parsed.rows, mapping: map },
          confirmSimilarNames: confirm,
        });
        if (!live(sk)) return;
        setPreview(res);
        setPreviewConfirmed(confirm);
        setConfirmGeneral(false);
        if (!res.warnings.length) setConfirmSimilar(false);
      } catch (e) {
        if (live(sk)) setError(errText(e, "تعذرت المعاينة"));
      }
    });
  };

  const finish = async (sk: string, stored: StoredIntent<CommitBody, Meta>, result: CustomerImportOutcome) => {
    let cas: string;
    try { cas = clearIntentIfKey(sk, stored.key); } catch { cas = "error"; }
    if (cas === "error") {
      setError("أكد الخادم النتيجة لكن تعذر تنظيف سجل المحاولة المحفوظ في المتصفح.");
      setPending(stored);
    } else if (cas === "newer") {
      setPending(readIntent<CommitBody, Meta>(sk, CUSTOMER_IMPORT_ENDPOINT));
    } else {
      setPending(null);
    }
    setOutcome(result);
    if (result.state === "completed") {
      setParsed(null);
      setMapping({});
      setPreview(null);
      setConfirmSimilar(false); setConfirmGeneral(false);
      await qc.invalidateQueries({ queryKey: ["/api/customers"] });
    }
  };

  const send = async (sk: string, stored: StoredIntent<CommitBody, Meta>, action: "commit" | "recover" | "close") => {
    setError(null);
    try {
      const result = await customerImport<CustomerImportOutcome>({ action, token: stored.body.token }, stored.key, stored.responsibility);
      if (!live(sk)) return;
      if ((result.state !== "completed" && result.state !== "closed") ||
        (action === "commit" && result.state !== "completed")) {
        setError("لم يؤكد الخادم اكتمال الاستيراد. المحاولة الأصلية محفوظة.");
        setPending(stored);
        return;
      }
      await finish(sk, stored, result);
    } catch (e) {
      if (!live(sk)) return;
      setError(`${errText(e, "تعذر الاتصال بالخادم")}. هذا لا يثبت أن الاستيراد لم يُنفذ؛ المحاولة الأصلية محفوظة. أعد إرسالها أو استعلم عن النتيجة أو أغلقها بأمان.`);
      setPending(stored);
    }
  };

  const canCommit = !!preview?.canCommit && !!preview.token && confirmGeneral && (!preview.warnings.length || (confirmSimilar && previewConfirmed));

  const commit = () => {
    if (!preview || !canCommit || !preview.token || blocked) return;
    const token = preview.token;
    const sk = storageKey;
    void guard("commit", async () => {
      setError(null);
      if (!sk) { setError("تعذر تحديد المستخدم أو الشركة الحالية؛ لم يُرسل شيء."); return; }
      const existing = readIntent<CommitBody, Meta>(sk, CUSTOMER_IMPORT_ENDPOINT);
      if (existing !== null) {
        setPending(existing);
        setError("توجد محاولة استيراد محفوظة لم تُحسم بعد؛ لم يُرسل شيء. احسمها أولاً.");
        return;
      }
      const stored: StoredIntent<CommitBody, Meta> = {
        v: 1,
        key: newKey(),
        endpoint: CUSTOMER_IMPORT_ENDPOINT,
        body: { action: "commit", token },
        responsibility: currentResponsibility(),
        createdAt: new Date().toISOString(),
        meta: { fileName: parsed?.fileName ?? "", validRows: preview.validRows },
      };
      try {
        saveIntent(sk, stored);
        const back = readIntent<CommitBody, Meta>(sk, CUSTOMER_IMPORT_ENDPOINT);
        if (!back || back === "unreadable" || back.key !== stored.key) throw new Error("verify");
      } catch {
        setError("تعذر حفظ سجل المحاولة في المتصفح، لذلك لم يُرسل الاستيراد. فعّل تخزين الجلسة ثم أعد المحاولة.");
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

  const denied = optionsQuery.error instanceof CustomerImportError && optionsQuery.error.status === 403;
  const errorsByRow = useMemo(() => {
    const m = new Map<number, string[]>();
    preview?.errors.forEach((e) => m.set(e.row, [...(m.get(e.row) ?? []), `${label(e.field)}: ${e.message}`]));
    return m;
  }, [preview]);
  const fields = options?.fields ?? [...CUSTOMER_FIELDS];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-5xl w-[calc(100vw-1rem)] max-h-[92dvh] overflow-y-auto p-4 sm:p-6" data-testid="dialog-customer-import">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-primary" /> استيراد دليل عملاء جدد من CSV / XLSX
          </DialogTitle>
          <DialogDescription>
            ارفع الملف، اربط كل عمود بحقل، راجع كل الصفوف ثم أكّد. لا يُحفظ أي عميل قبل التأكيد.
          </DialogDescription>
        </DialogHeader>

        {storageKey && (pending !== null || error || outcome) && (
          <div className="space-y-4 mb-4">
            {pending === "unreadable" && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="status-intent-unreadable">
                يوجد سجل محاولة استيراد عملاء سابقة لا يمكن قراءته. لن نحذفه ولن نسمح باستيراد جديد حتى لا يتكرر التنفيذ. راجع قائمة العملاء أو تواصل مع الدعم.
              </div>
            )}

            {pending && pending !== "unreadable" && (
              <section className="rounded-lg border-2 border-amber-500/50 bg-amber-500/5 p-4 space-y-3" data-testid="panel-pending-import">
                <div className="flex gap-3">
                  <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-sm space-y-1">
                    <p className="font-semibold">محاولة استيراد عملاء غير مؤكدة</p>
                    <p className="text-muted-foreground">
                      أُرسل تأكيد استيراد {pending.meta?.validRows ?? "?"} عميل
                      {pending.meta?.fileName ? ` من "${pending.meta.fileName}"` : ""} ولم تصلنا نتيجة مؤكدة. قد يكون نُفذ. لا يمكن رفع ملف جديد أو تعديل الربط حتى تُحسم.
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
                    ? `اكتمل الاستيراد: ${outcome.accepted} عميل مقبول، ${outcome.rejected} مرفوض`
                    : "أُغلقت المحاولة دون تنفيذ. يمكنك تصحيح الملف والبدء من جديد."}
                </div>
                {outcome.customers?.length ? (
                  <div className="max-h-48 overflow-y-auto rounded border bg-background">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50"><tr><th className="p-2 text-right">المعرّف</th><th className="p-2 text-right">الاسم</th></tr></thead>
                      <tbody>
                        {outcome.customers.map((s) => (
                          <tr key={s.id} className="border-t" data-testid={`row-imported-${s.id}`}>
                            <td className="p-2 font-mono">{s.id}</td>
                            <td className="p-2">{s.name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {!blocked && (
                  <Button size="sm" variant="outline" onClick={() => { setOutcome(null); setError(null); }} data-testid="button-import-another">
                    استيراد ملف آخر
                  </Button>
                )}
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
              <p className="font-semibold">ليست لديك صلاحية إنشاء عملاء بالاستيراد في هذه الشركة أو المسؤولية الحالية</p>
              <p className="text-sm text-muted-foreground">
                رفض الخادم إنشاء استيراد جديد لحسابك. {blocked ? "ما زال بإمكانك الاستعلام عن المحاولة المحفوظة أو إغلاقها بأمان من الأعلى." : "اطلب من مالك الشركة أو المدير منحك صلاحية إنشاء العملاء."}
              </p>
            </div>
          </div>
        ) : optionsQuery.error || !options ? (
          <div className="rounded-lg border p-5 space-y-3" data-testid="status-import-options-error">
            <p className="text-sm">{errText(optionsQuery.error, "تعذر تحميل إعدادات الاستيراد")}</p>
            <Button variant="outline" size="sm" onClick={() => optionsQuery.refetch()} data-testid="button-retry-options">إعادة المحاولة</Button>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="grid gap-3 md:grid-cols-[1.4fr_1fr] rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="space-y-1.5">
                <p className="font-semibold">قبل الرفع</p>
                <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
                  <li>عملاء جدد فقط؛ لا يحدّث هذا الاستيراد أي عميل موجود ولا يدمج معه، ولا يغيّر العميل النقدي الافتراضي.</li>
                  <li>الحقول المدعومة ستة فقط: {fields.map(label).join("، ")}. الاسم إلزامي. لا يلزم رقم ضريبي أو هوية للأفراد. احذف أي عمود آخر (الرصيد الافتتاحي، الفواتير، التحصيلات، حد الائتمان، شروط الدفع، قوائم الأسعار، الشركة المرتبطة) من الملف.</li>
                  <li>نسّق عمودي الهاتف والرقم الضريبي كنص في Excel قبل الكتابة. الخلايا الرقمية تُرفض لأن Excel يحذف الصفر البادئ من الهاتف (مثل 05) ويقرّب الأرقام الطويلة كالرقم الضريبي ذي الخمسة عشر رقماً؛ تغيير التنسيق بعد الحذف لا يعيد الأرقام المفقودة، لذا أعد إدخالها من المصدر الأصلي.</li>
                  <li>ورقة عمل واحدة، حتى {options.limits.rows} صف و{Math.round(options.limits.bytes / 1024)} كيلوبايت و{options.limits.columns} عموداً و{options.limits.cellLength} حرفاً للخلية.</li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold">قالب جاهز</p>
                <p className="text-muted-foreground">
                  قالب CSV بترميز UTF-8 مع مثال عربي. لفتحه دون فقد الأصفار استخدم في Excel: بيانات ثم من نص/CSV، واختر نوع "نص" لعمودي الهاتف والرقم الضريبي، بدلاً من فتح الملف بالنقر المزدوج.
                </p>
                <p className="text-muted-foreground">الاستيراد ذري: كل الصفوف أو لا شيء.</p>
                <Button variant="outline" size="sm" className="gap-2 mt-1" onClick={() => downloadTemplate(fields)} data-testid="button-download-template">
                  <Download className="size-4" /> تنزيل قالب CSV
                </Button>
              </div>
            </section>

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
                <Button variant="outline" disabled={mappingIssues.length > 0 || blocked || !!busy} onClick={runPreview} data-testid="button-import-preview">
                  {busy === "preview" ? "جارٍ الفحص..." : "معاينة دون حفظ"}
                </Button>
              </section>
            )}

            {preview && (
              <section className="space-y-3" data-testid="panel-import-preview">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <p className="font-semibold">٣. المعاينة</p>
                  <span className="text-xs text-muted-foreground basis-full sm:basis-auto">العناوين في الصف 1؛ أول سجل في الصف 2. الأرقام موحدة مع الأخطاء والتحذيرات.</span>
                  <Badge variant="outline">الإجمالي {preview.total}</Badge>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">صالح {preview.validRows}</Badge>
                  <Badge variant="outline" className="border-destructive/40 text-destructive">أخطاء {preview.errors.length}</Badge>
                  <Badge variant="outline" className="border-amber-500/40 text-amber-700">تطابقات للمراجعة {preview.warnings.length}</Badge>
                </div>
                {preview.errors.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded border p-2 text-sm space-y-1" data-testid="list-preview-errors">
                    {[...errorsByRow.entries()].map(([row, msgs]) => (
                      <li key={row}><span className="font-mono">صف {row}</span>: {msgs.join("، ")}</li>
                    ))}
                  </ul>
                )}
                {preview.warnings.length > 0 && (
                  <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-3 space-y-2 text-sm" data-testid="panel-similar-warnings">
                    <p className="font-semibold">تطابقات مع عملاء موجودين أو صفوف أخرى في الملف</p>
                    <p className="text-muted-foreground">
                      تطابق الاسم أو الهاتف أو البريد أو الرقم الضريبي لا يثبت أنه العميل نفسه. ستُنشأ هذه الصفوف عملاء جدداً منفصلين دون دمج أو تحديث. إن كان العميل نفسه فاحذف الصف من الملف.
                    </p>
                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                      {preview.warnings.map((w) => (
                        <li key={w.row} data-testid={`text-warning-${w.row}`}>
                          <span className="font-mono">صف {w.row}</span> «{w.name}» يطابق:{" "}
                          {w.matches.map(matchText).join("، ")}
                        </li>
                      ))}
                    </ul>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={confirmSimilar}
                        disabled={blocked || !!busy}
                        onChange={(e) => {
                          if (blocked || busy) return;
                          setConfirmSimilar(e.target.checked);
                          setPreviewConfirmed(false);
                        }}
                        data-testid="checkbox-confirm-similar"
                      />
                      <span>راجعت هذه التطابقات وأؤكد إنشاء الصفوف عملاء جدداً منفصلين.</span>
                    </label>
                    {confirmSimilar !== previewConfirmed && (
                      <p className="text-xs text-amber-700" data-testid="text-repreview-needed">أعد المعاينة ليصدر الخادم تأكيداً مرتبطاً بهذه المطابقات بالضبط.</p>
                    )}
                    <Button size="sm" variant="outline" disabled={blocked || !!busy || confirmSimilar === previewConfirmed} onClick={runPreview} data-testid="button-repreview-confirm">
                      إعادة المعاينة مع التأكيد
                    </Button>
                  </div>
                )}
                {preview.previewRows.length > 0 && (
                  <div className="max-h-80 overflow-auto rounded border" data-testid="table-preview-customers">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr><th className="p-2 text-right">صف المصدر</th>{fields.map((f) => <th key={f} className="p-2 text-right whitespace-nowrap">{label(f)}</th>)}<th className="p-2 text-right">الحالة والأخطاء</th></tr>
                      </thead>
                      <tbody>
                        {preview.previewRows.map((r, i) => (
                          <tr key={r.row} className="border-t" data-testid={`row-preview-${i}`}>
                            <td className="p-2 font-mono text-muted-foreground">{r.row}</td>
                            {fields.map((f) => (
                              <td key={f} className="p-2 whitespace-nowrap" dir={f === "taxNumber" || f === "phone" || f === "email" ? "ltr" : undefined}>
                                {r.values[f as keyof typeof r.values] ?? ""}
                              </td>
                            ))}
                            <td className="p-2 min-w-48">
                              <span className={r.status === "error" ? "text-destructive" : "text-emerald-700"}>{r.status === "error" ? "غير صالح" : "صالح"}</span>
                              {r.errors.map((e, index) => <p key={index} className="text-destructive">{label(e.field)}: {e.message}</p>)}
                              {preview.warnings.some(w => w.row === r.row) && <p className="text-amber-700">تطابق؛ راجع التحذير لهذا الصف</p>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!preview.canCommit && preview.errors.length > 0 && <p className="text-sm text-muted-foreground">صحّح الأخطاء في الملف ثم أعد رفعه. لن يُستورد أي صف ما دام هناك خطأ.</p>}
                {preview.canCommit && preview.token && (
                  <label className="flex items-start gap-2 rounded-md border p-3 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={confirmGeneral}
                      disabled={blocked || !!busy}
                      onChange={(e) => { if (!blocked && !busy) setConfirmGeneral(e.target.checked); }}
                      data-testid="checkbox-confirm-general"
                    />
                    <span>راجعت كل الصفوف أعلاه، وأؤكد إنشاء {preview.validRows} عميل جديد دفعة واحدة دون أرصدة أو فواتير أو تعديل لعملاء موجودين.</span>
                  </label>
                )}
                <Button disabled={!canCommit || blocked || !!busy} onClick={commit} data-testid="button-import-commit">
                  {busy === "commit" ? "جارٍ الاستيراد..." : `تأكيد استيراد ${preview.validRows} عميل`}
                </Button>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
