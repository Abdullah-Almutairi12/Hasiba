import { AlertTriangle, ClipboardCheck, Copy, ShieldAlert, X, type LucideIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { statusTone, str, type ErrInfo, type Rec } from "@/lib/returns/shared";

export function Pill({ status }: { status: string }) {
  const t = statusTone(status);
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", t.cls)} title={status}>{t.text}</span>;
}

export function ErrorBox({ err, onClose }: { err: ErrInfo; onClose?: () => void }) {
  const { toast } = useToast();
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-words">{err.message}{err.status ? ` (${err.status})` : " (لا توجد استجابة مؤكدة)"}</p>
        {err.diagnosticRef && (
          <div className="flex items-center gap-2 text-xs">
            <span>المرجع التشخيصي:</span>
            <code dir="ltr" className="rounded bg-white/70 px-1.5 py-0.5 font-mono dark:bg-black/30">{err.diagnosticRef}</code>
            <button type="button" className="inline-flex items-center gap-1 underline"
              onClick={() => { void navigator.clipboard?.writeText(err.diagnosticRef).then(() => toast({ title: "نُسخ المرجع" }), () => undefined); }}>
              <Copy className="size-3" /> نسخ
            </button>
          </div>
        )}
      </div>
      {onClose && <button type="button" onClick={onClose} aria-label="إغلاق"><X className="size-4" /></button>}
    </div>
  );
}

/** Banner for a stored attempt whose outcome the server has not confirmed. */
export function FrozenNotice({ what, body }: { what: string; body: Rec }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="flex items-center gap-1.5 font-semibold"><ShieldAlert className="size-4" /> {what} بنتيجة غير مؤكدة — مجمّد</p>
      <p className="mt-1">لم تصل استجابة نهائية. لا تكرر العملية يدويًا ولا تسلّم نقدًا إضافيًا. أعد إرسال الطلب نفسه بنفس المفتاح حتى يؤكد الخادم النتيجة.</p>
      <p className="mt-1 font-mono text-[10px] opacity-70" dir="ltr">key: {str(body.idempotencyKey)}</p>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <ClipboardCheck className="mb-3 size-8 text-muted-foreground" />
      <p className="font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

export function Fig({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground">{l}</div>
      <div className={cn("tabular-nums", strong ? "text-sm font-bold text-primary" : "font-medium")}>{v}</div>
    </div>
  );
}

export function Stat({ icon: I, label: l, value, tone }: { icon: LucideIcon; label: string; value: string; tone?: "amber" | "sky" }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <div className={cn("grid size-10 place-items-center rounded-xl", tone === "amber" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : tone === "sky" ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" : "bg-primary/10 text-primary")}>
        <I className="size-5" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{l}</div>
        <div className="text-lg font-bold tabular-nums">{value}</div>
      </div>
    </div>
  );
}
