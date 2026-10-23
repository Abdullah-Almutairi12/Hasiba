import { useState } from "react";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDurableAction } from "@/hooks/use-returns-actions";
import { ErrorBox, FrozenNotice } from "@/components/returns/ui";
import { field, money, num, str, type Rec } from "@/lib/returns/shared";

/** Cash paid out of the drawer for an expense account. Durable per session. */
export function ExpenseForm({ sessionId, accounts }: { sessionId: string; accounts: Rec[] }) {
  const { toast } = useToast();
  const d = useDurableAction("expense", sessionId);
  const fb = d.intent?.body ?? null;
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [delivered, setDelivered] = useState(false);
  const amt = num(amount);
  const valid = !!accountId && amt !== null && amt > 0 && reference.trim().length > 0 && delivered;

  if (!open && !fb) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Receipt className="me-1 size-4" /> مصروف نقدي من الدرج</Button>;
  }
  const accName = (id: unknown) => str(accounts.find((a) => str(a.id) === str(id))?.name_ar, `حساب ${str(id)}`);

  const submit = async () => {
    const ok = await d.send(() => ({ sessionId: Number(sessionId), accountId: Number(accountId), amount: amt, reference: reference.trim(), delivered: true }));
    if (ok) {
      toast({ title: "سُجّل المصروف النقدي" });
      setOpen(false); setAccountId(""); setAmount(""); setReference(""); setDelivered(false);
    }
  };

  return (
    <div className="w-full space-y-2 rounded-xl bg-muted/50 p-3">
      {fb ? (
        <>
          <FrozenNotice what={`مصروف ${money(fb.amount)} على ${accName(fb.accountId)}`} body={fb} />
          <p className="text-xs" dir="ltr">{str(fb.reference)}</p>
        </>
      ) : (
        <fieldset disabled={d.pending} className="grid gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>حساب المصروف</Label>
            <select className={field} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">اختر الحساب</option>
              {accounts.map((a) => <option key={str(a.id)} value={str(a.id)}>{str(a.name_ar, `حساب ${str(a.id)}`)}</option>)}
            </select>
          </div>
          <div><Label>المبلغ</Label><Input type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><Label>المرجع (رقم الفاتورة / السند)</Label><Input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-1 size-4" checked={delivered} onChange={(e) => setDelivered(e.target.checked)} />
            <span>أؤكد أن هذا المبلغ خرج نقدًا من الدرج وسُلّم فعليًا، وسيُخصم من المتوقع.</span>
          </label>
        </fieldset>
      )}
      {d.error && <ErrorBox err={d.error} onClose={d.clearError} />}
      <div className="flex gap-2">
        <Button size="sm" disabled={!d.ready || d.pending || (!fb && !valid)} onClick={() => void submit()}>
          {d.pending ? "جارٍ الإرسال..." : fb ? "إعادة إرسال نفس المصروف" : "تسجيل المصروف"}
        </Button>
        {!fb && <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>}
      </div>
    </div>
  );
}
