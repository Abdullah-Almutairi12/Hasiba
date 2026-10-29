import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useGetInvoiceEditorState,
  useSaveInvoiceEditorDraft,
  usePublishInvoiceEditorDraft,
  useActivateInvoiceEditorRelease,
  usePreviewInvoiceEditorDraft,
  useUploadInvoiceTemplateLogo,
} from "@workspace/api-client-react";
import type { EditorDesign, EditorLayout, EditorLayoutOrderItem, EditorState } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowDown, ArrowUp, CheckCircle2, Circle, Copy, Download, Eye, GripVertical, History, Layers, Loader2,
  Lock, Redo2, RefreshCw, Rocket, Save, Undo2, Upload, AlertTriangle,
} from "lucide-react";

type Section = EditorLayoutOrderItem;
type Preset = EditorDesign["base"]["preset"];
type LayoutKey = "a4" | "thermal80";
type Sample = "short" | "long";
type Width = "a4" | "80";

export const SECTIONS: Section[] = ["identity", "customer", "references", "items", "totals", "qr", "notes", "footer"];
const SECTION_LABEL: Record<Section, string> = {
  identity: "هوية المنشأة", customer: "بيانات العميل", references: "المراجع والتواريخ", items: "جدول البنود",
  totals: "الإجماليات", qr: "رمز QR", notes: "الملاحظات", footer: "التذييل",
};
const PRESETS: Preset[] = ["formal", "simple", "commercial", "modern", "ink"];
const PRESET_LABEL: Record<Preset, string> = { formal: "رسمي", simple: "بسيط", commercial: "تجاري", modern: "حديث", ink: "حبر" };
const PRESET_ACCENT: Record<Preset, string> = { formal: "#285886", simple: "#3f4a55", commercial: "#a2482b", modern: "#1f7a6d", ink: "#26262b" };
const WIDTH_LABEL = ["الوصف", "الكمية", "السعر", "الضريبة", "الإجمالي"];
export const DEFAULT_WIDTHS = [43, 8, 18, 10, 21];
const HEX = /^#[0-9a-fA-F]{6}$/;
const MARGIN: Record<LayoutKey, [number, number]> = { a4: [8, 18], thermal80: [3, 5] };
const COMBOS: Array<[Width, Sample]> = [["a4", "short"], ["a4", "long"], ["80", "short"], ["80", "long"]];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));
const uuid = () => crypto.randomUUID();
const errStatus = (e: unknown) => (e as { status?: number } | null)?.status;
const errText = (e: unknown) => (e instanceof Error ? e.message : undefined);
/** Unknown outcome: network failure or server error — the request may have been applied. */
const isUnknown = (e: unknown) => { const s = errStatus(e); return s === undefined || s >= 500; };

const layout = (k: LayoutKey): EditorLayout => ({
  order: [...SECTIONS], gap: k === "a4" ? 4 : 2, margin: k === "a4" ? 12 : 4, align: "start",
  metadataColumns: k === "a4" ? 2 : 1, logoGap: k === "a4" ? 4 : 2, widths: [...DEFAULT_WIDTHS], showSequence: false,
});
export function presetDesign(p: Preset): EditorDesign {
  return {
    schemaVersion: 1, name: `نسخة من ${PRESET_LABEL[p]}`,
    base: { version: 1, preset: p, accent: PRESET_ACCENT[p], font: "Tajawal", fontSize: 12, logoMode: "identity", logoObjectKey: null,
      logoPosition: "start", logoWidth: 28, header: "", footer: "", note: "", showContact: true, showBank: true },
    a4: layout("a4"), thermal80: layout("thermal80"),
  };
}

/** Returns a list of human-readable problems; empty means the design is valid for the contract. */
export function validateDesign(d: EditorDesign): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push("اسم التصميم مطلوب");
  if (d.name.length > 80) out.push("اسم التصميم حتى 80 حرفًا");
  if (!HEX.test(d.base.accent)) out.push("لون التمييز يجب أن يكون #RRGGBB");
  if (d.base.logoMode === "custom" && !d.base.logoObjectKey) out.push("ارفع شعارًا مخصصًا أو غيّر وضع الشعار");
  (["a4", "thermal80"] as LayoutKey[]).forEach(k => {
    const l = d[k]; const tag = k === "a4" ? "A4" : "80 مم";
    const w = l.widths;
    if (w.length !== 5 || w.some(x => !Number.isInteger(x))) out.push(`${tag}: عرض الأعمدة أعداد صحيحة`);
    else {
      const sum = w.reduce((a, b) => a + b, 0);
      if (sum !== 100) out.push(`${tag}: مجموع عرض الأعمدة ${sum} ويجب أن يساوي 100`);
      if (w[0] < 25) out.push(`${tag}: عمود الوصف 25 على الأقل`);
      if (w[4] < 15) out.push(`${tag}: عمود الإجمالي 15 على الأقل`);
      if (w.some(x => x < 8 || x > 55)) out.push(`${tag}: كل عمود بين 8 و55`);
    }
    if (new Set(l.order).size !== 8 || l.order.length !== 8) out.push(`${tag}: ترتيب الأقسام يجب أن يضم الأقسام الثمانية`);
    const [lo, hi] = MARGIN[k];
    if (l.margin < lo || l.margin > hi) out.push(`${tag}: الهامش بين ${lo} و${hi} مم`);
  });
  return out;
}

type Working = { id: string; revision: number; design: EditorDesign; saved: EditorDesign | null };
type Pending = { kind: "save" | "publish" | "activate"; label: string; body: Record<string, unknown> };
type PreviewSlot = { url: string | null; sig: string; status: "loading" | "ok" | "error"; error?: string };
type Confirm = { title: string; description: string; action: string; run: () => void };

function Seg<T extends string>({ value, options, onChange, disabled, testId }: {
  value: T; options: Array<[T, string]>; onChange: (v: T) => void; disabled?: boolean; testId: string;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-md border bg-muted/40 p-0.5" role="radiogroup" data-testid={testId}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)} data-testid={`${testId}-${v}`}
          className={`rounded px-3 py-1 text-sm transition-colors disabled:opacity-50 ${value === v ? "bg-background font-semibold text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
      ))}
    </div>
  );
}

function Range({ id, label, value, min, max, unit, onChange, testId, disabled }: {
  id: string; label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void; testId: string; disabled?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id} className="flex justify-between text-xs"><span>{label}</span><span className="font-mono tabular-nums text-muted-foreground">{value} {unit}</span></Label>
      <input id={id} type="range" min={min} max={max} step={1} value={value} disabled={disabled} onChange={e => onChange(clamp(Number(e.target.value), min, max))}
        className="mt-1.5 w-full accent-[hsl(var(--primary))]" data-testid={testId} />
    </div>
  );
}

function LayoutEditor({ k, value, onChange }: { k: LayoutKey; value: EditorLayout; onChange: (l: EditorLayout) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to > 7 || from === to) return;
    const order = [...value.order]; const [x] = order.splice(from, 1); order.splice(to, 0, x);
    onChange({ ...value, order });
  };
  const sum = value.widths.reduce((a, b) => a + b, 0);
  const [lo, hi] = MARGIN[k];
  const p = k === "a4" ? "a4" : "80";
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <Label className="font-semibold">ترتيب الأقسام</Label>
          <span className="text-xs text-muted-foreground">اسحب، أو Alt + الأسهم</span>
        </div>
        <ol className="space-y-1.5" data-testid={`list-order-${p}`}>
          {value.order.map((s, i) => (
            <li key={s} draggable tabIndex={0}
              onDragStart={e => { setDrag(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
              onDragOver={e => { e.preventDefault(); setOver(i); }}
              onDragLeave={() => setOver(o => (o === i ? null : o))}
              onDrop={e => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}
              onDragEnd={() => { setDrag(null); setOver(null); }}
              onKeyDown={e => { if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1); } if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1); } }}
              aria-label={`${SECTION_LABEL[s]}، الموضع ${i + 1} من 8`}
              data-testid={`row-section-${p}-${s}`}
              className={`group flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${drag === i ? "opacity-40" : ""} ${over === i && drag !== i ? "border-primary bg-primary/5" : ""}`}>
              <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden />
              <span className="w-5 font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="flex-1">{SECTION_LABEL[s]}</span>
              <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`نقل ${SECTION_LABEL[s]} لأعلى`} data-testid={`button-up-${p}-${s}`}><ArrowUp className="size-3.5" /></Button>
              <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i === 7} onClick={() => move(i, i + 1)} aria-label={`نقل ${SECTION_LABEL[s]} لأسفل`} data-testid={`button-down-${p}-${s}`}><ArrowDown className="size-3.5" /></Button>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">الأقسام الثمانية تظهر دائمًا؛ يتغير ترتيبها فقط ولا تُخفى بيانات الفاتورة.</p>
      </div>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Range id={`m-${p}`} label="الهامش" unit="مم" value={value.margin} min={lo} max={hi} onChange={v => onChange({ ...value, margin: v })} testId={`input-margin-${p}`} />
          <Range id={`g-${p}`} label="التباعد بين الأقسام" unit="مم" value={value.gap} min={0} max={8} onChange={v => onChange({ ...value, gap: v })} testId={`input-gap-${p}`} />
          <Range id={`lg-${p}`} label="مسافة الشعار" unit="مم" value={value.logoGap} min={0} max={8} onChange={v => onChange({ ...value, logoGap: v })} testId={`input-logo-gap-${p}`} />
          <div>
            <Label className="text-xs">أعمدة البيانات الوصفية</Label>
            <div className="mt-1.5"><Seg value={String(value.metadataColumns) as "1" | "2"} onChange={v => onChange({ ...value, metadataColumns: Number(v) })} testId={`seg-meta-cols-${p}`} options={[["1", "عمود"], ["2", "عمودان"]]} /></div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-xs">محاذاة هوية المنشأة</Label>
          <Seg value={value.align} onChange={v => onChange({ ...value, align: v })} testId={`seg-align-${p}`} options={[["start", "البداية"], ["center", "الوسط"], ["end", "النهاية"]]} />
        </div>
        <label className="flex items-center justify-between rounded-md border p-2.5 text-sm">إظهار عمود التسلسل
          <Switch checked={value.showSequence} onCheckedChange={v => onChange({ ...value, showSequence: v })} data-testid={`switch-sequence-${p}`} /></label>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label className="text-xs">عرض أعمدة البنود (%)</Label>
            <span className={`font-mono text-xs tabular-nums ${sum === 100 ? "text-muted-foreground" : "font-semibold text-destructive"}`} data-testid={`text-width-sum-${p}`}>المجموع {sum}/100</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            {value.widths.map((w, i) => <div key={i} style={{ width: `${Math.min(w, 100)}%`, opacity: 0.35 + i * 0.13 }} className="h-full border-e border-background bg-primary" />)}
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {value.widths.map((w, i) => (
              <div key={i}>
                <span className="block truncate text-[11px] text-muted-foreground">{WIDTH_LABEL[i]}</span>
                <Input type="number" inputMode="numeric" min={i === 0 ? 25 : i === 4 ? 15 : 8} max={55} value={w} className="h-8 px-1.5 text-center font-mono"
                  onChange={e => { const widths = [...value.widths]; widths[i] = Math.round(Number(e.target.value) || 0); onChange({ ...value, widths }); }}
                  aria-label={`عرض ${WIDTH_LABEL[i]}`} data-testid={`input-width-${p}-${i}`} />
              </div>
            ))}
          </div>
          <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => onChange({ ...value, widths: [...DEFAULT_WIDTHS] })} data-testid={`button-widths-default-${p}`}>العروض الافتراضية 43/8/18/10/21</Button>
        </div>
      </div>
    </div>
  );
}

export function InvoiceEditor({ companyId, branchId, generation }: { companyId: number; branchId: number | null; generation: number }) {
  const { toast } = useToast();
  const getState = useGetInvoiceEditorState();
  const saveM = useSaveInvoiceEditorDraft();
  const publishM = usePublishInvoiceEditorDraft();
  const activateM = useActivateInvoiceEditorRelease();
  const previewM = usePreviewInvoiceEditorDraft();
  const upload = useUploadInvoiceTemplateLogo();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Async scope token: any company/branch/generation change invalidates in-flight work.
  const scopeId = `${companyId}:${branchId ?? 0}:${generation}`;
  const token = useRef({ id: scopeId, n: 0 });
  if (token.current.id !== scopeId) token.current = { id: scopeId, n: token.current.n + 1 };
  useEffect(() => () => { token.current = { id: "unmounted", n: token.current.n + 1 }; }, []);
  const capture = () => { const t = token.current.n; return () => token.current.n === t; };

  const [state, setState] = useState<EditorState | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [work, setWork] = useState<Working | null>(null);
  const [past, setPast] = useState<EditorDesign[]>([]);
  const [future, setFuture] = useState<EditorDesign[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewSlot>>({});
  const [shown, setShown] = useState<string>("a4:short");
  const [layoutTab, setLayoutTab] = useState<LayoutKey>("a4");

  const dirty = !!work && (!work.saved || JSON.stringify(work.design) !== JSON.stringify(work.saved));
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const busyRef = useRef(busy); busyRef.current = busy;
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const [previewing, setPreviewing] = useState(false);
  const previewingRef = useRef(false);

  const clearPreviews = useCallback(() => {
    setPreviews(p => { Object.values(p).forEach(s => s.url && URL.revokeObjectURL(s.url)); return {}; });
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const live = capture();
    try {
      const s = await getState.mutateAsync({ data: { expectedCompanyId: companyId, branchId } });
      if (!live()) return null;
      if (!s || !Array.isArray(s.drafts) || !Array.isArray(s.releases)) throw new Error("استجابة غير متوقعة لحالة المحرر");
      setState(s); setLoadErr(null); setRevoked(false);
      return s;
    } catch (e) {
      if (!live()) return null;
      if (errStatus(e) === 403 || errStatus(e) === 401) { setRevoked(true); setWork(null); clearPreviews(); }
      else if (errStatus(e) === 409) { setLoadErr("تغيرت الشركة النشطة؛ أعد تحميل الصفحة"); setWork(null); }
      else if (!opts?.silent) setLoadErr(errText(e) ?? "تعذر تحميل حالة المحرر");
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, branchId, getState.mutateAsync, clearPreviews]);
  const loadRef = useRef(load); loadRef.current = load;

  // Hard isolation on scope change.
  useEffect(() => {
    setState(null); setWork(null); setPast([]); setFuture([]); setConflict(null); setPending(null); setBusy(null);
    setConfirm(null); setLoadErr(null); setRevoked(false); clearPreviews();
    previewingRef.current = false; setPreviewing(false);
    void loadRef.current();
  }, [scopeId, clearPreviews]);

  // Poll when not dirty and idle; detects revocation and remote changes.
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (dirtyRef.current || busyRef.current || pendingRef.current || document.hidden) return;
      void loadRef.current({ silent: true });
    }, 20000);
    return () => window.clearInterval(iv);
  }, [scopeId]);

  // Keep an open, clean draft in sync with the server copy after polling.
  useEffect(() => {
    if (!state || !work || dirtyRef.current) return;
    const d = state.drafts.find(x => x.id === work.id);
    if (d && d.revision !== work.revision) setWork({ id: d.id, revision: d.revision, design: d.design, saved: d.design });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Unsaved guards: tab close and internal link navigation.
  useEffect(() => {
    const beforeCompany = (event: Event) => {
      if (pendingRef.current || busyRef.current) {
        event.preventDefault();
        toast({ title: "انتظر تأكيد العملية الحالية قبل تبديل المنشأة" });
      } else if (dirtyRef.current && !window.confirm("لديك تصميم غير محفوظ. تبديل المنشأة يفقد هذه التعديلات. متابعة؟")) {
        event.preventDefault();
      }
    };
    window.addEventListener("hasiba:before-company-switch", beforeCompany);
    return () => window.removeEventListener("hasiba:before-company-switch", beforeCompany);
  }, [toast]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.href.startsWith("blob:")) return;
      if (!window.confirm("لديك تعديلات غير محفوظة في محرر الفاتورة. مغادرة الصفحة ستفقدها. متابعة؟")) { e.preventDefault(); e.stopPropagation(); }
    };
    // Settings tab triggers (Radix activates on mousedown / arrow keys) would unmount this editor.
    const onTab = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[role="tab"]');
      if (!el || rootRef.current?.contains(el) || el.getAttribute("aria-selected") === "true") return;
      if (e instanceof KeyboardEvent && !["Enter", " ", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      if (!window.confirm("لديك تعديلات غير محفوظة في محرر الفاتورة. الانتقال إلى تبويب آخر سيفقدها. متابعة؟")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", onTab, true);
    document.addEventListener("keydown", onTab, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload); document.removeEventListener("click", onClick, true);
      document.removeEventListener("mousedown", onTab, true); document.removeEventListener("keydown", onTab, true);
    };
  }, [dirty]);
  // Coordination hook for hosts: other surfaces may listen and ask before switching scope.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("invoice-editor:dirty", { detail: { dirty, scopeId } }));
    return () => { if (dirty) window.dispatchEvent(new CustomEvent("invoice-editor:dirty", { detail: { dirty: false, scopeId } })); };
  }, [dirty, scopeId]);

  // Stale preview removal: any slot whose signature differs from the current design is dropped.
  const designSig = work ? JSON.stringify(work.design) : "";
  const sigRef = useRef(designSig); sigRef.current = designSig;
  const workIdRef = useRef(work?.id); workIdRef.current = work?.id;
  useEffect(() => {
    setPreviews(p => {
      let changed = false; const next: Record<string, PreviewSlot> = {};
      for (const [k, s] of Object.entries(p)) {
        if (s.sig === designSig) next[k] = s; else { changed = true; if (s.url) URL.revokeObjectURL(s.url); }
      }
      return changed ? next : p;
    });
  }, [designSig]);
  useEffect(() => () => { clearPreviews(); }, [clearPreviews]);

  const edit = (fn: (d: EditorDesign) => EditorDesign) => {
    if (!work || pendingRef.current || busyRef.current || previewingRef.current) return;
    setPast(p => [...p.slice(-49), work.design]); setFuture([]);
    setWork({ ...work, design: fn(work.design) });
  };
  const setBase = <K extends keyof EditorDesign["base"]>(k: K, v: EditorDesign["base"][K]) => edit(d => ({ ...d, base: { ...d.base, [k]: v } }));
  const frozen = () => !!pendingRef.current || !!busyRef.current || previewingRef.current;
  const undo = () => { if (!work || !past.length || frozen()) return; setFuture(f => [work.design, ...f]); setWork({ ...work, design: past[past.length - 1] }); setPast(p => p.slice(0, -1)); };
  const redo = () => { if (!work || !future.length || frozen()) return; setPast(p => [...p, work.design]); setWork({ ...work, design: future[0] }); setFuture(f => f.slice(1)); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !work || frozen()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const guardSwitch = (run: () => void) => {
    if (!dirty) { run(); return; }
    setConfirm({ title: "تجاهل التعديلات غير المحفوظة؟", description: "المسودة المفتوحة فيها تعديلات لم تُحفظ. المتابعة ستتجاهلها نهائيًا.", action: "تجاهل والمتابعة", run });
  };
  const open = (w: Working) => { setWork(w); setPast([]); setFuture([]); setConflict(null); clearPreviews(); };
  const openDraft = (id: string) => {
    const d = state?.drafts.find(x => x.id === id); if (!d) return;
    guardSwitch(() => open({ id: d.id, revision: d.revision, design: d.design, saved: d.design }));
  };
  const copyPreset = (p: Preset) => guardSwitch(() => open({ id: uuid(), revision: 0, design: presetDesign(p), saved: null }));
  const copyRelease = (id: string) => {
    const r = state?.releases.find(x => x.id === id); if (!r) return;
    guardSwitch(() => open({ id: uuid(), revision: 0, design: { ...r.design, name: `نسخة من ${r.design.name}`.slice(0, 80) }, saved: null }));
  };

  /** Runs a mutation through a pending slot: unknown outcomes keep the exact body for a byte-identical retry. */
  async function runPending(p: Pending, live: () => boolean) {
    setPending(p); setBusy(p.kind);
    try {
      let result: unknown;
      if (p.kind === "save") result = await saveM.mutateAsync({ data: p.body as never });
      else if (p.kind === "publish") result = await publishM.mutateAsync({ data: p.body as never });
      else result = await activateM.mutateAsync({ data: p.body as never });
      if (!live()) return { ok: false as const };
      setPending(null);
      return { ok: true as const, result };
    } catch (e) {
      if (!live()) return { ok: false as const };
      const s = errStatus(e);
      if (isUnknown(e)) {
        toast({ title: "لم تتأكد نتيجة العملية", description: "أعد المحاولة بنفس الطلب أو ألغه بعد التحقق من الحالة.", variant: "destructive" });
        return { ok: false as const };
      }
      setPending(null);
      if (s === 403 || s === 401) { setRevoked(true); clearPreviews(); }
      else if (s === 409) setConflict(errText(e) ?? "تغيرت النسخة على الخادم");
      else toast({ title: "رفض الخادم العملية", description: errText(e), variant: "destructive" });
      return { ok: false as const };
    } finally { if (live()) setBusy(null); }
  }

  async function save() {
    if (!work || pending) return;
    const problems = validateDesign(work.design);
    if (problems.length) { toast({ title: "التصميم غير صالح للحفظ", description: problems[0], variant: "destructive" }); return; }
    const live = capture();
    const body = { expectedCompanyId: companyId, branchId, id: work.id, expectedRevision: work.revision, requestId: uuid(), design: work.design };
    const r = await runPending({ kind: "save", label: "حفظ المسودة", body }, live);
    if (r.ok) afterSave(r.result as { revision?: number } | undefined, body.design);
  }
  function afterSave(res: { revision?: number } | undefined, design: EditorDesign) {
    setWork(w => (w && res?.revision !== undefined ? { ...w, revision: res.revision, saved: design } : w));
    toast({ title: "حُفظت المسودة", description: "الحفظ لا يفعّل التصميم؛ أنشئ المعاينات الأربع ثم انشر." });
    void load({ silent: true });
  }

  async function preview(width: Width, sample: Sample) {
    if (!work || previewingRef.current) return false;
    previewingRef.current = true; setPreviewing(true);
    const key = `${width}:${sample}`; const sig = designSig; const live = capture();
    setShown(key);
    setPreviews(p => { if (p[key]?.url) URL.revokeObjectURL(p[key].url!); return { ...p, [key]: { url: null, sig, status: "loading" } }; });
    try {
      const blob = await previewM.mutateAsync({ data: { expectedCompanyId: companyId, branchId, design: work.design, sample, width } });
      if (!live()) return;
      if (!(blob instanceof Blob)) throw new Error("استجابة المعاينة ليست ملف PDF");
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      setPreviews(p => (p[key]?.sig === sig ? { ...p, [key]: { url, sig, status: "ok" } } : (URL.revokeObjectURL(url), p)));
      return true;
    } catch (e) {
      if (!live()) return false;
      if (errStatus(e) === 403) { setRevoked(true); clearPreviews(); return false; }
      setPreviews(p => (p[key]?.sig === sig ? { ...p, [key]: { url: null, sig, status: "error", error: errText(e) ?? "تعذر إنشاء المعاينة" } } : p));
      return false;
    } finally {
      if (live()) { previewingRef.current = false; setPreviewing(false); }
    }
  }
  async function previewAll() {
    const live = capture(); const sig = designSig; const id = work?.id;
    for (const [w, s] of COMBOS) {
      // Stop as soon as scope, draft or design moved; never continue a previous company's run.
      if (!live() || sigRef.current !== sig || workIdRef.current !== id) return;
      const ok = await preview(w, s);
      if (!ok) return;
    }
  }

  const allPreviewed = COMBOS.every(([w, s]) => previews[`${w}:${s}`]?.status === "ok" && previews[`${w}:${s}`]?.sig === designSig);
  const canPublish = !!work && !!work.saved && !dirty && work.revision > 0 && allPreviewed && !pending && !busy && !previewing && !revoked && !conflict;

  async function publish() {
    if (!work || !state || !canPublish) return;
    const live = capture();
    const body = { expectedCompanyId: companyId, branchId, id: work.id, expectedRevision: work.revision, expectedActiveRevision: state.revision, expectedParentRevision: state.parentRevision, requestId: uuid() };
    const r = await runPending({ kind: "publish", label: "نشر المسودة", body }, live);
    if (r.ok) { toast({ title: "نُشر التصميم وأصبح فعالًا لهذا النطاق" }); void load({ silent: true }); }
  }
  async function activate(releaseId: string | null) {
    if (!state || pending) return;
    const live = capture();
    const body = { expectedCompanyId: companyId, branchId, releaseId, expectedActiveRevision: state.revision, expectedParentRevision: state.parentRevision, requestId: uuid() };
    const r = await runPending({ kind: "activate", label: releaseId ? "استعادة إصدار" : branchId ? "العودة للوراثة" : "العودة للتصميم الكلاسيكي", body }, live);
    if (r.ok) { toast({ title: releaseId ? "فُعّل الإصدار المختار" : branchId ? "الفرع يرث تصميم المنشأة الآن" : "عادت المنشأة إلى التصميم الكلاسيكي" }); void load({ silent: true }); }
  }
  async function retryPending() {
    const p = pendingRef.current; if (!p) return;
    const live = capture();
    const r = await runPending(p, live); // identical body, identical requestId
    if (!r.ok) return;
    if (p.kind === "save") afterSave(r.result as { revision?: number }, (p.body as { design: EditorDesign }).design);
    else { toast({ title: "تأكدت العملية" }); void load({ silent: true }); }
  }
  /** Reloads server state for inspection only; the pending request stays until an identical retry resolves it. */
  async function verifyPending() {
    if (!pendingRef.current || busyRef.current) return;
    setBusy("verify");
    const live = capture();
    const s = await load();
    if (!live()) return;
    setBusy(null);
    if (s) toast({ title: "حُدّثت حالة الخادم", description: "الطلب المعلّق باقٍ. أعد الطلب نفسه لتأكيد نتيجته؛ إن كان قد نُفّذ فسيعيد الخادم النتيجة نفسها." });
  }

  async function resolveConflict(mode: "reload" | "keep") {
    const s = await load(); if (!s) return;
    setConflict(null);
    if (!work) return;
    const d = s.drafts.find(x => x.id === work.id);
    if (mode === "reload") { if (d) open({ id: d.id, revision: d.revision, design: d.design, saved: d.design }); else setWork(null); }
    else setWork(w => (w ? { ...w, revision: d?.revision ?? w.revision, saved: d?.design ?? w.saved } : w));
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file || !work) return;
    const reset = () => { if (fileRef.current) fileRef.current.value = ""; };
    if (file.size > 2 * 1024 * 1024) { toast({ title: "الحد الأقصى 2MB", variant: "destructive" }); reset(); return; }
    if (!["image/png", "image/jpeg"].includes(file.type)) { toast({ title: "يُقبل PNG أو JPEG فقط", variant: "destructive" }); reset(); return; }
    const live = capture(); const forId = work.id;
    const reader = new FileReader();
    reader.onload = async () => {
      if (!live()) return;
      try {
        const r = await upload.mutateAsync({ data: { contentBase64: String(reader.result).replace(/^data:[^,]*,/, ""), expectedCompanyId: companyId, branchId } });
        if (!live()) return;
        setWork(w => {
          if (!w || w.id !== forId) return w;
          setPast(p => [...p.slice(-49), w.design]); setFuture([]);
          return { ...w, design: { ...w.design, base: { ...w.design.base, logoMode: "custom", logoObjectKey: r.objectKey } } };
        });
        toast({ title: "رُفع الشعار في المسودة؛ احفظ لتثبيته" });
      } catch (err) { if (live()) toast({ title: "فشل رفع الشعار", description: errText(err), variant: "destructive" }); }
      finally { reset(); }
    };
    reader.readAsDataURL(file);
  }

  const activeRelease = useMemo(() => state?.releases.find(r => r.id === state.activeId) ?? null, [state]);
  const sourceLabel = state ? ({ branch: "تصميم خاص بالفرع", company: branchId ? "موروث من المنشأة" : "تصميم المنشأة", legacy: "التصميم الكلاسيكي" } as const)[state.source] : "";
  const scopeLabel = branchId ? "هذا الفرع فقط" : "المنشأة وكل فرع يرث تصميمها";

  if (revoked) {
    return <Card data-testid="invoice-editor-revoked"><CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><Lock className="size-4" />لم تعد تملك صلاحية محرر الفواتير لهذا النطاق. أُغلقت المسودة والمعاينات.</CardContent></Card>;
  }
  if (!state) {
    if (loadErr) return <Card data-testid="invoice-editor-error"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-6 text-sm" role="alert"><span>{loadErr}</span><Button size="sm" variant="outline" onClick={() => void load()} data-testid="button-retry-invoice-editor"><RefreshCw className="me-1 size-4" />إعادة المحاولة</Button></CardContent></Card>;
    return <Card data-testid="invoice-editor-loading"><CardContent className="space-y-3 p-6"><Skeleton className="h-6 w-1/4" /><Skeleton className="h-24" /></CardContent></Card>;
  }

  const d = work?.design;
  const problems = d ? validateDesign(d) : [];
  const locked = !!pending || !!busy || previewing;
  const shownSlot = previews[shown];

  return (
    <Card ref={rootRef} className="overflow-hidden" data-testid="invoice-editor">
      <AlertDialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null); }}>
        <AlertDialogContent dir="rtl"><AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{confirm?.description}</AlertDialogDescription>
        </AlertDialogHeader><AlertDialogFooter>
          <AlertDialogCancel data-testid="button-editor-confirm-cancel">إلغاء</AlertDialogCancel>
          <AlertDialogAction data-testid="button-editor-confirm" onClick={() => { const r = confirm?.run; setConfirm(null); r?.(); }}>{confirm?.action}</AlertDialogAction>
        </AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <CardHeader className="border-b bg-gradient-to-l from-primary/[0.06] to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Layers className="size-5 text-primary" /> المحرر المتقدم للفاتورة</CardTitle>
            <CardDescription className="mt-1 max-w-2xl">مسودات بإصدارات: رتّب الأقسام وخصّص A4 و80 مم كلٌّ على حدة. المحرر يغيّر الشكل فقط؛ الأرقام والضرائب ورمز QR تأتي من الفاتورة كما هي.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={state.source === "legacy" ? "secondary" : "default"} data-testid="status-editor-source">{sourceLabel}</Badge>
            <Badge variant="outline" data-testid="text-editor-active">{activeRelease ? `الفعّال: ${activeRelease.design.name} (إصدار ${activeRelease.revision})` : "لا إصدار فعّال من المحرر"}</Badge>
            {state.source !== "legacy" && <p className="w-full text-xs text-amber-700 dark:text-amber-400" data-testid="text-editor-overrides-classic">إصدار المحرر هو الفعّال لهذا النطاق. تعديلات لوحة التصميم الكلاسيكية أعلاه تُحفظ لكنها لا تظهر في الفواتير إلا بعد {branchId ? "عودة الفرع للوراثة ثم عودة المنشأة" : "العودة"} للتصميم الكلاسيكي.</p>}
            <Badge variant="outline" className="font-mono" data-testid="text-editor-revision">r{state.revision}{branchId ? ` / p${state.parentRevision}` : ""}</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-4 md:p-6">
        {pending && busy !== pending.kind && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="banner-editor-pending">
            <span className="flex items-center gap-2"><AlertTriangle className="size-4" />لم تصل نتيجة «{pending.label}» وقد يكون الخادم نفّذه. الإعادة ترسل الطلب نفسه بالمعرّف نفسه، والتحرير مقفل حتى تتأكد النتيجة.</span>
            <span className="flex gap-2">
              <Button size="sm" disabled={!!busy} onClick={() => void retryPending()} data-testid="button-editor-retry-pending"><RefreshCw className="me-1 size-4" />إعادة الطلب نفسه</Button>
              <Button size="sm" variant="ghost" onClick={() => void verifyPending()} data-testid="button-editor-verify-pending">تحقق من الحالة</Button>
            </span>
          </div>
        )}
        {conflict && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm" data-testid="banner-editor-conflict">
            <span className="flex items-center gap-2"><AlertTriangle className="size-4 text-destructive" />تغيرت النسخة على الخادم ({conflict}). تعديلاتك محفوظة هنا ولم يُفقد شيء.</span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void resolveConflict("reload")} data-testid="button-conflict-reload">تحميل نسخة الخادم</Button>
              <Button size="sm" onClick={() => void resolveConflict("keep")} data-testid="button-conflict-keep">الإبقاء على تعديلاتي</Button>
            </span>
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between"><Label className="font-semibold">مسودات هذا النطاق</Label><span className="text-xs text-muted-foreground">{state.drafts.length}</span></div>
            {state.drafts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground" data-testid="empty-editor-drafts">لا مسودات بعد. ابدأ بنسخة من أحد الأنماط.</p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-auto">
                {state.drafts.map(x => (
                  <li key={x.id}>
                    <button type="button" disabled={locked} onClick={() => openDraft(x.id)} data-testid={`button-open-draft-${x.id}`}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-start text-sm transition-colors hover:bg-muted disabled:opacity-50 ${work?.id === x.id ? "bg-primary/10 font-semibold text-primary" : ""}`}>
                      <span className="truncate">{x.design.name}</span><span className="font-mono text-xs text-muted-foreground">r{x.revision}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border p-3">
            <Label className="mb-2 block font-semibold">مسودة جديدة من نمط</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {PRESETS.map(p => (
                <button key={p} type="button" disabled={locked} onClick={() => copyPreset(p)} data-testid={`button-copy-preset-${p}`}
                  className="group flex flex-col items-start gap-1.5 rounded-md border p-2 text-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-sm disabled:opacity-50">
                  <span className="h-1.5 w-8 rounded-full" style={{ background: PRESET_ACCENT[p] }} />
                  <span className="flex items-center gap-1"><Copy className="size-3 text-muted-foreground" />{PRESET_LABEL[p]}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {!work || !d ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground" data-testid="empty-editor-workspace">
            <Layers className="size-8 opacity-60" />افتح مسودة أو أنشئ واحدة من نمط لبدء التحرير.
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
            <fieldset className="min-w-0 space-y-5 disabled:opacity-80" disabled={locked} data-testid="fieldset-invoice-editor">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1">
                  <Label htmlFor="ed-name">اسم التصميم <span className="text-xs text-muted-foreground">({d.name.length}/80)</span></Label>
                  <Input id="ed-name" maxLength={80} value={d.name} onChange={e => edit(x => ({ ...x, name: e.target.value }))} data-testid="input-editor-name" />
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="icon" disabled={!past.length || locked} onClick={undo} aria-label="تراجع" data-testid="button-editor-undo"><Undo2 className="size-4" /></Button>
                  <Button type="button" variant="outline" size="icon" disabled={!future.length || locked} onClick={redo} aria-label="إعادة" data-testid="button-editor-redo"><Redo2 className="size-4" /></Button>
                </div>
                {dirty && <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400" data-testid="status-editor-dirty">غير محفوظ</Badge>}
                {work.revision === 0 && <Badge variant="secondary" data-testid="status-editor-new">مسودة جديدة</Badge>}
              </div>

              <section className="space-y-4 rounded-lg border p-3">
                <Label className="font-semibold">الأساس المشترك</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">النمط</Label>
                    <div className="mt-1"><Seg value={d.base.preset} onChange={v => setBase("preset", v)} testId="seg-editor-preset" options={PRESETS.map(p => [p, PRESET_LABEL[p]])} /></div>
                  </div>
                  <div>
                    <Label htmlFor="ed-accent" className="text-xs">لون التمييز</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <input type="color" value={HEX.test(d.base.accent) ? d.base.accent : "#285886"} onChange={e => setBase("accent", e.target.value)} className="h-9 w-12 cursor-pointer rounded border bg-transparent" aria-label="اختيار اللون" data-testid="input-editor-accent-picker" />
                      <Input id="ed-accent" dir="ltr" maxLength={7} value={d.base.accent} onChange={e => setBase("accent", e.target.value)} aria-invalid={!HEX.test(d.base.accent)} className={HEX.test(d.base.accent) ? "font-mono" : "border-destructive font-mono"} data-testid="input-editor-accent" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">الخط</Label>
                    <div className="mt-1"><Seg value={d.base.font} onChange={v => setBase("font", v)} testId="seg-editor-font" options={[["Tajawal", "Tajawal"], ["sans-serif", "خط النظام"]]} /></div>
                  </div>
                  <div>
                    <Range id="ed-fs" label="حجم خط A4" unit="نقطة" value={d.base.fontSize} min={11} max={16} onChange={v => setBase("fontSize", v)} testId="input-editor-font-size" />
                    <p className="mt-1 text-[11px] text-muted-foreground" data-testid="text-thermal-font-note">يطبق على A4 فقط؛ الإيصال الحراري 80 مم يستخدم حجمًا ثابتًا مقروءًا.</p>
                  </div>
                </div>
                <div className="space-y-3 rounded-md bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-xs">الشعار</Label>
                    <Seg value={d.base.logoMode} onChange={v => setBase("logoMode", v)} testId="seg-editor-logo-mode" options={[["identity", "شعار الهوية"], ["custom", "مخصص"], ["none", "بلا شعار"]]} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-xs">الموضع</Label>
                    <Seg value={d.base.logoPosition} disabled={d.base.logoMode === "none"} onChange={v => setBase("logoPosition", v)} testId="seg-editor-logo-position" options={[["start", "البداية"], ["center", "الوسط"], ["end", "النهاية"]]} />
                  </div>
                  <Range id="ed-lw" label="عرض الشعار" unit="مم" value={d.base.logoWidth} min={18} max={48} disabled={d.base.logoMode === "none"} onChange={v => setBase("logoWidth", v)} testId="input-editor-logo-width" />
                  {d.base.logoMode === "custom" && (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`text-xs ${d.base.logoObjectKey ? "text-primary" : "text-destructive"}`} data-testid="status-editor-logo">{d.base.logoObjectKey ? "شعار مرفوع لهذه المسودة" : "لم يُرفع شعار بعد"}</span>
                      <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFile} data-testid="input-editor-logo-file" />
                      <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => fileRef.current?.click()} data-testid="button-editor-upload-logo">
                        {upload.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Upload className="me-2 size-4" />}رفع PNG/JPEG
                      </Button>
                    </div>
                  )}
                </div>
                <div className="grid gap-3">
                  <div><Label className="text-xs">الترويسة ({d.base.header.length}/250)</Label><Input maxLength={250} value={d.base.header} onChange={e => setBase("header", e.target.value)} data-testid="input-editor-header" /></div>
                  <div><Label className="text-xs">التذييل ({d.base.footer.length}/500)</Label><Textarea rows={2} maxLength={500} value={d.base.footer} onChange={e => setBase("footer", e.target.value)} data-testid="input-editor-footer" /></div>
                  <div><Label className="text-xs">ملاحظة ({d.base.note.length}/1000)</Label><Textarea rows={2} maxLength={1000} value={d.base.note} onChange={e => setBase("note", e.target.value)} data-testid="input-editor-note" /></div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center justify-between rounded-md border p-2.5 text-sm">بيانات التواصل<Switch checked={d.base.showContact} onCheckedChange={v => setBase("showContact", v)} data-testid="switch-editor-contact" /></label>
                    <label className="flex items-center justify-between rounded-md border p-2.5 text-sm">البيانات البنكية<Switch checked={d.base.showBank} onCheckedChange={v => setBase("showBank", v)} data-testid="switch-editor-bank" /></label>
                    <label className="flex items-center justify-between rounded-md border p-2.5 text-sm">اسم البائع<Switch checked={d.base.showSeller!==false} onCheckedChange={v => setBase("showSeller", v)} data-testid="switch-editor-seller" /></label>
                    <label className="flex items-center justify-between rounded-md border p-2.5 text-sm">اسم المحصل<Switch checked={d.base.showCashier!==false} onCheckedChange={v => setBase("showCashier", v)} data-testid="switch-editor-cashier" /></label>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border p-3">
                <Tabs value={layoutTab} onValueChange={v => setLayoutTab(v as LayoutKey)}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <Label className="font-semibold">التخطيط حسب المقاس</Label>
                    <TabsList>
                      <TabsTrigger value="a4" data-testid="tab-layout-a4">A4</TabsTrigger>
                      <TabsTrigger value="thermal80" data-testid="tab-layout-80">حراري 80 مم</TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="a4"><LayoutEditor k="a4" value={d.a4} onChange={l => edit(x => ({ ...x, a4: l }))} /></TabsContent>
                  <TabsContent value="thermal80"><LayoutEditor k="thermal80" value={d.thermal80} onChange={l => edit(x => ({ ...x, thermal80: l }))} /></TabsContent>
                </Tabs>
              </section>

              {problems.length > 0 && (
                <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive" role="alert" data-testid="list-editor-problems">
                  {problems.map(p => <li key={p}>{p}</li>)}
                </ul>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
                {dirty && work.saved && <Button variant="ghost" onClick={() => guardSwitch(() => open({ ...work, design: work.saved! }))} data-testid="button-editor-discard"><Undo2 className="me-2 size-4" />تجاهل التعديلات</Button>}
                <Button disabled={!dirty || problems.length > 0} onClick={() => void save()} data-testid="button-editor-save">
                  {busy === "save" ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}حفظ المسودة
                </Button>
              </div>
            </fieldset>

            <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold">خطوات النشر</span>
                  <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">عينة تجريبية</Badge>
                </div>
                <ol className="space-y-1.5 text-sm" data-testid="list-publish-steps">
                  <li className="flex items-center gap-2" data-testid="step-saved">{work.saved && !dirty ? <CheckCircle2 className="size-4 text-primary" /> : <Circle className="size-4 text-muted-foreground" />}حفظ المسودة دون تعديلات معلقة</li>
                  {COMBOS.map(([w, s]) => {
                    const slot = previews[`${w}:${s}`]; const k = `${w}:${s}`;
                    return (
                      <li key={k} className="flex items-center gap-2">
                        {slot?.status === "ok" ? <CheckCircle2 className="size-4 text-primary" /> : slot?.status === "loading" ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : slot?.status === "error" ? <AlertTriangle className="size-4 text-destructive" /> : <Circle className="size-4 text-muted-foreground" />}
                        <button type="button" className={`flex-1 text-start hover:underline ${shown === k ? "font-semibold" : ""}`} onClick={() => setShown(k)} data-testid={`button-show-preview-${w}-${s}`}>
                          معاينة {w === "a4" ? "A4" : "80 مم"} — {s === "short" ? "قصيرة" : "طويلة"}
                        </button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" disabled={locked || problems.length > 0} onClick={() => void preview(w, s)} data-testid={`button-preview-${w}-${s}`}><Eye className="size-3.5" /></Button>
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" className="flex-1" disabled={locked || problems.length > 0} onClick={() => void previewAll()} data-testid="button-preview-all"><Eye className="me-2 size-4" />إنشاء المعاينات الأربع</Button>
                  <Button disabled={!canPublish} data-testid="button-editor-publish"
                    onClick={() => setConfirm({
                      title: `نشر «${d.name}» وتفعيله`,
                      description: `النطاق: ${scopeLabel}.\nستُطبع الفواتير الجديدة والمعاد طباعتها لهذا النطاق بهذا التصميم فور النشر. الأرقام والضرائب لا تتغير.\nيمكنك لاحقًا استعادة إصدار سابق.`,
                      action: "نشر وتفعيل", run: () => void publish(),
                    })}>
                    {busy === "publish" ? <Loader2 className="me-2 size-4 animate-spin" /> : <Rocket className="me-2 size-4" />}نشر
                  </Button>
                </div>
                {!canPublish && <p className="mt-2 text-xs text-muted-foreground" data-testid="text-publish-hint">{dirty || !work.saved ? "احفظ المسودة أولًا." : !allPreviewed ? "يتطلب النشر نجاح المعاينات الأربع لنسخة المسودة المحفوظة." : "النشر غير متاح الآن."} الخادم يتحقق من ذلك أيضًا.</p>}
              </div>

              <div className={`relative overflow-hidden rounded-lg border bg-muted/30 ${shown.startsWith("80") ? "mx-auto max-w-[300px]" : ""}`} style={{ height: 520 }}>
                {shownSlot?.status === "loading" && <Skeleton className="absolute inset-0" />}
                {shownSlot?.status === "ok" && shownSlot.url && <iframe title="معاينة المحرر" src={shownSlot.url} className="size-full animate-in fade-in duration-300" data-testid="iframe-editor-preview" />}
                {(!shownSlot || shownSlot.status === "error") && (
                  <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground" role={shownSlot?.status === "error" ? "alert" : undefined} data-testid={shownSlot?.status === "error" ? "editor-preview-error" : "editor-preview-empty"}>
                    {shownSlot?.status === "error" ? <span className="text-destructive">{shownSlot.error}</span> : <>لا معاينة حالية لهذا المقاس والعينة. أي تعديل يزيل المعاينات القديمة.</>}
                  </div>
                )}
              </div>
              {shownSlot?.status === "ok" && shownSlot.url && (
                <Button variant="outline" size="sm" className="w-full" asChild data-testid="button-editor-download-preview">
                  <a href={shownSlot.url} download={`invoice-editor-${shown.replace(":", "-")}.pdf`}><Download className="me-2 size-4" />تنزيل ملف المعاينة</a>
                </Button>
              )}
            </aside>
          </div>
        )}

        <section className="rounded-lg border p-3" data-testid="section-editor-releases">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Label className="flex items-center gap-2 font-semibold"><History className="size-4" />الإصدارات المنشورة للمنشأة</Label>
            {(state.source !== "legacy" || (!!branchId && state.parentRevision > 0)) && (
              <Button size="sm" variant="outline" disabled={locked} data-testid="button-editor-inherit"
                onClick={() => setConfirm({
                  title: branchId ? "العودة لوراثة تصميم المنشأة" : "العودة للتصميم الكلاسيكي",
                  description: branchId ? "سيتوقف هذا الفرع عن استخدام إصداره الخاص ويرث تصميم المنشأة الفعّال. المنشأة والفروع الأخرى لا تتأثر." : "ستعود فواتير المنشأة والفروع الوارثة إلى تصميم القوالب الكلاسيكي. الإصدارات تبقى متاحة للاستعادة.",
                  action: "تأكيد", run: () => void activate(null),
                })}>{branchId ? "وراثة تصميم المنشأة" : "العودة للكلاسيكي"}</Button>
            )}
          </div>
          {state.releases.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground" data-testid="empty-editor-releases">لم يُنشر أي إصدار بعد.</p>
          ) : (
            <ul className="divide-y">
              {state.releases.map(r => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid={`row-release-${r.id}`}>
                  <span className="flex-1 truncate">{r.design.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">إصدار {r.revision}</span>
                  {r.id === state.activeId ? <Badge data-testid={`status-release-active-${r.id}`}>فعّال</Badge> : (
                    <Button size="sm" variant="ghost" disabled={locked} data-testid={`button-restore-release-${r.id}`}
                      onClick={() => setConfirm({ title: `استعادة «${r.design.name}»`, description: `النطاق: ${scopeLabel}.\nسيصبح هذا الإصدار فعّالًا فورًا لهذا النطاق.`, action: "استعادة وتفعيل", run: () => void activate(r.id) })}>
                      <History className="me-1 size-3.5" />استعادة
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={locked} onClick={() => copyRelease(r.id)} data-testid={`button-copy-release-${r.id}`}><Copy className="me-1 size-3.5" />نسخ لمسودة</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
