import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useDurableAction } from "@/hooks/use-returns-actions";
import { Empty, ErrorBox, FrozenNotice } from "@/components/returns/ui";
import { cn } from "@/lib/utils";
import { arr, DISPOSITIONS, field, label, METHODS, money, num, str, type Rec } from "@/lib/returns/shared";

export function RequestTab({ invoices, policies, branchName, onDone }: {
  invoices: Rec[]; policies: Rec[]; branchName: (id: unknown) => string; onDone: () => void;
}) {
  const [search, setSearch] = useState("");
  const [invId, setInvId] = useState("");
  const inv = invoices.find((i) => str(i.id) === invId);
  const filtered = invoices.filter((i) => !search.trim() || str(i.reference).toLowerCase().includes(search.trim().toLowerCase()) || str(i.id) === search.trim()).slice(0, 50);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-2 rounded-2xl border border-border bg-card p-3">
        <Label>الفاتورة الأصلية</Label>
        <Input placeholder="ابحث بالمرجع أو الرقم" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {filtered.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">لا توجد فواتير متاحة لك</p>}
          {filtered.map((i) => (
            <button key={str(i.id)} type="button" onClick={() => setInvId(str(i.id))}
              className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm", invId === str(i.id) ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              <span dir="ltr">{str(i.reference, `#${str(i.id)}`)}</span>
              <span className="text-xs tabular-nums opacity-80">{money(i.total)}</span>
            </button>
          ))}
        </div>
      </aside>
      {!inv ? (
        <Empty title="اختر الفاتورة الأصلية" hint="الإرجاع يُبنى دائمًا على بنود مباعة فعليًا وبأسعارها الأصلية — لا إدخال أسعار يدوي." />
      ) : (
        <RequestForm key={invId} inv={inv} policies={policies} branchName={branchName} onDone={onDone} />
      )}
    </div>
  );
}

function RequestForm({ inv, policies, branchName, onDone }: { inv: Rec; policies: Rec[]; branchName: (id: unknown) => string; onDone: () => void }) {
  const { toast } = useToast();
  const d = useDurableAction("request", str(inv.id));
  const fb = d.intent?.body ?? null;
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState("no_goods");
  const [settlement, setSettlement] = useState("credit");
  const [proofRef, setProofRef] = useState("");

  // Rehydrate the frozen body so the cashier sees exactly what will be replayed.
  useEffect(() => {
    if (!fb) return;
    const q: Record<string, string> = {};
    for (const l of arr(fb.lines)) q[str(l.invoiceLineId)] = str(l.quantity);
    setQty(q); setReason(str(fb.reason)); setDisposition(str(fb.disposition, "no_goods"));
    setSettlement(str(fb.settlementMethod, "credit")); setProofRef(str(fb.proofRef));
  }, [fb]);

  const policy = policies.find((p) => str(p.branch_id) === str(inv.branch_id)) ?? policies.find((p) => num(p.branch_id) === 0);
  const resaleAllowed = policy?.allow_resale === true;
  const lines = arr(inv.lines);
  const chosen = lines.map((l) => ({ l, q: num(qty[str(l.id)]) ?? 0 })).filter((x) => x.q > 0);
  const overQty = chosen.some((x) => x.q > (num(x.l.quantity) ?? 0));
  const estimate = chosen.reduce((s, x) => {
    const tr = num(x.l.tax_rate) ?? 0;
    return s + x.q * (num(x.l.unit_price) ?? 0) * (1 + (tr > 1 ? tr / 100 : tr));
  }, 0);
  const valid = chosen.length > 0 && !overQty && reason.trim().length > 0 && proofRef.trim().length > 0 && (disposition !== "resale" || resaleAllowed);
  const frozen = !!fb;

  const submit = async () => {
    const ok = await d.send(() => ({
      invoiceId: num(inv.id), customerId: num(inv.customer_id), warehouseId: num(inv.warehouse_id),
      lines: chosen.map(({ l, q }) => ({ invoiceLineId: num(l.id), productId: num(l.product_id), description: str(l.description), quantity: q, unitPrice: num(l.unit_price), taxRate: num(l.tax_rate) })),
      reason: reason.trim(), disposition, restock: disposition === "resale", goodsReceived: false, settlementMethod: settlement, proofRef: proofRef.trim(),
    }));
    if (ok) {
      toast({ title: "سُجّل طلب الإرجاع", description: "الحالة الفعلية (مسجّل أو بانتظار اعتماد) تظهر من الخادم." });
      onDone();
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold" dir="ltr">{str(inv.reference)}</h3>
          <p className="text-xs text-muted-foreground">{branchName(inv.branch_id)} · إجمالي {money(inv.total)}</p>
        </div>
        <a href={`${import.meta.env.BASE_URL}api/sales/invoices/${encodeURIComponent(str(inv.id))}/pdf`} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">فتح الفاتورة</a>
      </div>
      {fb && <FrozenNotice what="طلب إرجاع" body={fb} />}

      <fieldset disabled={frozen || d.pending} className="space-y-4">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr><th className="p-2 text-start">البند</th><th className="p-2">المباع</th><th className="p-2">سعر الوحدة</th><th className="p-2">الضريبة</th><th className="p-2">كمية الإرجاع</th></tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const k = str(l.id); const max = num(l.quantity) ?? 0; const q = num(qty[k]) ?? 0;
                return (
                  <tr key={k} className="border-t border-border">
                    <td className="p-2">{str(l.description, `منتج #${str(l.product_id)}`)}</td>
                    <td className="p-2 text-center tabular-nums">{max}</td>
                    <td className="p-2 text-center tabular-nums">{money(l.unit_price)}</td>
                    <td className="p-2 text-center tabular-nums">{str(l.tax_rate, "—")}</td>
                    <td className="p-2"><Input type="number" min={0} max={max} step="any" value={qty[k] ?? ""} placeholder="0"
                      className={cn("mx-auto h-9 w-24 text-center", q > max && "border-rose-500")}
                      onChange={(e) => setQty((s) => ({ ...s, [k]: e.target.value }))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {overQty && <p className="text-xs text-rose-600">الكمية المرتجعة تتجاوز الكمية المباعة.</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>مصير البضاعة</Label>
            <select className={field} value={disposition} onChange={(e) => setDisposition(e.target.value)}>
              <option value="no_goods">{DISPOSITIONS.no_goods} (آمن للأطعمة المحضرة)</option>
              <option value="discard">{DISPOSITIONS.discard}</option>
              <option value="resale" disabled={!resaleAllowed}>{DISPOSITIONS.resale}{resaleAllowed ? "" : " — غير مسموح بسياسة الفرع"}</option>
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">{disposition === "resale" ? "للمسؤولية المقيدة: الطلب لا يثبت الاستلام؛ تعاد الكميات بعد الاعتماد وإثبات الاستلام المخول." : "لن تُعاد أي كمية للمخزون."}</p>
          </div>
          <div><Label>طريقة التسوية</Label>
            <select className={field} value={settlement} onChange={(e) => setSettlement(e.target.value)}>
              {Object.keys(METHODS).map((m) => <option key={m} value={m}>{label(METHODS, m)}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><Label>مرجع إثبات العميل (إيصال أصلي / مطالبة) *</Label>
            <Input value={proofRef} onChange={(e) => setProofRef(e.target.value)} dir="ltr" placeholder="رقم الإيصال الأصلي الذي قدمه العميل" />
          </div>
          <div className="sm:col-span-2"><Label>سبب الإرجاع *</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ما الذي حدث بالضبط؟" />
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 p-3">
        <div className="text-sm">تقدير من الأسعار الأصلية: <b className="tabular-nums">{money(estimate)}</b><span className="ms-1 text-xs text-muted-foreground">(القيمة النهائية يحددها الخادم)</span></div>
        <Button disabled={!d.ready || d.pending || (!frozen && !valid)} onClick={() => void submit()}>
          {d.pending ? "جارٍ التسجيل..." : frozen ? "إعادة إرسال نفس الطلب" : "تسجيل طلب الإرجاع"}
        </Button>
      </div>
      {d.error && <ErrorBox err={d.error} onClose={d.clearError} />}
    </section>
  );
}
