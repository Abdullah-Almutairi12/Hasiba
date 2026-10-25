import { useEffect, useMemo, useState } from "react";
import { useGetReturnWorkspace } from "@workspace/api-client-react";
import { Undo2, RefreshCw, Download, Wallet, Settings2, FileText, Clock, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useAct, useDurableAction } from "@/hooks/use-returns-actions";
import { cn } from "@/lib/utils";
import { arr, closingStateLabel, DISPOSITIONS, label, METHODS, money, num, readErr, rec, returnNoteState, statusTone, str, strArr, type Rec } from "@/lib/returns/shared";
import { Empty, ErrorBox, Fig, Pill, Stat } from "@/components/returns/ui";
import { PayoutForm } from "@/components/returns/payout-form";
import { ExpenseForm } from "@/components/returns/expense-form";
import { RequestTab } from "@/components/returns/request-form";
import { ApproveButton, ApproveClose, CloseForm, PayoutsTab } from "@/components/returns/actions";
import { ConfigTab } from "@/components/returns/config-tab";
import { ResponsibilityForm } from "@/components/returns/responsibility-form";
import { RecoveryPanel } from "@/components/returns/recovery-panel";
import { docUrls, fmtDate, PrintDocButton } from "@/lib/print-docs";

type Tab = "notes" | "new" | "payouts" | "sessions" | "reports" | "config";

export default function ReturnsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const exporter = useAct();
  const q = useGetReturnWorkspace({ query: { refetchInterval: 15_000, refetchOnWindowFocus: true, staleTime: 0 } });
  const [tab, setTab] = useState<Tab>("notes");

  const d = rec(q.data);
  const notes = arr(d.notes), invoices = arr(d.invoices), sessions = arr(d.sessions), payouts = arr(d.payouts);
  const branches = arr(d.branches), members = arr(d.members), policies = arr(d.policies), access = arr(d.access), accounts = arr(d.accounts);
  const templates = rec(d.templates);
  const caps = new Set(strArr(d.capabilities));
  const can = (c: string) => caps.has(c);
  const branchName = (id: unknown) => str(branches.find((b) => num(b.id) === num(id))?.name_ar) || (num(id) === 0 ? "افتراضي الشركة" : `فرع ${str(id)}`);
  const meId = user?.id ?? null;

  const totals = useMemo(() => {
    let due = 0, pendingCount = 0, awaitingReceiptCount = 0;
    for (const n of notes) {
      due += num(n.due) ?? 0;
      const state = returnNoteState(n);
      if (state.awaitingApproval) pendingCount++;
      if (state.awaitingReceipt) awaitingReceiptCount++;
    }
    return { due, pendingCount, awaitingReceiptCount };
  }, [notes]);

  const exportCsv = async () => {
    const result = await exporter.run("export", {});
    if (!result.ok) { toast({ title: result.err.message, variant: "destructive" }); return; }
    const blob = new Blob(["\uFEFF" + str(result.res.csv)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `returns-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast({ title: `صُدّر ${str(result.res.rows)} سجل بصلاحية الخادم، بحد أقصى 10,000` });
  };

  const tabs = [
    { k: "notes", t: "إشعارات الإرجاع", i: FileText, show: true },
    { k: "new", t: "طلب إرجاع", i: Undo2, show: can("request") },
    { k: "payouts", t: "الصرف", i: Wallet, show: true },
    { k: "sessions", t: "الوردية والدرج", i: Banknote, show: true },
    { k: "reports", t: "تقارير المرتجعات", i: FileText, show: can("reports") },
    { k: "config", t: "الصلاحيات والسياسات", i: Settings2, show: can("configure") },
  ] as const;

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-primary">المرتجعات والاسترداد</p>
          <h1 className="text-2xl font-bold">مكتب المرتجعات</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">كل حركة مالية هنا صريحة ومسجلة: تسجيل، اعتماد، صرف، ثم مطابقة الدرج. الخادم هو المرجع النهائي لكل حالة.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
            <span className={cn("size-2 rounded-full", q.isFetching ? "animate-pulse bg-amber-500" : "bg-emerald-500")} />
            تحديث تلقائي كل 15 ثانية
          </span>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn("me-1 size-4", q.isFetching && "animate-spin")} /> تحديث
          </Button>
          {can("export") && (
            <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporter.pending}>
              <Download className="me-1 size-4" /> تصدير CSV
            </Button>
          )}
        </div>
      </header>

      <RecoveryPanel />

      {q.isLoading ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          <Skeleton className="h-10 w-full rounded-xl" />
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : q.isError ? (
        <div className="space-y-3 rounded-2xl border border-border p-6">
          <ErrorBox err={readErr(q.error)} />
          <Button onClick={() => void q.refetch()}><RefreshCw className="me-1 size-4" /> إعادة المحاولة</Button>
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={FileText} label="إشعارات مسجلة" value={String(notes.length)} />
            <Stat icon={Clock} label="بانتظار الاعتماد" value={String(totals.pendingCount)} tone="amber" />
            <Stat icon={Clock} label="معتمد وبانتظار الاستلام" value={String(totals.awaitingReceiptCount)} tone="amber" />
            <Stat icon={Wallet} label="المستحق للصرف (غير مصروف)" value={money(totals.due)} tone="sky" />
          </section>

          <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
            {tabs.filter((t) => t.show).map((t) => (
              <button key={t.k} type="button" onClick={() => setTab(t.k)}
                className={cn("inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  tab === t.k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                <t.i className="size-4" /> {t.t}
              </button>
            ))}
          </nav>

          {tab === "notes" && (notes.length === 0
            ? <Empty title="لا توجد إشعارات إرجاع" hint="عند تسجيل إرجاع على فاتورة أصلية سيظهر هنا مع حالته ومبلغه المستحق." />
            : <div className="space-y-3">{notes.map((n) => <NoteCard key={str(n.id)} note={n} payouts={payouts} sessions={sessions} invoices={invoices} can={can} branchName={branchName} />)}</div>)}
          {tab === "new" && can("request") && <RequestTab invoices={invoices} policies={policies} branchName={branchName} onDone={() => setTab("notes")} />}
          {tab === "reports" && can("reports") && <section className="space-y-3">
            <p className="text-sm text-muted-foreground">تجميع جميع المستندات المسجلة لهذا المسار حسب الفروع المسموحة، وليس فقط آخر السجلات المعروضة. «مطلوب» محجوز، وليس مبلغًا مدفوعًا.</p>
            {arr(d.reports).map((r) => <div key={str(r.branch_id)} className="space-y-3 rounded-xl border p-4">
              <h2 className="font-bold">{str(r.branch_name) || branchName(r.branch_id)}</h2>
              <div className="flex flex-wrap gap-5">
                <Fig l="إجمالي المعتمد" v={money(r.total)} />
                <Fig l="صرف مؤكد/موثق" v={money(r.refunded)} />
                <Fig l="رد مطلوب غير منفذ" v={money(r.reserved)} />
                <Fig l="المستحق غير المدفوع" v={money(r.due)} strong />
              </div>
            </div>)}
          </section>}
          {tab === "payouts" && <PayoutsTab payouts={payouts} notes={notes} can={can} />}
          {tab === "sessions" && (sessions.length === 0
            ? <Empty title="لا توجد ورديات ظاهرة" hint="ورديات الفروع المخولة لك تظهر هنا مع حركة الدرج." />
            : <div className="grid gap-3 xl:grid-cols-2">{sessions.map((s) => <SessionCard key={str(s.id)} s={s} can={can} branchName={branchName} meId={meId} accounts={accounts} employees={arr(d.responsibility_employees)} />)}</div>)}
          {tab === "config" && can("configure") && (
            <ConfigTab members={members} access={access} templates={templates} branches={branches} policies={policies} branchName={branchName} meId={meId} ownerPolicy={rec(d.owner_policy)} />
          )}
        </>
      )}
    </div>
  );
}

function NoteCard({ note: n, payouts, sessions, invoices, can, branchName }: {
  note: Rec; payouts: Rec[]; sessions: Rec[]; invoices: Rec[]; can: (c: string) => boolean; branchName: (id: unknown) => string;
}) {
  const id = str(n.id);
  const durable = useDurableAction("payout", id);
  const [paying, setPaying] = useState(false);
  const receiver = useAct();
  const [receiptRef, setReceiptRef] = useState("");
  const [receiptError, setReceiptError] = useState("");
  // An earlier denial belongs to its review context, not to a replacement
  // decision. Keep the receipt reference and durable payout intent intact.
  useEffect(() => {
    setReceiptError("");
  }, [id, n.approval_id, n.review_status, n.received_at]);
  const state = returnNoteState(n);
  const st = state.status;
  const remaining = num(n.remaining) ?? 0;
  const notePayouts = payouts.filter((p) => str(p.note_id) === id);
  const pending = state.awaitingApproval;
  const showForm = paying || durable.frozen;

  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold" dir="ltr">{str(n.reference, `#${id}`)}</h3>
            <Pill status={st} />
            {str(n.approval_id) && <span className="text-[11px] text-muted-foreground">طلب اعتماد #{str(n.approval_id)}</span>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {str(n.branch_name) || branchName(n.branch_id)} · {label(DISPOSITIONS, str(n.disposition))} · {label(METHODS, str(n.settlement_method))}
            {str(n.created_by) && ` · أنشأه ${str(n.created_by)}`}
          </p>
          <p className="mt-1 text-xs">
            {n.invoice_id != null && (
              <a href={`${import.meta.env.BASE_URL}api/sales/invoices/${encodeURIComponent(str(n.invoice_id))}/pdf`} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                الفاتورة الأصلية #{str(n.invoice_id)}
              </a>
            )}
            {str(n.proof_ref) && <span className="ms-2 text-muted-foreground">إثبات العميل: <span dir="ltr">{str(n.proof_ref)}</span></span>}
          </p>
        </div>
        <div className="grid grid-cols-4 gap-3 text-center text-xs sm:gap-5">
          <Fig l="قيمة الإرجاع" v={money(n.total)} />
          <Fig l="مصروف مسجل" v={money(n.refunded)} />
          <Fig l="محجوز للصرف" v={money(n.reserved)} />
          <Fig l="المستحق غير المدفوع" v={money(n.due)} strong />
          <Fig l="المتاح للصرف بعد الحجز" v={money(n.remaining)} />
        </div>
      </div>

      {n.receipt_required === true && (
        <section className="mt-3 rounded-xl border p-3 text-sm" aria-label="إثبات استلام المرتجع">
          {n.received_by != null ? <p>أُثبت الاستلام بواسطة #{str(n.received_by)} · {str(n.receipt_reference)}</p> : <>
            {can("request") && state.financialPending && <Button variant="outline" size="sm" disabled={receiver.pending}
              onClick={() => void (async () => {
                const result = await receiver.run("re_review", { noteId:num(n.id) });
                setReceiptError(result.ok ? "" : result.err.message);
              })()}>إعادة فحص المراجعة واستئناف الطلب نفسه</Button>}
            <p className="font-semibold">{n.review_status === "direct_authorized" ? "مسموح مباشرة — ينتظر الاستلام الفعلي؛ ليس اعتمادًا من شخص مستقل" : n.review_status === "approved" ? "معتمد — ينتظر استلام البضاعة الفعلي قبل الترحيل والاسترداد" : "لم تثبت إعادة البضاعة؛ الطلب وحده لا يعيد المخزون"}</p>
            {can("receive") && ["approved","direct_authorized"].includes(str(n.review_status)) && <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex-1">مرجع محضر الاستلام الفعلي
                <input className="mt-1 w-full rounded border bg-background p-2" value={receiptRef} disabled={receiver.pending}
                  onChange={e => setReceiptRef(e.target.value)} />
              </label>
              <Button disabled={receiver.pending || receiptRef.trim().length < 3} onClick={() => void (async () => {
                setReceiptError("");
                const result = await receiver.run("receive", { noteId: num(n.id), reference: receiptRef });
                if (!result.ok) setReceiptError(result.err.message);
              })()}>إثبات الاستلام وترحيل المرتجع</Button>
            </div>}
            {receiptError && <p role="alert" className="mt-2 text-destructive">{receiptError}</p>}
          </>}
        </section>
      )}

      {notePayouts.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
          {notePayouts.map((p) => (
            <li key={str(p.id)} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">صرف #{str(p.id)}</span>
              <span className="tabular-nums">{money(p.amount)}</span>
              <span className="text-muted-foreground">{label(METHODS, str(p.method))}</span>
              <Pill status={str(p.status)} />
              {str(p.reference) && <span dir="ltr" className="text-muted-foreground">{str(p.reference)}</span>}
              {str(p.created_at) && <span className="text-muted-foreground">{fmtDate(p.created_at)}</span>}
              {payoutPrintKind(p) === "voucher" && (
                <PrintDocButton id={num(p.id)} url={docUrls.refund} filename={`refund-${str(p.id)}.pdf`} label="سند الصرف" variant="ghost" testId={`button-print-refund-${str(p.id)}`} />
              )}
              {payoutPrintKind(p) === "request" && (
                <>
                  <span className="text-violet-700 dark:text-violet-300">طلب غير منفذ — لم يُرسل لأي مزود ولم يُصرف</span>
                  <PrintDocButton id={num(p.id)} url={docUrls.refund} filename={`refund-request-${str(p.id)}.pdf`} label="طباعة طلب الاسترداد (غير منفذ)" variant="ghost" testId={`button-print-refund-${str(p.id)}`} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {can("approve") && pending && <ApproveButton noteId={id} />}
        {!state.financialPending && <PrintDocButton id={num(n.id)} url={docUrls.creditNote} filename={`credit-note-${id}.pdf`} label="طباعة الإشعار الدائن" testId={`button-print-credit-${id}`} />}
        {can("payout") && !state.financialPending && remaining > 0 && !showForm && (
          <Button size="sm" onClick={() => setPaying(true)}><Wallet className="me-1 size-4" /> تسجيل صرف</Button>
        )}
      </div>
      {showForm && <PayoutForm note={n} invoices={invoices} sessions={sessions} durable={durable} onClose={() => setPaying(false)} />}
    </article>
  );
}

function SessionCard({ s, can, branchName, meId, accounts, employees }: {
  s: Rec; can: (c: string) => boolean; branchName: (id: unknown) => string; meId: number | null; accounts: Rec[]; employees:Rec[];
}) {
  const st = str(s.status).toLowerCase();
  const cs = str(s.closing_status).toLowerCase();
  const diff = num(s.difference);
  const pendingClose = cs.includes("pending");
  const mine = meId !== null && num(s.closing_created_by) === meId;
  const figs: Array<[string, unknown]> = [
    ["الافتتاح", s.opening], ["نقد داخل", s.cash_in], ["نقد خارج", s.cash_out],
    ["منه مرتجعات نقدية", s.cash_refunds], ["منه مصروفات نقدية", s.cash_expenses],
    ["المتوقع", s.expected], ["المعدود", s.counted],
  ];
  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold" dir="ltr">{str(s.session_number, `#${str(s.id)}`)}</h3>
        <Pill status={str(s.status)} />
        {cs && <span className="text-xs text-muted-foreground">الإغلاق: {closingStateLabel(cs,s.closing_owner_exception===true)}</span>}
        <span className="ms-auto text-xs text-muted-foreground">{branchName(s.branch_id)}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {figs.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-muted/50 p-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold tabular-nums">{money(v)}</dd></div>
        ))}
        <div className={cn("rounded-lg p-2", diff === null ? "bg-muted/50" : diff === 0 ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-rose-50 dark:bg-rose-950/40")}>
          <dt className="text-muted-foreground">الفرق</dt><dd className="font-bold tabular-nums">{money(s.difference)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-muted-foreground">النقد فقط. مبالغ البطاقة لا تمثل تسوية بنكية مؤكدة.</p>
      {cs && <div className="mt-3 space-y-1 rounded-lg border p-3 text-sm">
        <p>سبب الكاشير الأصلي: {str(s.closing_reason) || "غير محفوظ في الإصدار القديم"}</p>
        {str(s.reconciliation_reason) && <p>سبب إعادة التسوية: {str(s.reconciliation_reason)}</p>}
        <p>نسخة التسوية: {str(s.settlement_version)} <span dir="ltr" className="break-all text-xs">{str(s.settlement_revision)}</span></p>
        {cs==="approved" && <><p>تعليل المراجع: {str(s.review_reason) || "لا يوجد تعليل مستقل محفوظ لهذا القرار التاريخي"}</p>
          <p>المعتمد: {str(s.closing_approved_by)} — وقت القرار: {str(s.closing_approved_at)}</p></>}
      </div>}
      {st === "open" && !pendingClose && (
        <div className="mt-3 flex flex-wrap gap-2">
          {can("expense") && <ExpenseForm sessionId={str(s.id)} accounts={accounts} />}
          {can("close") && <CloseForm sessionId={str(s.id)} expected={num(s.expected) ?? 0} />}
        </div>
      )}
      {cs && (can("close") || can("reports") || can("difference")) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <PrintDocButton id={num(s.id)} url={docUrls.closing} filename={`shift-closing-${str(s.id)}.pdf`} label={closingPrintLabel(cs)} testId={`button-print-closing-${str(s.id)}`} />
          <span className="text-[11px] text-muted-foreground" data-testid={`closing-state-${str(s.id)}`}>حالة الإغلاق الحالية: {closingStateLabel(cs,s.closing_owner_exception===true)}</span>
        </div>
      )}
      {pendingClose && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          إغلاق بفرق بانتظار اعتماد مستخدم مخول آخر.
          {can("difference") && (!mine || can("configure")) && <div className="mt-2"><ApproveClose sessionId={str(s.id)} settlementRevision={str(s.settlement_revision)} selfOwner={mine} /></div>}
          {can("close") && <CloseForm sessionId={str(s.id)} expected={num(s.expected) ?? 0}
            settlementRevision={str(s.settlement_revision) || `legacy-${str(s.id)}`} />}
          {mine && !can("configure") && <div className="mt-1">لا يمكنك اعتماد إغلاق أنشأته بنفسك.</div>}
        </div>
      )}
      {cs==="approved" && diff!==null && diff!==0 && can("responsibility") && (!mine||can("configure")) &&
        <ResponsibilityForm session={s} employees={employees} selfOwner={mine&&can("configure")}/>}
    </article>
  );
}

/** Confirmed payouts print a voucher; requested electronic refunds print an explicitly unexecuted request. */
export function payoutPrintKind(p: Rec): "voucher" | "request" | null {
  const st = str(p.status).toLowerCase();
  if (st.includes("cancel") || st.includes("reject")) return null;
  if (st === "requested") return str(p.method) !== "cash" ? "request" : null;
  if (st.includes("pending")) return null;
  return "voucher";
}

export function closingPrintLabel(closingStatus: string): string {
  const k = closingStatus.toLowerCase();
  if (k.includes("pending") || k.includes("await")) return "طباعة الإغلاق (بانتظار الاعتماد)";
  if (k.includes("approv")) return "طباعة الإغلاق (معتمد)";
  return "تقرير إغلاق الوردية";
}
