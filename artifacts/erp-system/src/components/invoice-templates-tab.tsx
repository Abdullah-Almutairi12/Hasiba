import { useEffect, useRef, useState } from "react";
import {
  useGetAppSettings,
  usePatchAppSettings,
  getGetAppSettingsQueryKey,
  useGetInvoiceTemplateCatalog,
  getGetInvoiceTemplateCatalogQueryKey,
  useUploadInvoiceTemplateLogo,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettingsScope } from "@/components/settings-scope";
import { useToast } from "@/hooks/use-toast";
import { withBase } from "@/lib/print-docs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, Eye, FileText, Loader2, Lock, RefreshCw, RotateCcw, Save, Undo2, Upload } from "lucide-react";

export type Preset = "formal" | "simple" | "commercial" | "modern" | "ink";
export type InvoiceDesign = {
  version: 1; preset: Preset; accent: string; font: "Tajawal" | "sans-serif"; fontSize: number;
  logoMode: "identity" | "custom" | "none"; logoObjectKey: string | null; logoPosition: "start" | "center" | "end";
  logoWidth: number; header: string; footer: string; note: string; showContact: boolean; showBank: boolean;
};

const PRESETS: Preset[] = ["formal", "simple", "commercial", "modern", "ink"];
const PRESET_LABEL: Record<Preset, string> = { formal: "رسمي", simple: "بسيط", commercial: "تجاري", modern: "حديث", ink: "حبر" };
const FALLBACK: InvoiceDesign = {
  version: 1, preset: "formal", accent: "#285886", font: "Tajawal", fontSize: 12, logoMode: "identity", logoObjectKey: null,
  logoPosition: "start", logoWidth: 28, header: "", footer: "", note: "", showContact: true, showBank: true,
};
const HEX = /^#[0-9a-fA-F]{6}$/;
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));

/** Normalize unknown server data into the exact design shape; never invents extra keys. */
export function normalizeDesign(raw: unknown, base: InvoiceDesign): InvoiceDesign {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<InvoiceDesign>;
  const pick = <T,>(v: unknown, ok: readonly T[], d: T) => (ok.includes(v as T) ? (v as T) : d);
  return {
    version: 1,
    preset: pick(r.preset, PRESETS, base.preset),
    accent: typeof r.accent === "string" && HEX.test(r.accent) ? r.accent : base.accent,
    font: pick(r.font, ["Tajawal", "sans-serif"] as const, base.font),
    fontSize: typeof r.fontSize === "number" ? clampInt(r.fontSize, 11, 16) : base.fontSize,
    logoMode: pick(r.logoMode, ["identity", "custom", "none"] as const, base.logoMode),
    logoObjectKey: typeof r.logoObjectKey === "string" ? r.logoObjectKey : null,
    logoPosition: pick(r.logoPosition, ["start", "center", "end"] as const, base.logoPosition),
    logoWidth: typeof r.logoWidth === "number" ? clampInt(r.logoWidth, 18, 48) : base.logoWidth,
    header: typeof r.header === "string" ? r.header.slice(0, 250) : base.header,
    footer: typeof r.footer === "string" ? r.footer.slice(0, 500) : base.footer,
    note: typeof r.note === "string" ? r.note.slice(0, 1000) : base.note,
    showContact: typeof r.showContact === "boolean" ? r.showContact : base.showContact,
    showBank: typeof r.showBank === "boolean" ? r.showBank : base.showBank,
  };
}

type Baseline = { design: InvoiceDesign; companyId: number; scopeKey: number; revision: number; parentRevision: number };
const errStatus = (e: unknown) => (e as { status?: number } | null)?.status;
const errText = (e: unknown) => (e instanceof Error ? e.message : undefined);

function Seg<T extends string>({ value, options, onChange, disabled, testId }: {
  value: T; options: Array<[T, string]>; onChange: (v: T) => void; disabled?: boolean; testId: string;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-md border bg-muted/40 p-0.5" role="radiogroup" data-testid={testId}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}
          data-testid={`${testId}-${v}`}
          className={`rounded px-3 py-1 text-sm transition-colors disabled:opacity-50 ${value === v ? "bg-background font-semibold text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Abstract layout thumbnail per preset — illustrative only, not a rendering of financial data. */
function PresetGlyph({ preset, accent }: { preset: Preset; accent: string }) {
  const bar = (w: string, o = 0.25) => <div className="h-1 rounded-full" style={{ width: w, background: accent, opacity: o }} />;
  return (
    <div className="flex h-20 flex-col gap-1.5 rounded border bg-background p-2" aria-hidden>
      {preset === "formal" && <><div className="flex justify-between"><div className="size-4 rounded-sm" style={{ background: accent }} />{bar("40%", 0.6)}</div><div className="h-px" style={{ background: accent }} />{bar("90%")}{bar("80%")}{bar("85%")}</>}
      {preset === "simple" && <><div className="mx-auto">{bar("2.5rem", 0.5)}</div>{bar("100%", 0.12)}{bar("100%", 0.12)}{bar("100%", 0.12)}</>}
      {preset === "commercial" && <><div className="h-4 rounded-sm" style={{ background: accent, opacity: 0.85 }} /><div className="grid grid-cols-2 gap-1">{bar("100%")}{bar("100%")}</div>{bar("60%", 0.4)}</>}
      {preset === "modern" && <div className="flex h-full gap-1.5"><div className="w-1.5 rounded-full" style={{ background: accent }} /><div className="flex flex-1 flex-col gap-1.5">{bar("50%", 0.7)}{bar("90%", 0.15)}{bar("70%", 0.15)}{bar("80%", 0.15)}</div></div>}
      {preset === "ink" && <><div className="h-3 rounded-sm bg-foreground/80" />{bar("90%", 0.18)}<div className="h-px bg-foreground/60" />{bar("75%", 0.18)}</>}
    </div>
  );
}

export function InvoiceTemplatesTab() {
  const { branchId, generation } = useSettingsScope();
  const params = branchId ? { branchId } : undefined;
  const settings = useGetAppSettings(params);
  const settingsScope = settings.data?.scope;
  const catalog = useGetInvoiceTemplateCatalog({ query: { enabled: !!settingsScope?.canManage, queryKey: getGetInvoiceTemplateCatalogQueryKey() } });
  const patch = usePatchAppSettings();
  const upload = useUploadInvoiceTemplateLogo();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const scope = settings.data?.scope;
  const cat = catalog.data;
  const defaults = normalizeDesign(cat?.defaultDesign, FALLBACK);
  const scopeKey = branchId ?? 0;

  const [draft, setDraft] = useState<InvoiceDesign | null>(null);
  const baseline = useRef<Baseline | null>(null);
  const dirty = useRef(false);
  const [confirm, setConfirm] = useState<{ title: string; description: string; run: () => void | Promise<void> } | null>(null);

  // Scope token: bumped synchronously during render whenever company/branch/generation changes,
  // and on unmount. Every async operation captures it and ignores results once it moves.
  const scopeId = `${scope?.companyId ?? 0}:${scopeKey}:${generation}`;
  const token = useRef({ id: scopeId, n: 0 });
  if (token.current.id !== scopeId) token.current = { id: scopeId, n: token.current.n + 1 };
  useEffect(() => () => { token.current = { id: "unmounted", n: token.current.n + 1 }; }, []);

  // Hard isolation: any company/branch switch or explicit reload drops draft, dialog and preview.
  useEffect(() => {
    baseline.current = null; dirty.current = false; setDraft(null); setConfirm(null);
    setPdf(null); setPreviewErr(null); setPreviewing(false); setPreviewSig(null);
  }, [scopeId]);

  useEffect(() => {
    if (!settings.data || !scope?.canManage || !cat) return;
    const b = baseline.current;
    if (dirty.current && b && b.companyId === scope.companyId && b.scopeKey === scopeKey) return; // keep edits (e.g. after 409)
    const tmpl = (settings.data as unknown as { templates?: Record<string, unknown> }).templates;
    const design = normalizeDesign(tmpl?.invoiceDesign, defaults);
    baseline.current = { design, companyId: scope.companyId, scopeKey, revision: scope.revision, parentRevision: scope.parentRevision };
    setDraft(design);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data, cat, generation, scopeKey]);

  const set = <K extends keyof InvoiceDesign>(k: K, v: InvoiceDesign[K]) => { dirty.current = true; setDraft(d => (d ? { ...d, [k]: v } : d)); };

  // Preview state
  const [sample, setSample] = useState<"short" | "long">("short");
  const [width, setWidth] = useState<"a4" | "80">("a4");
  const [pdf, setPdf] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf); }, [pdf]);
  const [previewSig, setPreviewSig] = useState<string | null>(null);
  const currentSig = JSON.stringify({ draft, sample, width });
  const sigRef = useRef(currentSig);
  sigRef.current = currentSig;
  // A shown PDF that no longer matches the draft/sample/width is removed, never left looking current.
  useEffect(() => { if (previewSig && previewSig !== currentSig) { setPdf(null); setPreviewSig(null); } }, [currentSig, previewSig]);

  const overrideKeys = ((scope?.overrides as Record<string, string[]> | undefined)?.templates) ?? [];
  const branchOverrides = !!branchId && overrideKeys.includes("invoiceDesign");

  if (settings.isLoading || (settingsScope?.canManage && catalog.isLoading)) {
    return <Card data-testid="invoice-templates-loading"><CardContent className="space-y-3 p-6"><Skeleton className="h-6 w-1/3" /><div className="grid gap-3 sm:grid-cols-5">{PRESETS.map(p => <Skeleton key={p} className="h-32" />)}</div><Skeleton className="h-64" /></CardContent></Card>;
  }
  if (!scope?.canManage || errStatus(catalog.error) === 403 || cat?.canManage === false) {
    return <Card data-testid="invoice-templates-forbidden"><CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><Lock className="size-4" />تصميم قوالب الفواتير متاح لمن يملك صلاحية إدارة الإعدادات فقط. صلاحيات قراءة الفواتير وطباعتها وتصديرها لا تتغير.</CardContent></Card>;
  }
  if (settings.isError || catalog.isError) {
    return <Card data-testid="invoice-templates-error"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-6 text-sm" role="alert">
      <span>تعذر تحميل قوالب الفواتير أو نسخة الإعدادات؛ الحفظ غير متاح دون نسخة مؤكدة.</span>
      <Button variant="outline" size="sm" onClick={() => { void settings.refetch(); void catalog.refetch(); }} data-testid="button-retry-invoice-templates"><RefreshCw className="me-1 size-4" />إعادة المحاولة</Button>
    </CardContent></Card>;
  }
  if (!draft || !baseline.current) {
    return <Card><CardContent className="p-6"><Skeleton className="h-40" /></CardContent></Card>;
  }

  const presetsMeta = cat?.presets ?? [];
  const b = baseline.current;
  const isDirty = JSON.stringify(draft) !== JSON.stringify(b.design);
  const accentValid = HEX.test(draft.accent);
  const busy = patch.isPending || upload.isPending;

  async function save(design: InvoiceDesign | null = draft) {
    if (!design || !b) return;
    const t = token.current.n;
    const live = () => token.current.n === t;
    const draft = design;
    if (!HEX.test(draft.accent)) { toast({ title: "لون التمييز يجب أن يكون بصيغة #RRGGBB", variant: "destructive" }); return; }
    if (draft.logoMode === "custom" && !draft.logoObjectKey) { toast({ title: "ارفع شعارًا مخصصًا أو اختر وضع شعار آخر", variant: "destructive" }); return; }
    try {
      await patch.mutateAsync({ params, data: { expectedCompanyId: b.companyId, expectedRevision: b.revision, expectedParentRevision: b.parentRevision, templates: { invoiceDesign: draft } } });
      // Saved on the server: always refresh the cache, but only touch local state if still in the same scope.
      if (live()) { dirty.current = false; setDraft(draft); }
      await qc.invalidateQueries({ queryKey: getGetAppSettingsQueryKey() });
      if (!live()) return;
      toast({ title: "تم حفظ تصميم الفاتورة لهذا النطاق" });
    } catch (e) {
      if (!live()) return;
      toast({ title: errStatus(e) === 409 ? "تغيرت نسخة الإعدادات؛ تعديلاتك باقية. أعد تحميل النسخة ثم أعد تطبيقها" : "تعذر تأكيد الحفظ؛ تعديلاتك باقية", description: errText(e), variant: "destructive" });
    }
  }

  async function resetToInherited() {
    if (!b || !branchId) return; // root scope has no reset; only branches inherit
    const t = token.current.n;
    const live = () => token.current.n === t;
    try {
      await patch.mutateAsync({ params, data: { expectedCompanyId: b.companyId, expectedRevision: b.revision, expectedParentRevision: b.parentRevision, reset: { templates: ["invoiceDesign"] } } });
      if (live()) dirty.current = false;
      await qc.invalidateQueries({ queryKey: getGetAppSettingsQueryKey() });
      if (!live()) return;
      toast({ title: "عاد تصميم الفرع إلى تصميم المنشأة" });
    } catch (e) {
      if (!live()) return;
      toast({ title: errStatus(e) === 409 ? "تغيرت نسخة الإعدادات؛ أعد التحميل" : "لم تُحفظ العودة", description: errText(e), variant: "destructive" });
    }
  }

  async function preview() {
    if (!draft || !b) return;
    const t = token.current.n;
    const sig = currentSig;
    const live = () => token.current.n === t && sigRef.current === sig;
    setPreviewing(true); setPreviewErr(null); setPdf(null); setPreviewSig(null);
    try {
      const res = await fetch(withBase("/api/print/templates/preview"), {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedCompanyId: b.companyId, branchId: branchId ?? null, design: draft, sample, width }),
      });
      if (!res.ok) {
        let msg = res.status === 403 ? "لا تملك صلاحية معاينة القوالب" : res.status === 409 ? "تغيرت الشركة النشطة؛ أعد تحميل الصفحة" : "تعذر إنشاء المعاينة";
        try { const j = await res.json(); if (j?.error || j?.message) msg = String(j.error ?? j.message); } catch { /* non-JSON */ }
        throw new Error(msg);
      }
      const type = res.headers.get("content-type") ?? "";
      if (!type.toLowerCase().startsWith("application/pdf")) throw new Error("استجابة المعاينة ليست ملف PDF");
      const blob = await res.blob();
      if (!live()) return;
      setPdf(URL.createObjectURL(new Blob([blob], { type: "application/pdf" }))); setPreviewSig(sig);
    } catch (e) {
      if (!live()) return;
      setPdf(null); setPreviewErr(errText(e) ?? "تعذر إنشاء المعاينة");
    } finally { if (token.current.n === t) setPreviewing(false); }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !b) return;
    if (file.size > 2 * 1024 * 1024) { toast({ title: "الحد الأقصى 2MB", variant: "destructive" }); return; }
    if (!["image/png", "image/jpeg"].includes(file.type)) { toast({ title: "يُقبل PNG أو JPEG فقط", variant: "destructive" }); return; }
    const t = token.current.n;
    const live = () => token.current.n === t;
    const reader = new FileReader();
    reader.onload = async () => {
      if (!live()) return;
      const contentBase64 = String(reader.result).replace(/^data:[^,]*,/, "");
      try {
        const r = await upload.mutateAsync({ data: { contentBase64, expectedCompanyId: b.companyId, branchId: branchId ?? null } });
        if (!live()) return; // never attach an object from another company/branch
        dirty.current = true;
        setDraft(d => (d ? { ...d, logoMode: "custom", logoObjectKey: r.objectKey } : d));
        toast({ title: "رُفع الشعار؛ لن يُعتمد إلا بعد حفظ التصميم" });
      } catch (err) {
        if (!live()) return;
        toast({ title: "فشل رفع الشعار", description: errText(err), variant: "destructive" });
      } finally { if (fileRef.current) fileRef.current.value = ""; }
    };
    reader.readAsDataURL(file);
  }

  const sourceLabel = branchId ? (branchOverrides ? "مخصص لهذا الفرع" : "موروث من المنشأة") : "إعداد المنشأة";

  return (
    <Card className="overflow-hidden" data-testid="invoice-templates">
      <AlertDialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null); }}>
        <AlertDialogContent dir="rtl"><AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
        </AlertDialogHeader><AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction data-testid="button-confirm-design" onClick={() => { const r = confirm?.run; setConfirm(null); void r?.(); }}>تأكيد</AlertDialogAction>
        </AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><FileText className="size-5 text-primary" /> تصميم الفاتورة المطبوعة</CardTitle>
            <CardDescription className="mt-1">يُطبَّق على ملفات PDF للفواتير الصادرة من نفس المحرك. لا يغيّر الأرقام أو الحسابات أو صلاحيات الفواتير.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={branchOverrides || !branchId ? "default" : "secondary"} data-testid="status-invoice-design-source">{sourceLabel}</Badge>
            <Badge variant="outline" data-testid="text-invoice-design-revision">نسخة النطاق {b.revision}{branchId ? ` / المنشأة ${b.parentRevision}` : ""}</Badge>
            {isDirty && <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400" data-testid="status-invoice-design-dirty">تعديلات غير محفوظة</Badge>}
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <fieldset className="min-w-0 space-y-6 disabled:opacity-80" disabled={patch.isPending} data-testid="fieldset-invoice-design">
          <section>
            <Label className="mb-2 block font-semibold">النمط الأساسي</Label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {PRESETS.map(p => {
                const meta = presetsMeta.find(x => x.id === p);
                const active = draft.preset === p;
                return (
                  <button key={p} type="button" onClick={() => set("preset", p)} aria-pressed={active} data-testid={`card-preset-${p}`}
                    className={`group rounded-lg border p-2 text-start transition-all hover:-translate-y-0.5 hover:shadow-md ${active ? "border-primary ring-2 ring-primary/30" : ""}`}>
                    <PresetGlyph preset={p} accent={accentValid ? draft.accent : FALLBACK.accent} />
                    <div className="mt-2 text-sm font-semibold">{meta?.name ?? PRESET_LABEL[p]}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{meta?.description ?? ""}</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="inv-accent">لون التمييز</Label>
              <div className="mt-1 flex items-center gap-2">
                <input type="color" value={accentValid ? draft.accent : "#285886"} onChange={e => set("accent", e.target.value)} className="h-9 w-12 cursor-pointer rounded border bg-transparent" data-testid="input-accent-picker" aria-label="اختيار اللون" />
                <Input id="inv-accent" dir="ltr" maxLength={7} value={draft.accent} onChange={e => set("accent", e.target.value)} aria-invalid={!accentValid} className={accentValid ? "" : "border-destructive"} data-testid="input-accent" />
              </div>
            </div>
            <div>
              <Label>الخط</Label>
              <div className="mt-1"><Seg value={draft.font} onChange={v => set("font", v)} testId="seg-font" options={[["Tajawal", "Tajawal"], ["sans-serif", "خط النظام"]]} /></div>
            </div>
            <div>
              <Label htmlFor="inv-fs">حجم الخط ({draft.fontSize} نقطة)</Label>
              <input id="inv-fs" type="range" min={11} max={16} step={1} value={draft.fontSize} onChange={e => set("fontSize", clampInt(Number(e.target.value), 11, 16))} className="mt-2 w-full accent-[hsl(var(--primary))]" data-testid="input-font-size" />
            </div>
            <div>
              <Label htmlFor="inv-lw">عرض الشعار ({draft.logoWidth} مم)</Label>
              <input id="inv-lw" type="range" min={18} max={48} step={1} value={draft.logoWidth} disabled={draft.logoMode === "none"} onChange={e => set("logoWidth", clampInt(Number(e.target.value), 18, 48))} className="mt-2 w-full accent-[hsl(var(--primary))]" data-testid="input-logo-width" />
            </div>
          </section>

          <section className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>الشعار</Label>
              <Seg value={draft.logoMode} onChange={v => set("logoMode", v)} testId="seg-logo-mode" options={[["identity", "شعار الهوية القانونية"], ["custom", "شعار مخصص"], ["none", "بلا شعار"]]} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">الموضع</span>
              <Seg value={draft.logoPosition} disabled={draft.logoMode === "none"} onChange={v => set("logoPosition", v)} testId="seg-logo-position" options={[["start", "بداية السطر"], ["center", "وسط"], ["end", "نهاية السطر"]]} />
            </div>
            {draft.logoMode === "custom" && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded border bg-muted/30">
                  {draft.logoObjectKey ? <span className="px-1 text-center text-xs text-primary" data-testid="status-custom-logo">شعار مرفوع؛ يظهر في المعاينة</span> : <span className="text-xs text-muted-foreground">لا شعار</span>}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFile} data-testid="input-template-logo-file" />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="button-upload-template-logo">
                  {upload.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Upload className="me-2 size-4" />}رفع شعار PNG/JPEG
                </Button>
                <p className="w-full text-xs text-muted-foreground">الرفع ينشئ ملفًا منفصلًا ثابتًا؛ لا يُعتمد في الفواتير إلا بعد حفظ التصميم.</p>
              </div>
            )}
          </section>

          <section className="grid gap-4">
            <div>
              <Label>نص الترويسة <span className="text-xs text-muted-foreground">({draft.header.length}/250)</span></Label>
              <Input maxLength={250} value={draft.header} onChange={e => set("header", e.target.value)} data-testid="input-design-header" />
            </div>
            <div>
              <Label>نص التذييل <span className="text-xs text-muted-foreground">({draft.footer.length}/500)</span></Label>
              <Textarea rows={2} maxLength={500} value={draft.footer} onChange={e => set("footer", e.target.value)} data-testid="input-design-footer" />
            </div>
            <div>
              <Label>ملاحظة <span className="text-xs text-muted-foreground">({draft.note.length}/1000)</span></Label>
              <Textarea rows={3} maxLength={1000} value={draft.note} onChange={e => set("note", e.target.value)} data-testid="input-design-note" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-lg border p-3 text-sm">إظهار بيانات التواصل
                <Switch checked={draft.showContact} onCheckedChange={v => set("showContact", v)} data-testid="switch-show-contact" /></label>
              <label className="flex items-center justify-between rounded-lg border p-3 text-sm">إظهار البيانات البنكية
                <Switch checked={draft.showBank} onCheckedChange={v => set("showBank", v)} data-testid="switch-show-bank" /></label>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            <Button variant="ghost" disabled={busy} onClick={() => { dirty.current = true; setDraft({ ...defaults, logoObjectKey: null }); }} data-testid="button-design-defaults">
              <RotateCcw className="me-2 size-4" />القيم الافتراضية (مسودة)
            </Button>
            {isDirty && <Button variant="ghost" disabled={busy} onClick={() => { dirty.current = false; setDraft(b.design); }} data-testid="button-design-discard"><Undo2 className="me-2 size-4" />تجاهل التعديلات</Button>}
            {branchId ? (branchOverrides && <Button variant="outline" disabled={busy} data-testid="button-design-inherit" onClick={() => setConfirm({ title: "العودة إلى تصميم المنشأة", description: "سيُزال تصميم الفرع بالكامل ويعود إلى تصميم المنشأة. إعداد المنشأة لن يتغير.", run: resetToInherited })}>العودة للموروث من المنشأة</Button>)
              : <Button variant="outline" disabled={busy} data-testid="button-design-restore-default" onClick={() => setConfirm({ title: "استعادة التصميم الافتراضي للمنشأة", description: "سيُحفظ التصميم الافتراضي للنظام كتصميم المنشأة بنسخة الإعدادات الحالية. الفروع المخصصة تبقى كما هي.", run: () => { const d = { ...defaults, logoObjectKey: null }; dirty.current = true; setDraft(d); return save(d); } })}>استعادة الافتراضي وحفظه</Button>}
            <Button disabled={busy || !isDirty || !accentValid} onClick={() => void save()} data-testid="button-save-invoice-design">
              {patch.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}حفظ التصميم
            </Button>
          </div>

        </fieldset>

        <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
          <div className="flex items-center justify-between">
            <span className="font-semibold">المعاينة</span>
            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400" data-testid="badge-demo">عينة تجريبية</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Seg value={sample as "short" | "long"} onChange={v => setSample(v)} testId="seg-sample" options={[["short", "قصيرة"], ["long", "طويلة"]]} />
            <Seg value={width as "a4" | "80"} onChange={v => setWidth(v)} testId="seg-width" options={[["a4", "A4"], ["80", "80 مم"]]} />
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" variant="secondary" disabled={previewing || !accentValid} onClick={() => void preview()} data-testid="button-preview-invoice-design">
              {previewing ? <Loader2 className="me-2 size-4 animate-spin" /> : <Eye className="me-2 size-4" />}إنشاء معاينة للمسودة
            </Button>
            {pdf && <Button variant="outline" asChild data-testid="button-download-preview"><a href={pdf} download={`invoice-template-sample-${sample}-${width}.pdf`}><Download className="size-4" /></a></Button>}
          </div>
          <div className={`relative overflow-hidden rounded-lg border bg-muted/30 ${width === "80" ? "mx-auto max-w-[300px]" : ""}`} style={{ height: 560 }}>
            {previewing && <Skeleton className="absolute inset-0" />}
            {!previewing && pdf && <iframe title="معاينة عينة تجريبية" src={pdf} className="size-full animate-in fade-in duration-300" data-testid="iframe-invoice-preview" />}
            {!previewing && !pdf && (
              <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground" data-testid={previewErr ? "preview-error" : "preview-empty"} role={previewErr ? "alert" : undefined}>
                {previewErr ? <><span className="text-destructive">{previewErr}</span><Button size="sm" variant="outline" onClick={() => void preview()}><RefreshCw className="me-1 size-4" />إعادة المحاولة</Button></>
                  : <><FileText className="size-8" />اضغط «إنشاء معاينة» لعرض المسودة الحالية على عينة يولدها الخادم.</>}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">العينة بيانات توضيحية من الخادم بلا رقم مالي ولا تمثل فاتورة حقيقية؛ تُعرض بنفس محرك ملفات PDF للفواتير الصادرة. المعاينة لا تحفظ التصميم.</p>
        </aside>
      </CardContent>
    </Card>
  );
}
