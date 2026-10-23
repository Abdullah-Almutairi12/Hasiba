import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDurableAction } from "@/hooks/use-returns-actions";
import { ErrorBox, FrozenNotice } from "@/components/returns/ui";
import { arr, field, label, METHODS, money, num, str, type Rec } from "@/lib/returns/shared";

type Durable = ReturnType<typeof useDurableAction>;

/** Payout against a return note. Durable state is owned by the note card. */
export function PayoutForm({ note, invoices, sessions, durable, onClose }: {
  note: Rec; invoices: Rec[]; sessions: Rec[]; durable: Durable; onClose: () => void;
}) {
  const { toast } = useToast();
  const { intent, frozen, error, clearError, send, pending, ready } = durable;
  const fb = intent?.body ?? null;
  const receipts = arr(note.receipts).length ? arr(note.receipts) : arr(invoices.find((i) => str(i.id) === str(note.invoice_id))?.receipts);
  const openSessions = sessions.filter((s) => str(s.status).toLowerCase() === "open" && (note.branch_id == null || str(s.branch_id) === str(note.branch_id)));
  const [receiptId, setReceiptId] = useState(fb ? str(fb.receiptId) : str(receipts[0]?.id));
  const [sessionId, setSessionId] = useState(fb ? str(fb.sessionId) : str(openSessions[0]?.id));
  const [amount, setAmount] = useState(fb ? str(fb.amount) : str(num(note.remaining) ?? ""));
  const [method, setMethod] = useState(fb ? str(fb.method) : str(note.settlement_method, "cash"));
  const [reference, setReference] = useState(fb ? str(fb.reference) : "");
  const [delivered, setDelivered] = useState(fb ? fb.delivered === true : false);
  const isCash = (fb ? str(fb.method) : method) === "cash";
  const maxAmt = num(note.remaining) ?? 0;
  const amt = num(amount);
  const valid = !!receiptId && !!sessionId && amt !== null && amt > 0 && amt <= maxAmt + 1e-9 && (!isCash || delivered) && (isCash || reference.trim().length > 0);

  const submit = async () => {
    const ok = await send(() => ({
      noteId: num(note.id), receiptId: Number(receiptId), sessionId: Number(sessionId), amount: amt,
      method, reference: reference.trim(), delivered: isCash ? delivered : false,
    }));
    if (ok) { toast({ title: isCash ? "سُجّل الصرف النقدي" : "سُجّل طلب الصرف — لم يُرسل لأي مزود" }); onClose(); }
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <h4 className="font-semibold">{frozen ? "إعادة إرسال الصرف نفسه" : "تسجيل صرف مقابل الإرجاع"}</h4>
      {fb && <FrozenNotice what={`صرف ${money(fb.amount)}`} body={fb} />}
      <fieldset disabled={frozen || pending} className="grid gap-3 sm:grid-cols-2">
        <div><Label>الإيصال الأصلي</Label>
          <select className={field} value={receiptId} onChange={(e) => setReceiptId(e.target.value)}>
            <option value="">اختر الإيصال</option>
            {receipts.map((r) => <option key={str(r.id)} value={str(r.id)}>#{str(r.id)} · {money(r.amount)} · {label(METHODS, str(r.payment_method))}</option>)}
          </select>
        </div>
        <div><Label>الوردية</Label>
          <select className={field} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">اختر وردية مفتوحة</option>
            {openSessions.map((s) => <option key={str(s.id)} value={str(s.id)}>{str(s.session_number, `#${str(s.id)}`)}</option>)}
          </select>
        </div>
        <div><Label>المبلغ (الحد {money(maxAmt)})</Label>
          <Input type="number" inputMode="decimal" min={0} step="0.01" max={maxAmt} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div><Label>طريقة الصرف</Label>
          <select className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
            {["cash", "card", "transfer", "stc"].map((m) => <option key={m} value={m}>{label(METHODS, m)}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2"><Label>{isCash ? "مرجع داخلي (اختياري)" : "مرجع الطلب (إلزامي)"}</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" />
        </div>
      </fieldset>
      {isCash ? (
        <label className="flex items-start gap-2 rounded-lg border border-border bg-background p-3 text-sm">
          <input type="checkbox" className="mt-1 size-4" checked={delivered} disabled={frozen || pending} onChange={(e) => setDelivered(e.target.checked)} />
          <span>أؤكد أنني سلّمت المبلغ نقدًا للعميل يدًا بيد، وسيُخصم من الدرج المتوقع لهذه الوردية.</span>
        </label>
      ) : (
        <p className="rounded-lg bg-violet-50 p-3 text-xs text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
          هذا تسجيل طلب فقط. لا يُرسل لأي بنك أو مزود دفع، ولا يعني أن المبلغ وصل للعميل. يلزم توثيق رد خارجي يدوي بدليل لاحقًا.
        </p>
      )}
      {error && <ErrorBox err={error} onClose={clearError} />}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!ready || pending || (!frozen && !valid)} onClick={() => void submit()}>
          {pending ? "جارٍ الإرسال..." : frozen ? "إعادة إرسال نفس الطلب" : isCash ? "تسجيل الصرف النقدي" : "تسجيل طلب الصرف"}
        </Button>
        {!frozen && <Button variant="ghost" onClick={onClose}>إلغاء</Button>}
      </div>
    </div>
  );
}
