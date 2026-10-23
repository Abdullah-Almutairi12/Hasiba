import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSellerWorkspace, useGetSellerReport, useConfigureSellerPolicy, useConfigureSellerEligibility,
  useCorrectInvoiceAttribution, useChangeCommissionState, getGetSellerWorkspaceQueryKey, getGetSellerReportQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Users, Award, Settings2, PenLine, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiGet } from "@/hooks/use-api";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { fmtDate } from "@/lib/print-docs";
import {
  COMMISSION_STATUS, GRAN_AR, MODE_AR, fmtMoney, n, parseReport, parseWorkspace, s, totalsByCurrency,
  type Commission, type Employee, type SellerGranularity, type SellerMode, type Workspace,
  parseInvoiceAttribution, type InvoiceAttribution,
} from "@/lib/sellers";
import { SellerSelect } from "./seller-picker";

const errText = (e: unknown) => (e instanceof Error ? e.message : "تعذر تنفيذ العملية");
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };

export function SellerCommissionsPanel() {
  const { activeCompanyId } = useCurrentCompany();
  const [selection, setSelection] = useState<{ companyId: number | null; branchId: number | null }>({
    companyId: activeCompanyId, branchId: null,
  });
  // Never send the previous company's selected branch to the new workspace.
  const branchId = selection.companyId === activeCompanyId ? selection.branchId : null;
  const setBranchId = (value: number | null) => setSelection({ companyId: activeCompanyId, branchId: value });
  const q = useGetSellerWorkspace(branchId ? { branchId } : undefined, { query: { retry: false } });
  const ws = useMemo(() => (q.data ? parseWorkspace(q.data) : null), [q.data]);

  if (q.isError) {
    return (
      <Card><CardContent className="flex items-center justify-between gap-3 p-6 text-sm">
        <span>تعذر تحميل إعدادات البائعين والعمولات.</span>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}><RefreshCw className="me-1 size-4" />إعادة المحاولة</Button>
      </CardContent></Card>
    );
  }
  if (!ws) return <div className="space-y-3" data-testid="sellers-loading"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;

  return (
    <div className="space-y-4" data-testid="seller-commissions">
      {ws.canConfigure && <PolicyCard ws={ws} branchId={branchId} setBranchId={setBranchId} />}
      {ws.employees && <EligibilityCard ws={ws} />}
      <SellerReportCard ws={ws} />
    </div>
  );
}

// ---------------- Policy ----------------
function PolicyCard({ ws, branchId, setBranchId }: { ws: Workspace; branchId: number | null; setBranchId: (v: number | null) => void }) {
  const p = ws.policy;
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useConfigureSellerPolicy();
  const [mode, setMode] = useState<SellerMode>(p.mode);
  const [gran, setGran] = useState<SellerGranularity>(p.granularity);
  const [inherit, setInherit] = useState(p.inherited);
  const [commission, setCommission] = useState(p.commissionEnabled);
  const [source, setSource] = useState<"rate" | "plan">(p.planId ? "plan" : "rate");
  const [rate, setRate] = useState(p.ratePercent != null ? String(p.ratePercent) : "");
  const [planId, setPlanId] = useState(p.planId ? String(p.planId) : "");
  const [from, setFrom] = useState(today());
  useEffect(() => {
    setMode(p.mode); setGran(p.granularity); setInherit(p.inherited); setCommission(p.commissionEnabled);
    setSource(p.planId ? "plan" : "rate"); setRate(p.ratePercent != null ? String(p.ratePercent) : ""); setPlanId(p.planId ? String(p.planId) : "");
  }, [p.version, p.branchId, p.mode, p.granularity, p.inherited, p.commissionEnabled, p.planId, p.ratePercent]);

  const save = async () => {
    const body: Parameters<typeof mut.mutateAsync>[0]["data"] = {
      branchId: branchId ?? 0, inherit: branchId ? inherit : false, mode, granularity: gran, commissionEnabled: commission,
      // Saudi launch: the selected civil date starts at midnight in Riyadh.
      effectiveFrom: `${from}T00:00:00+03:00`,
    };
    if (commission && !(branchId && inherit)) {
      if (source === "rate") {
        const r = Number(rate);
        if (rate.trim() === "" || !Number.isFinite(r) || r < 0 || r > 100) { toast({ title: "أدخل نسبة عمولة صريحة بين 0 و100", variant: "destructive" }); return; }
        body.commissionRatePercent = r;
      } else {
        if (!planId) { toast({ title: "اختر خطة عمولة", variant: "destructive" }); return; }
        body.commissionPlanId = Number(planId);
      }
    }
    if (!from) { toast({ title: "حدد تاريخ السريان", variant: "destructive" }); return; }
    try {
      await mut.mutateAsync({ data: body });
      toast({ title: "تم حفظ سياسة البائعين (إصدار جديد)" });
      await qc.invalidateQueries({ queryKey: getGetSellerWorkspaceQueryKey() });
    } catch (e) { toast({ title: "فشل الحفظ", description: errText(e), variant: "destructive" }); }
  };
  const locked = !!branchId && inherit;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Settings2 className="size-4" /> سياسة البائعين والعمولات</CardTitle>
        <CardDescription>
          السياسة الحالية: {MODE_AR[p.mode]} · {GRAN_AR[p.granularity]} · العمولة {p.commissionEnabled ? (p.ratePercent != null ? `${p.ratePercent}%` : p.planId ? `خطة #${p.planId}` : "مفعلة") : "متوقفة"}
          {p.version != null && ` · إصدار ${p.version}`}{p.inherited && " · موروثة من إعداد الشركة"}{p.effectiveFrom && ` · سارية من ${fmtDate(p.effectiveFrom)}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>النطاق</Label>
            <select data-testid="select-policy-branch" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={branchId ?? 0} onChange={(e) => setBranchId(Number(e.target.value) || null)}>
              <option value={0}>افتراضي الشركة</option>
              {ws.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {branchId && (
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={inherit} onChange={(e) => setInherit(e.target.checked)} data-testid="checkbox-policy-inherit" />
              يرث سياسة الشركة
            </label>
          )}
          <div>
            <Label>إظهار البائع</Label>
            <select data-testid="select-policy-mode" disabled={locked} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={mode} onChange={(e) => setMode(e.target.value as SellerMode)}>
              {(Object.keys(MODE_AR) as SellerMode[]).map((m) => <option key={m} value={m}>{MODE_AR[m]}</option>)}
            </select>
          </div>
          <div>
            <Label>مستوى الإسناد</Label>
            <select data-testid="select-policy-granularity" disabled={locked} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={gran} onChange={(e) => setGran(e.target.value as SellerGranularity)}>
              {(Object.keys(GRAN_AR) as SellerGranularity[]).map((m) => <option key={m} value={m}>{GRAN_AR[m]}</option>)}
            </select>
          </div>
          <div>
            <Label>ساري من</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-policy-from" />
          </div>
        </div>
        <fieldset disabled={locked} className="space-y-3 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={commission} onChange={(e) => setCommission(e.target.checked)} data-testid="checkbox-commission-enabled" />
            تفعيل احتساب العمولة
          </label>
          {commission && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>مصدر النسبة</Label>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={source} onChange={(e) => setSource(e.target.value as "rate" | "plan")} data-testid="select-commission-source">
                  <option value="rate">نسبة صريحة</option>
                  <option value="plan" disabled={ws.commissionPlans.length === 0}>خطة عمولة للشركة</option>
                </select>
              </div>
              {source === "rate" ? (
                <div><Label>النسبة %</Label><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="أدخل النسبة" dir="ltr" data-testid="input-commission-rate" /></div>
              ) : (
                <div>
                  <Label>الخطة</Label>
                  <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={planId} onChange={(e) => setPlanId(e.target.value)} data-testid="select-commission-plan">
                    <option value="">اختر خطة</option>
                    {ws.commissionPlans.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                  </select>
                </div>
              )}
              <p className="self-end text-xs text-muted-foreground">تُحسب العمولة على صافي البيع قبل الضريبة وفق لقطة السياسة وقت البيع، ولا يُعاد احتساب المبيعات السابقة.</p>
            </div>
          )}
        </fieldset>
        <div className="flex justify-end">
          <Button onClick={save} disabled={mut.isPending} data-testid="button-save-seller-policy">
            {mut.isPending && <Loader2 className="me-1 size-4 animate-spin" />}حفظ السياسة
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------- Eligibility ----------------
function EligibilityCard({ ws }: { ws: Workspace }) {
  const emps = ws.employees ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><Users className="size-4" /> البائعون المؤهلون</CardTitle>
          <CardDescription>البائعون هم موظفو الموارد البشرية فقط، ولا يلزمهم حساب دخول. اسم البائع مستقل عن الكاشير.</CardDescription>
        </div>
        <Link href="/hr" className="text-sm text-primary hover:underline">إضافة موظف في الموارد البشرية</Link>
      </CardHeader>
      <CardContent className="p-0">
        {emps.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">لا يوجد موظفون. أضف الموظفين من الموارد البشرية أولاً.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>الحالة</TableHead><TableHead>مؤهل للبيع</TableHead><TableHead>الفروع</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{emps.map((e) => <EligibilityRow key={e.id} e={e} ws={ws} />)}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function EligibilityRow({ e, ws }: { e: Employee; ws: Workspace }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useConfigureSellerEligibility();
  const [enabled, setEnabled] = useState(e.eligible);
  const [all, setAll] = useState(e.branchIds === null);
  const [ids, setIds] = useState<number[]>(e.branchIds ?? []);
  const dirty = enabled !== e.eligible || all !== (e.branchIds === null) || (!all && JSON.stringify([...ids].sort()) !== JSON.stringify([...(e.branchIds ?? [])].sort()));
  const save = async () => {
    if (enabled && !all && ids.length === 0) { toast({ title: "اختر فرعًا واحدًا على الأقل أو كل الفروع", variant: "destructive" }); return; }
    try {
      await mut.mutateAsync({ data: { employeeId: e.id, enabled, branchIds: all ? null : ids } });
      toast({ title: `تم تحديث أهلية ${e.name}` });
      await qc.invalidateQueries({ queryKey: getGetSellerWorkspaceQueryKey() });
    } catch (err) { toast({ title: "فشل التحديث", description: errText(err), variant: "destructive" }); }
  };
  return (
    <TableRow data-testid={`row-eligibility-${e.id}`}>
      <TableCell className="font-medium">{e.name}{e.employeeNo && <span className="ms-1 text-xs text-muted-foreground">({e.employeeNo})</span>}</TableCell>
      <TableCell className="text-xs">{e.status === "active" ? "نشط" : e.status || "—"}</TableCell>
      <TableCell><input type="checkbox" checked={enabled} onChange={(x) => setEnabled(x.target.checked)} data-testid={`checkbox-eligible-${e.id}`} aria-label={`مؤهل ${e.name}`} /></TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2 text-xs">
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={all} onChange={(x) => setAll(x.target.checked)} /> كل فروع الشركة</label>
          {!all && ws.branches.map((b) => (
            <label key={b.id} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={ids.includes(b.id)} onChange={(x) => setIds(x.target.checked ? [...ids, b.id] : ids.filter((i) => i !== b.id))} />{b.name}
            </label>
          ))}
        </div>
      </TableCell>
      <TableCell><Button size="sm" variant="outline" disabled={!dirty || mut.isPending} onClick={save} data-testid={`button-save-eligibility-${e.id}`}>حفظ</Button></TableCell>
    </TableRow>
  );
}

// ---------------- Report ----------------
export function SellerReportCard({ ws }: { ws: Workspace }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [branchId, setBranchId] = useState<number | null>(null);
  const [sellerId, setSellerId] = useState<number | null>(null);
  const params = { from, to, ...(branchId ? { branchId } : {}), ...(sellerId ? { sellerId } : {}) };
  const q = useGetSellerReport(params, { query: { retry: false, enabled: !!from && !!to } });
  const rep = useMemo(() => (q.data ? parseReport(q.data) : null), [q.data]);
  const [correct, setCorrect] = useState<number | null>(null);
  const canCorrect = ws.permissions.has("seller_edit");
  const sellerOptions = ws.employees ?? ws.sellers;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Award className="size-4" /> تقرير مبيعات البائعين والعمولات</CardTitle>
        <CardDescription>حسب البائع المسند (وليس الكاشير). كل عملة منفصلة، ولا تُجمع أعداد الفواتير بين البائعين.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label className="text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" data-testid="input-report-from" /></div>
          <div><Label className="text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" data-testid="input-report-to" /></div>
          <div>
            <Label className="text-xs">الفرع</Label>
            <select className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm" value={branchId ?? 0} onChange={(e) => setBranchId(Number(e.target.value) || null)}>
              <option value={0}>كل الفروع</option>
              {ws.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="w-48">
            <Label className="text-xs">البائع</Label>
            <SellerSelect sellers={sellerOptions} value={sellerId} onChange={setSellerId} allowEmpty emptyLabel="كل البائعين" testId="select-report-seller" label="البائع" />
          </div>
        </div>

        {q.isLoading && <Skeleton className="h-40" data-testid="report-loading" />}
        {q.isError && (
          <div role="alert" className="flex items-center justify-between rounded-lg border border-destructive/40 p-3 text-sm">
            <span>{errText(q.error)}</span>
            <Button size="sm" variant="outline" onClick={() => q.refetch()}><RefreshCw className="me-1 size-4" />إعادة المحاولة</Button>
          </div>
        )}
        {rep && (
          <>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="rounded-lg bg-muted px-3 py-1.5" data-testid="report-unique-invoices">عدد الفواتير الفريدة: <b className="tabular-nums">{rep.uniqueInvoiceCount ?? "—"}</b></span>
              {rep.basis && <span className="rounded-lg bg-muted px-3 py-1.5">الأساس: {rep.basisDescription || (rep.basis === "net_pre_tax" ? "الصافي قبل الضريبة" : rep.basis)}</span>}
            </div>
            {rep.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid="report-warnings">
                {rep.warnings.map((w, i) => <li key={i} className="flex gap-1"><AlertTriangle className="size-3.5 shrink-0" />{w}</li>)}
              </ul>
            )}
            {rep.rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground" data-testid="report-empty">لا توجد مبيعات مسندة في الفترة المحددة.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table data-testid="report-rows">
                  <TableHeader><TableRow>
                    <TableHead>البائع</TableHead><TableHead>العملة</TableHead><TableHead>إجمالي المبيعات</TableHead><TableHead>الخصومات</TableHead>
                    <TableHead>المرتجعات</TableHead><TableHead>الإلغاءات</TableHead><TableHead>الصافي</TableHead><TableHead>فواتير البائع</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rep.rows.map((r, i) => (
                      <TableRow key={`${r.sellerId}-${r.currency}-${i}`}>
                        <TableCell className="font-medium">{r.sellerId == null ? <span className="text-amber-700 dark:text-amber-300">غير مسند (لا يوجد بائع محفوظ)</span> : r.sellerName}</TableCell>
                        <TableCell dir="ltr">{r.currency}</TableCell>
                        <TableCell className="tabular-nums">{fmtMoney(r.grossSales, r.currency)}</TableCell>
                        <TableCell className="tabular-nums">{fmtMoney(r.discounts, r.currency)}</TableCell>
                        <TableCell className="tabular-nums">{fmtMoney(r.returns, r.currency)}</TableCell>
                        <TableCell className="tabular-nums">{fmtMoney(r.cancellations, r.currency)}</TableCell>
                        <TableCell className="tabular-nums font-bold">{fmtMoney(r.net, r.currency)}</TableCell>
                        <TableCell className="tabular-nums">{r.invoiceCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot>
                    {totalsByCurrency(rep.rows, (r) => r.currency, (r) => r.net).map(([c, v]) => (
                      <tr key={c} className="border-t font-bold" data-testid={`report-total-${c}`}>
                        <td className="p-3" colSpan={6}>صافي {c}</td><td className="p-3 tabular-nums">{fmtMoney(v, c)}</td><td className="p-3 text-xs font-normal text-muted-foreground">انظر عدد الفواتير الفريدة</td>
                      </tr>
                    ))}
                  </tfoot>
                </Table>
              </div>
            )}
            <CommissionsTable rows={rep.commissions} ws={ws} onChanged={() => q.refetch()} />
            {rep.sources.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">مستندات المصدر</h4>
                <div className="overflow-x-auto rounded-lg border">
                  <Table data-testid="report-sources">
                    <TableHeader><TableRow><TableHead>المرجع</TableHead><TableHead>النوع</TableHead><TableHead>التاريخ</TableHead><TableHead>الصافي</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {rep.sources.map((x, i) => (
                        <TableRow key={`${x.invoiceId}-${x.invoiceLineId}-${i}`}>
                          <TableCell dir="ltr">{x.reference || (x.invoiceId ? `#${x.invoiceId}` : "—")}{x.invoiceLineId ? ` · بند ${x.invoiceLineId}` : ""}</TableCell>
                          <TableCell>{KIND_AR[x.kind] ?? x.kind}</TableCell>
                          <TableCell>{fmtDate(x.date)}</TableCell>
                          <TableCell className="tabular-nums">{fmtMoney(x.net, x.currency)}</TableCell>
                          <TableCell>
                            {canCorrect && x.invoiceId != null && (
                              <Button size="sm" variant="ghost" onClick={() => setCorrect(x.invoiceId)} data-testid={`button-correct-${x.invoiceId}-${i}`}>
                                <PenLine className="me-1 size-3.5" />تصحيح البائع
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
      {correct != null && <CorrectionDialog invoiceId={correct} ws={ws} onClose={() => setCorrect(null)} onDone={() => { setCorrect(null); void q.refetch(); }} />}
    </Card>
  );
}

const KIND_AR: Record<string, string> = { sale: "بيع", invoice: "فاتورة", pos: "نقطة بيع", return: "مرتجع", credit_note: "إشعار دائن", cancellation: "إلغاء", discount: "خصم" };

function CommissionsTable({ rows, ws, onChanged }: { rows: Commission[]; ws: Workspace; onChanged: () => void }) {
  const [action, setAction] = useState<{ c: Commission; kind: "approve" | "record_paid" } | null>(null);
  if (rows.length === 0) return <p className="text-xs text-muted-foreground" data-testid="commissions-empty">لا توجد عمولات محسوبة في الفترة. العمولة لا تُحتسب إلا عند تفعيلها في السياسة، ولا يُعاد بناء عمولات للفواتير القديمة.</p>;
  const canApprove = ws.permissions.has("commission_approve");
  const canPaid = ws.permissions.has("commission_paid");
  const byStatus = (st: string) => totalsByCurrency(rows.filter((r) => r.status === st), (r) => r.currency, (r) => r.amount);
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">العمولات</h4>
      <div className="grid gap-2 sm:grid-cols-3" data-testid="commission-totals">
        {(["calculated", "approved", "paid"] as const).map((st) => (
          <div key={st} className="rounded-lg border p-3 text-xs">
            <span className={`inline-block rounded-full px-2 py-0.5 font-semibold ${COMMISSION_STATUS[st].cls}`}>{COMMISSION_STATUS[st].text}</span>
            <div className="mt-2 space-y-0.5 tabular-nums">{byStatus(st).length === 0 ? "—" : byStatus(st).map(([c, v]) => <div key={c}>{fmtMoney(v, c)}</div>)}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="commission-rows">
          <TableHeader><TableRow><TableHead>البائع</TableHead><TableHead>الفاتورة</TableHead><TableHead>التاريخ</TableHead><TableHead>الأساس</TableHead><TableHead>العمولة</TableHead><TableHead>الحالة</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.map((c) => {
              const tone = COMMISSION_STATUS[c.status] ?? { text: c.status || "غير معروف", cls: "bg-muted" };
              return (
                <TableRow key={c.id} data-testid={`commission-${c.id}`}>
                  <TableCell>{c.sellerName}</TableCell>
                  <TableCell dir="ltr">{c.invoiceId ? `#${c.invoiceId}` : "—"}{c.invoiceLineId ? ` · ${c.invoiceLineId}` : ""}</TableCell>
                  <TableCell>{fmtDate(c.date)}</TableCell>
                  <TableCell className="tabular-nums">{fmtMoney(c.net, c.currency)}</TableCell>
                  <TableCell className="tabular-nums font-semibold">{fmtMoney(c.amount, c.currency)}</TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.cls}`}>{tone.text}</span>
                    {c.reference && <div className="mt-1 text-[11px] text-muted-foreground" dir="ltr">{c.reference}</div>}
                  </TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    {c.status === "calculated" && canApprove && <Button size="sm" variant="outline" onClick={() => setAction({ c, kind: "approve" })} data-testid={`button-approve-commission-${c.id}`}>اعتماد</Button>}
                    {c.status === "approved" && canPaid && <Button size="sm" variant="outline" onClick={() => setAction({ c, kind: "record_paid" })} data-testid={`button-paid-commission-${c.id}`}>توثيق دفع خارجي</Button>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {action && <CommissionActionDialog {...action} onClose={() => setAction(null)} onDone={() => { setAction(null); onChanged(); }} />}
    </div>
  );
}

function CommissionActionDialog({ c, kind, onClose, onDone }: { c: Commission; kind: "approve" | "record_paid"; onClose: () => void; onDone: () => void }) {
  const mut = useChangeCommissionState();
  const { toast } = useToast();
  const [ref, setRef] = useState("");
  const submit = async () => {
    if (ref.trim().length < 5) { toast({ title: kind === "approve" ? "أدخل مرجع/ملاحظة الاعتماد (5 أحرف على الأقل)" : "أدخل مرجع إثبات الدفع الخارجي (5 أحرف على الأقل)", variant: "destructive" }); return; }
    try {
      await mut.mutateAsync({ id: c.id, data: { action: kind, reference: ref.trim() } });
      toast({ title: kind === "approve" ? "تم اعتماد العمولة" : "تم توثيق الدفع الخارجي" });
      onDone();
    } catch (e) { toast({ title: "تعذر التنفيذ", description: errText(e), variant: "destructive" }); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{kind === "approve" ? "اعتماد العمولة" : "توثيق دفع خارجي للعمولة"}</DialogTitle></DialogHeader>
        <p className="text-sm">{c.sellerName} · {fmtMoney(c.amount, c.currency)}</p>
        {kind === "record_paid" && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid="paid-disclaimer">
            هذا الإجراء يوثق فقط دفعًا تم مسبقًا خارج النظام. لا يتم تنفيذ أي دفع ولا إنشاء قيد محاسبي.
          </p>
        )}
        <Label>{kind === "approve" ? "مرجع الاعتماد" : "مرجع إثبات الدفع (رقم التحويل/السند)"}</Label>
        <Input value={ref} onChange={(e) => setRef(e.target.value)} data-testid="input-commission-reference" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} disabled={mut.isPending} data-testid="button-confirm-commission">{mut.isPending && <Loader2 className="me-1 size-4 animate-spin" />}تأكيد</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CorrectionDialog({ invoiceId, ws, onClose, onDone }: { invoiceId: number; ws: Workspace; onClose: () => void; onDone: () => void }) {
  const mut = useCorrectInvoiceAttribution();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [detail, setDetail] = useState<InvoiceAttribution | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [whole, setWhole] = useState<number | null>(null);
  const [lineSel, setLineSel] = useState<Record<number, number | null>>({});
  const [reason, setReason] = useState("");
  // The ORIGINAL policy saved with the invoice governs the correction, not today's policy.
  const lineMode = detail?.policy?.granularity === "line";
  const sellerOptions = ws.employees?.filter((e) => e.eligible) ?? ws.sellers;
  const canCorrect = !!detail && detail.hasSnapshot && !!detail.policy;

  useEffect(() => {
    let off = false;
    apiGet<Record<string, unknown>>(`/sales/invoices/${invoiceId}`).then((d) => {
      if (off) return;
      const att = parseInvoiceAttribution(d, `#${invoiceId}`);
      setDetail(att);
      setWhole(att.sellerId);
      // Preload every saved line so editing one never clears unchanged others.
      setLineSel(Object.fromEntries(att.lines.map((l) => [l.id, l.sellerId])));
    }).catch((e) => !off && setLoadErr(errText(e)));
    return () => { off = true; };
  }, [invoiceId]);

  const mixedNames = detail ? Array.from(new Set(detail.lines.filter((l) => l.sellerId != null).map((l) => l.sellerName || `#${l.sellerId}`))) : [];
  const currentText = !detail ? "" : !detail.hasSnapshot
    ? "لا توجد لقطة بائع محفوظة لهذه الفاتورة (فاتورة سابقة لتفعيل الإسناد). لا يمكن التصحيح ولا تُستنتج عمولات تاريخية."
    : detail.sellerId != null ? (detail.sellerName || `#${detail.sellerId}`)
    : mixedNames.length > 1 ? `بائعون متعددون على مستوى البنود: ${mixedNames.join("، ")}`
    : mixedNames.length === 1 ? `على مستوى البنود: ${mixedNames[0]}`
    : "محفوظ بدون بائع (غير مسند)";

  const submit = async () => {
    if (reason.trim().length < 5) { toast({ title: "سبب التصحيح إلزامي (5 أحرف على الأقل)", variant: "destructive" }); return; }
    if (!detail || !canCorrect) return;
    try {
      await mut.mutateAsync({ id: invoiceId, data: {
        reason: reason.trim(), sellerEmployeeId: whole,
        lineSellers: lineMode ? detail.lines.map((l) => ({ invoiceLineId: l.id, employeeId: lineSel[l.id] ?? null })) : [],
      } });
      toast({ title: "تم تصحيح البائع وتسجيله في سجل التدقيق" });
      await qc.invalidateQueries({ queryKey: getGetSellerReportQueryKey() });
      onDone();
    } catch (e) { toast({ title: "رفض الخادم التصحيح", description: errText(e), variant: "destructive" }); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>تصحيح بائع الفاتورة {detail?.ref ?? `#${invoiceId}`}</DialogTitle></DialogHeader>
        {loadErr && <p role="alert" className="text-sm text-destructive">{loadErr}</p>}
        {!detail && !loadErr && <Skeleton className="h-24" />}
        {detail && (
          <div className="space-y-3" data-testid="correction-form">
            <p className="text-xs text-muted-foreground" data-testid="correction-current">
              البائع المحفوظ حاليًا: {currentText}
            </p>
            {detail.policy && <p className="text-[11px] text-muted-foreground" data-testid="correction-policy">سياسة وقت البيع{detail.policy.version != null ? ` (إصدار ${detail.policy.version})` : ""}: {MODE_AR[detail.policy.mode]} — {GRAN_AR[detail.policy.granularity]}</p>}
            {canCorrect && <>
            <div>
              <Label>بائع الفاتورة كاملة</Label>
              <SellerSelect sellers={sellerOptions} value={whole} onChange={setWhole} allowEmpty emptyLabel="بدون بائع" testId="select-correct-whole" label="بائع الفاتورة" />
            </div>
            {lineMode && detail.lines.map((l) => (
              <div key={l.id}>
                <Label className="text-xs">{l.description}{l.sellerId != null ? ` — المحفوظ: ${l.sellerName || `#${l.sellerId}`}` : ""}</Label>
                <SellerSelect sellers={sellerOptions} value={lineSel[l.id]} onChange={(v) => setLineSel({ ...lineSel, [l.id]: v })} allowEmpty emptyLabel="بدون بائع" testId={`select-correct-line-${l.id}`} label={`بائع ${l.description}`} />
              </div>
            ))}
            <div>
              <Label>سبب التصحيح (إلزامي)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} data-testid="textarea-correct-reason" />
            </div>
            </>}
            <p className="text-[11px] text-muted-foreground">لا يُعاد احتساب عمولات الفواتير القديمة؛ يرفض الخادم إعادة بناء العمولات بأثر رجعي.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} disabled={!canCorrect || mut.isPending} data-testid="button-submit-correction">{mut.isPending && <Loader2 className="me-1 size-4 animate-spin" />}حفظ التصحيح</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
