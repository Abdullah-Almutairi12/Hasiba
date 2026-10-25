import { useState } from "react";
import { Link } from "wouter";
import { useAcceptAdministrationHandover, useCompleteAdministrationHandover, useGetAdministrationReceipt, getGetAdministrationReceiptQueryKey, type AdministrationHandover } from "@workspace/api-client-react";
import { CheckCircle2, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorStatus, errorText } from "@/lib/team-access";
import { DEPARTURE_LABEL, stateMeta, writeEvidence, readAllEvidence, clearEvidence, StatePill, HandoverDetails, type FinalizeEvidence } from "@/components/administration/shared";

export function IncomingCard({ h, onChanged }: { h: AdministrationHandover; onChanged: () => void }) {
  const { toast } = useToast();
  const accept = useAcceptAdministrationHandover();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const canAccept = h.state !== "accepted" && h.state !== "completed" && h.state !== "cancelled";
  const run = async () => {
    try {
      await accept.mutateAsync({ id: h.id, data: { expectedRevision: h.revision } });
      toast({ title: "قبلت الاستلام — بانتظار تنفيذ المرسل" });
      setOpen(false);
    } catch (err) {
      toast({ title: "تعذر القبول", description: errorText(err), variant: "destructive" });
    } finally { onChanged(); }
  };
  return (
    <article className="rounded-xl border p-4 transition-colors hover:border-primary/40" data-testid={`card-incoming-${h.id}`}>
      <div className="mb-3 flex items-center justify-between gap-2"><StatePill state={h.state} testId={`status-incoming-${h.id}`} />{h.owner_transfer ? <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid={`badge-owner-transfer-incoming-${h.id}`}>نقل مالك النظام · تحكم مالي كامل</span> : <span className="text-[11px] text-muted-foreground">تسليم إدارة عادي</span>}</div>
      <HandoverDetails h={h} />
      {canAccept && <Button size="sm" className="mt-3" onClick={() => { setAck(false); setOpen(true); }} data-testid={`button-review-accept-${h.id}`}><ShieldCheck className="me-2 size-4" /> مراجعة وقبول</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader><DialogTitle>قبول استلام الإدارة</DialogTitle><DialogDescription>راجع التفاصيل كاملة. القبول لنسخة المراجعة {h.revision} فقط؛ أي تعديل لاحق يُلغيه.</DialogDescription></DialogHeader>
          <HandoverDetails h={h} />
          <label className="mt-2 flex items-start gap-2 text-sm"><Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="checkbox-accept-ack" /> أفهم أنني سأتحمل هذه المسؤوليات الإدارية بعد أن ينفذ المرسل التسليم.</label>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button disabled={!ack || accept.isPending} onClick={() => void run()} data-testid="button-confirm-accept">{accept.isPending && <Loader2 className="me-2 size-4 animate-spin" />} أقبل الاستلام</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export function OutgoingCard({ h, userId, companyId, onEdit, onChanged }: { h: AdministrationHandover; userId: number; companyId: number | null; onEdit: () => void; onChanged: () => void }) {
  const complete = useCompleteAdministrationHandover();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck] = useState(false);
  const [done, setDone] = useState<{ departure: string } | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const dep = DEPARTURE_LABEL[h.departure];
  const finalize = async () => {
    const prior=readAllEvidence(userId).find(e=>e.id===h.id);
    if(prior) {setUnknown("توجد محاولة محفوظة؛ استعد نفس التنفيذ أو تحقق من إيصاله قبل أي محاولة أخرى.");return;}
    const ev: FinalizeEvidence = { id: h.id, revision: h.revision, departure: h.departure, at: new Date().toISOString(), companyId };
    try { writeEvidence(userId, ev); } catch { toast({ title: "تعذر حفظ دليل التنفيذ على الجهاز — لم يُرسل الطلب", variant: "destructive" }); return; }
    setConfirm(false); setUnknown(null);
    try {
      const r = await complete.mutateAsync({ id: h.id, data: { expectedRevision: h.revision } });
      if (r.ok) { clearEvidence(userId, ev); setDone({ departure: r.departure }); }
      else setUnknown("لم يؤكد الخادم التنفيذ.");
    } catch (err) {
      const s = errorStatus(err);
      if (s === 409 || s === 403 || s === 422 || s === 400) { clearEvidence(userId, ev); toast({ title: "لم يُنفَّذ التسليم", description: errorText(err), variant: "destructive" }); }
      else setUnknown(errorText(err));
    } finally { onChanged(); }
  };
  if (done) {
    return (
      <article className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100" data-testid={`state-completed-${h.id}`}>
        <p className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-4" /> أكد الخادم تنفيذ التسليم</p>
        {done.departure !== "retain" && <p className="mt-1 text-sm">أُبطلت جلسات هذه المنشأة. <Link href="/login" className="underline" data-testid="link-login-after-complete">سجّل الدخول مجددًا</Link> لمتابعة عضوياتك الأخرى.</p>}
      </article>
    );
  }
  return (
    <article className="rounded-xl border p-4 transition-colors hover:border-primary/40" data-testid={`card-outgoing-${h.id}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <StatePill state={h.state} testId={`status-outgoing-${h.id}`} />{h.owner_transfer ? <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid={`badge-owner-transfer-outgoing-${h.id}`}>نقل مالك النظام · تحكم مالي كامل</span> : <span className="text-[11px] text-muted-foreground">تسليم إدارة عادي</span>}
        {!readAllEvidence(userId).some(e=>e.id===h.id) && h.state !== "completed" && h.state !== "cancelled" && <Button size="sm" variant="ghost" onClick={onEdit} data-testid={`button-edit-handover-${h.id}`}><Pencil className="me-1 size-3.5" /> تعديل</Button>}
      </div>
      <HandoverDetails h={h} />
      {unknown && <p role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid={`error-unknown-${h.id}`}>النتيجة غير معروفة: {unknown}. حُفظ دليل التنفيذ — استخدم «التحقق من الإيصال» أعلاه ولا تعتبره منفذًا قبل التأكيد.</p>}
      {h.state === "accepted" && (
        <Button size="sm" className="mt-3" variant={dep?.destructive ? "destructive" : "default"} disabled={complete.isPending} onClick={() => { setAck(false); setConfirm(true); }} data-testid={`button-finalize-${h.id}`}>
          {complete.isPending && <Loader2 className="me-2 size-4 animate-spin" />} تنفيذ النسخة المقبولة
        </Button>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{dep?.destructive ? "تحذير: سيتغير وصولك" : "تأكيد إضافة المدير"}</DialogTitle><DialogDescription>ينفذ المراجعة {h.revision} التي قبلها البديل.</DialogDescription></DialogHeader>
          <HandoverDetails h={h} />
          {dep?.destructive && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="warning-destructive">
              <p className="font-bold text-destructive">{dep.title}</p><p className="mt-1">{dep.body}</p>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="checkbox-finalize-ack" /> راجعت العواقب وأريد التنفيذ.</label>
          <DialogFooter><Button variant="ghost" onClick={() => setConfirm(false)}>إلغاء</Button>
            <Button variant={dep?.destructive ? "destructive" : "default"} disabled={!ack} onClick={() => void finalize()} data-testid="button-confirm-finalize">تنفيذ</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export function RecoveryCard({ ev, userId, onDone }: { ev: FinalizeEvidence; userId: number; onDone: () => void }) {
  const receiptQ = useGetAdministrationReceipt(ev.id, { query: { enabled: false, retry: false, queryKey: getGetAdministrationReceiptQueryKey(ev.id) } });
  const complete = useCompleteAdministrationHandover();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const check = async () => {
    setMsg(null);
    const r = await receiptQ.refetch();
    if (r.data) {
      if (r.data.state === "completed") { setConfirmed(true); clearEvidence(userId, ev); }
      else setMsg(`حالة الإيصال: ${stateMeta(r.data.state).label}. لم يُنفَّذ بعد.`);
    } else {
      setMsg(errorStatus(r.error) === 401 ? "الجلسة منتهية. سجّل الدخول (بأي عضوية) ثم أعد التحقق — الدليل باقٍ." : `تعذر التحقق: ${errorText(r.error)}`);
    }
  };
  const replay = async () => {
    setMsg(null);
    try {
      const r = await complete.mutateAsync({ id: ev.id, data: { expectedRevision: ev.revision } });
      if (r.ok) { setConfirmed(true); clearEvidence(userId, ev); } else setMsg("لم يؤكد الخادم التنفيذ.");
    } catch (err) { setMsg(`ما زالت النتيجة غير مؤكدة: ${errorText(err)}`); }
  };
  if (confirmed) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" data-testid={`state-recovery-confirmed-${ev.id}`}>
        <CheckCircle2 className="size-4" /> أكد الخادم تنفيذ التسليم {ev.id.slice(0, 8)}.
        <Button size="sm" variant="outline" onClick={onDone} data-testid="button-dismiss-recovery">حسنًا</Button>
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid={`banner-recovery-${ev.id}`}>
      <p className="font-bold">تنفيذ تسليم بنتيجة غير مؤكدة</p>
      <p className="mt-1">أرسلت تنفيذ المراجعة {ev.revision} ({DEPARTURE_LABEL[ev.departure]?.title ?? ev.departure}) ولم تصل نتيجة مؤكدة. لا تعتبره منفذًا ولا تكرر خطوات أخرى قبل التحقق.</p>
      {msg && <p className="mt-2 text-xs" data-testid="text-recovery-message">{msg}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={receiptQ.isFetching} onClick={() => void check()} data-testid={`button-check-receipt-${ev.id}`}>{receiptQ.isFetching && <Loader2 className="me-2 size-4 animate-spin" />} التحقق من الإيصال</Button>
        <Button size="sm" variant="outline" disabled={complete.isPending} onClick={() => void replay()} data-testid={`button-replay-${ev.id}`}>إعادة إرسال نفس التنفيذ</Button>
        <Link href="/login" className="inline-flex h-9 items-center rounded-md px-3 text-xs underline" data-testid="link-recovery-login">تسجيل الدخول</Link>
      </div>
    </div>
  );
}

