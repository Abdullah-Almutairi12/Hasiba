import { useEffect, useState } from "react";
import { CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { listScopedIntents, useAct, useActorScope } from "@/hooks/use-returns-actions";
import { Empty, ErrorBox, Pill } from "@/components/returns/ui";
import { label, METHODS, money, num, str, type ErrInfo, type Rec } from "@/lib/returns/shared";

export function ApproveButton({ noteId }: { noteId: string }) {
  const { run, pending } = useAct();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<ErrInfo | null>(null);
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><CheckCircle2 className="me-1 size-4" /> اعتماد الإرجاع</Button>;
  return (
    <div className="w-full space-y-2 rounded-xl bg-muted/50 p-3">
      <Label>تعليق الاعتماد</Label>
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="سبب الاعتماد، ما تم التحقق منه" />
      {err && <ErrorBox err={err} onClose={() => setErr(null)} />}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !comment.trim()} onClick={async () => {
          setErr(null);
          const r = await run("approve", { noteId: Number(noteId), comment: comment.trim() });
          if (r.ok) { toast({ title: "أُرسل الاعتماد — الحالة من الخادم" }); setOpen(false); } else setErr(r.err);
        }}>{pending ? "جارٍ الإرسال..." : "تأكيد الاعتماد"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
      </div>
    </div>
  );
}

export function PayoutsTab({ payouts, notes, can }: { payouts: Rec[]; notes: Rec[]; can: (c: string) => boolean }) {
  if (payouts.length === 0) return <Empty title="لا توجد عمليات صرف" hint="عمليات الصرف النقدي وطلبات الاسترداد غير النقدية تظهر هنا بحالتها الفعلية." />;
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      {payouts.map((p) => {
        const st = str(p.status).toLowerCase();
        const nonCash = str(p.method) !== "cash";
        const open = st === "requested" || st.includes("pending");
        const ref = notes.find((n) => str(n.id) === str(p.note_id));
        return (
          <div key={str(p.id)} className="border-b border-border bg-card p-4 last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-semibold">صرف #{str(p.id)}</span>
              <Pill status={str(p.status)} />
              <span className="font-bold tabular-nums">{money(p.amount)}</span>
              <span className="text-sm text-muted-foreground">{label(METHODS, str(p.method))}</span>
              <span className="text-xs text-muted-foreground">إشعار <span dir="ltr">{str(ref?.reference, `#${str(p.note_id)}`)}</span></span>
              {p.invoice_id != null && <a href={`${import.meta.env.BASE_URL}api/sales/invoices/${encodeURIComponent(str(p.invoice_id))}/pdf`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">فاتورة #{str(p.invoice_id)}</a>}
              {str(p.reference) && <span className="text-xs" dir="ltr">{str(p.reference)}</span>}
              <span className="text-xs text-muted-foreground">بواسطة {str(p.created_by, "—")}{str(p.confirmed_by) && ` · أكده ${str(p.confirmed_by)}`}</span>
            </div>
            {nonCash && open && <p className="mt-1 text-xs text-violet-700 dark:text-violet-300">مطلوب فقط — لم يُرسل لأي مزود ولم تثبت تسويته.</p>}
            {open && (
              <div className="mt-2 flex flex-wrap gap-2">
                {nonCash && can("external") && <ConfirmExternal payoutId={str(p.id)} />}
                {can("payout") && <CancelPayout payoutId={str(p.id)} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InlineAction({ trigger, title, fieldLabel, hint, onSubmit, ltr }: {
  trigger: string; title: string; fieldLabel: string; hint: string; ltr?: boolean;
  onSubmit: (v: string) => Promise<{ ok: boolean; err?: ErrInfo }>;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ErrInfo | null>(null);
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{trigger}</Button>;
  return (
    <div className="w-full space-y-2 rounded-xl bg-muted/50 p-3">
      <p className="text-sm font-semibold">{title}</p>
      <Label>{fieldLabel}</Label>
      <Input value={v} onChange={(e) => setV(e.target.value)} dir={ltr ? "ltr" : "rtl"} />
      <p className="text-xs text-muted-foreground">{hint}</p>
      {err && <ErrorBox err={err} onClose={() => setErr(null)} />}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !v.trim()} onClick={async () => {
          setBusy(true); setErr(null);
          const r = await onSubmit(v.trim());
          setBusy(false);
          if (r.ok) setOpen(false); else if (r.err) setErr(r.err);
        }}>{busy ? "جارٍ الإرسال..." : "تأكيد"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
      </div>
    </div>
  );
}

function ConfirmExternal({ payoutId }: { payoutId: string }) {
  const { run } = useAct();
  const { toast } = useToast();
  return <InlineAction trigger="توثيق رد خارجي" title="توثيق رد خارجي يدوي بدليل" fieldLabel="مرجع الدليل (رقم عملية البنك / إشعار العكس)" ltr
    hint="أدخل مرجعًا من مستند فعلي رأيته. هذا لا يتواصل مع أي مزود."
    onSubmit={async (reference) => { const r = await run("confirm_external", { payoutId: Number(payoutId), reference }); if (r.ok) toast({ title: "سُجّل توثيق الرد الخارجي — ليس تأكيدًا من مزود" }); return r; }} />;
}
function CancelPayout({ payoutId }: { payoutId: string }) {
  const { run } = useAct();
  const { toast } = useToast();
  return <InlineAction trigger="إلغاء الصرف" title="إلغاء طلب الصرف" fieldLabel="سبب الإلغاء"
    hint="يعيد المبلغ المحجوز إلى المستحق بعد قبول الخادم."
    onSubmit={async (reason) => { const r = await run("cancel_payout", { payoutId: Number(payoutId), reason }); if (r.ok) toast({ title: "أُرسل الإلغاء" }); return r; }} />;
}

export function CloseForm({ sessionId, expected }: { sessionId: string; expected: number }) {
  const { run, pending } = useAct();
  const scope = useActorScope();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [err, setErr] = useState<ErrInfo | null>(null);
  const [blocked, setBlocked] = useState(true);
  const hasUnconfirmed = () => {
    if (!scope) return true;
    try {
      return sessionStorage.getItem(`hasba:pos-checkout:${scope}`) !== null || listScopedIntents(scope).length > 0;
    } catch { return true; }
  };
  useEffect(() => {
    if (!open) return;
    const refresh = () => setBlocked(hasUnconfirmed());
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [open, scope]);
  if (!open) return <Button size="sm" className="mt-3" variant="outline" onClick={() => setOpen(true)}><Lock className="me-1 size-4" /> إغلاق الوردية</Button>;
  const c = num(counted);
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-muted/50 p-3">
      <Label>النقد المعدود فعليًا في الدرج</Label>
      <Input type="number" inputMode="decimal" step="0.01" min={0} value={counted} onChange={(e) => setCounted(e.target.value)} />
      <Label>ملاحظة / سبب أي فرق</Label>
      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-4" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        <span>راجعت كل عمليات الدفع ذات النتيجة غير المعروفة في هذه الوردية وحُسمت.</span>
      </label>
      <p className="text-[11px] text-muted-foreground">أي فرق غير صفري ينشئ إغلاقًا معلقًا يحتاج اعتماد شخص آخر.</p>
      {blocked && <p className="text-sm text-amber-700">احسم المحاولات غير المؤكدة أولًا من لوحة الاستعادة أو من <a className="underline" href={`${import.meta.env.BASE_URL}pos`}>نقاط البيع</a>. تعذّر قراءة الحافظة يمنع الإغلاق أيضًا.</p>}
      {err && <ErrorBox err={err} onClose={() => setErr(null)} />}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || blocked || c === null || c < 0 || !reviewed || (c !== expected && !reason.trim())} onClick={async () => {
          setErr(null);
          if (hasUnconfirmed()) { setBlocked(true); return; }
          const r = await run("close", { sessionId: Number(sessionId), counted: c, reason: reason.trim(), unresolvedSalesCleared: true });
          if (r.ok) { toast({ title: "أُرسل الإغلاق — راجع حالته" }); setOpen(false); } else setErr(r.err);
        }}>{pending ? "جارٍ الإرسال..." : "تأكيد الإغلاق"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
      </div>
    </div>
  );
}

export function ApproveClose({ sessionId }: { sessionId: string }) {
  const { run, pending } = useAct();
  const { toast } = useToast();
  const [err, setErr] = useState<ErrInfo | null>(null);
  return (
    <div className="space-y-2">
      <Button size="sm" disabled={pending} onClick={async () => {
        setErr(null);
        const r = await run("approve_close", { sessionId: Number(sessionId) });
        if (r.ok) toast({ title: "أُرسل اعتماد الإغلاق" }); else setErr(r.err);
      }}>اعتماد الإغلاق بالفرق</Button>
      {err && <ErrorBox err={err} onClose={() => setErr(null)} />}
    </div>
  );
}

