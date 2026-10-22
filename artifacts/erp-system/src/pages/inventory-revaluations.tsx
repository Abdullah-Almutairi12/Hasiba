import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListInventoryRevaluations,
  useListRevaluationBalances,
  useListRevaluationAccounts,
  previewInventoryRevaluation,
  useTransitionInventoryRevaluation,
  getListInventoryRevaluationsQueryKey,
  getListRevaluationBalancesQueryKey,
} from "@workspace/api-client-react";
import type { InventoryRevaluation } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, ArrowRight, Scale, RefreshCw } from "lucide-react";

const READ_ROLES = ["owner", "manager", "inventory", "accountant", "auditor"];
const CREATE_ROLES = ["owner", "manager", "inventory", "accountant"];
const APPROVE_ROLES = ["owner", "manager", "accountant"];
const KEY_STORE = "inv-reval-idem";

function errMsg(e: unknown): string {
  const d = (e as { data?: { error?: string; message?: string } } | null)?.data;
  return d?.error ?? d?.message ?? (e instanceof Error ? e.message : "خطأ غير معروف");
}
const n = (v: string | number) => Number(v);
const money = (v: string | number) =>
  n(v).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const dt = (v?: string | null) => (v ? new Date(v).toLocaleString("ar-SA") : "—");

const STATUS: Record<string, { label: string; cls: string }> = {
  preview: { label: "معاينة", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  confirmed: { label: "بانتظار اعتماد المالية", cls: "bg-primary/15 text-primary" },
  posted: { label: "مُرحّل", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  cancelled: { label: "ملغى", cls: "bg-muted text-muted-foreground" },
};

function loadKey(intent: string): string | null {
  const raw = sessionStorage.getItem(KEY_STORE);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { intent: string; key: string };
  return parsed.intent === intent ? parsed.key : null;
}

export default function InventoryRevaluationsPage() {
  const { user } = useAuth();
  const role = user?.role ?? "";
  const canRead = READ_ROLES.includes(role);
  const canCreate = CREATE_ROLES.includes(role);
  const canApprove = APPROVE_ROLES.includes(role);
  const qc = useQueryClient();
  const { toast } = useToast();

  const list = useListInventoryRevaluations({
    query: { queryKey: getListInventoryRevaluationsQueryKey(), enabled: canRead, refetchOnMount: "always", refetchInterval: 20000 },
  });
  const balances = useListRevaluationBalances({
    query: { queryKey: getListRevaluationBalancesQueryKey(), enabled: canCreate, refetchOnMount: "always" },
  });
  const accounts = useListRevaluationAccounts({ query: { queryKey: ["/api/inventory/revaluation-accounts"], enabled: canCreate } });

  const [quantId, setQuantId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ row: InventoryRevaluation; action: "confirm" | "approve" | "cancel" } | null>(null);

  const intent = `${quantId}|${accountId}|${reason.trim()}`;
  const preview = useMutation({
    mutationFn: ({ data, key }: { data: { quantId: number; varianceAccountId: number; reason: string }; key: string }) =>
      previewInventoryRevaluation(data, { headers: { "Idempotency-Key": key } }),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getListInventoryRevaluationsQueryKey() });
    qc.invalidateQueries({ queryKey: getListRevaluationBalancesQueryKey() });
  };
  const invalidatePosting = () => {
    invalidateAll();
    qc.invalidateQueries({
      predicate: (q) => {
        const k = String(q.queryKey[0] ?? "");
        return /products|inventory|accounting|journal|trial-balance|balance-sheet|profit-loss|general-ledger|dashboard|warehouses/.test(k);
      },
    });
  };

  const transition = useTransitionInventoryRevaluation({
    mutation: {
      onSuccess: (row, vars) => {
        toast({ title: vars.action === "approve" ? `تم الترحيل — قيد #${row.journalEntryId ?? "—"}` : vars.action === "confirm" ? "تم التأكيد وإحالته للمالية" : "تم الإلغاء" });
        if (vars.action === "approve") invalidatePosting();
        else invalidateAll();
        setPending(null);
      },
      onError: (e) => {
        toast({ title: "تعذّر تنفيذ الإجراء", description: errMsg(e), variant: "destructive" });
        invalidateAll();
      },
    },
  });

  const selected = balances.data?.find((b) => String(b.id) === quantId);
  const reasonOk = reason.trim().length >= 5;
  const formValid = !!quantId && !!accountId && reasonOk;

  const submitPreview = async () => {
    setFormError(null);
    if (!formValid) return;
    let key: string;
    try {
      key = loadKey(intent) ?? crypto.randomUUID();
      sessionStorage.setItem(KEY_STORE, JSON.stringify({ intent, key }));
      if (loadKey(intent) !== key) throw new Error("verify");
    } catch {
      setFormError("تعذّر حفظ مفتاح منع التكرار في المتصفح؛ لم يُرسل الطلب. فعّل تخزين الجلسة ثم أعد المحاولة.");
      return;
    }
    preview.mutate(
      { data: { quantId: Number(quantId), varianceAccountId: Number(accountId), reason: reason.trim() }, key },
      {
        onSuccess: () => {
          try { sessionStorage.removeItem(KEY_STORE); } catch { /* Retain commit key if storage becomes unavailable. */ }
          setReason("");
          toast({ title: "تم إنشاء المعاينة", description: "راجع الأثر ثم أكّد الطلب." });
          invalidateAll();
        },
        onError: (e) => setFormError(errMsg(e)),
      },
    );
  };

  const rows = useMemo(() => [...(list.data ?? [])].sort((a, b) => b.id - a.id), [list.data]);
  const acctName = (id: number) => {
    const a = accounts.data?.find((x) => x.id === id);
    return a ? `${a.code} — ${a.nameAr}` : `#${id}`;
  };

  if (user && !canRead) {
    return (
      <Card><CardContent className="py-12 text-center text-muted-foreground" data-testid="text-no-access">
        لا تملك صلاحية عرض إعادة تقييم المخزون.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold"><Scale className="size-7 text-primary" /> إعادة تقييم المخزون</h1>
          <p className="mt-1 text-muted-foreground">تعديل تكلفة الرصيد إلى السعر المعياري بقيد محاسبي معتمد من المالية</p>
        </div>
        <Link href="/inventory/stocktake" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" data-testid="link-stocktake">
          <ArrowRight className="size-4" /> جرد المخزون
        </Link>
      </div>

      {canCreate && (
        <Card>
          <CardHeader><CardTitle>طلب معاينة جديد</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {(balances.isError || accounts.isError) && (
              <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <span>تعذّر تحميل الأرصدة أو الحسابات: {errMsg(balances.error ?? accounts.error)}</span>
                <Button size="sm" variant="outline" onClick={() => { balances.refetch(); accounts.refetch(); }}>إعادة المحاولة</Button>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>الرصيد (منتج / مستودع / دفعة / متغير)</Label>
                {balances.isLoading ? <Skeleton className="h-10" /> : (
                  <Select value={quantId} onValueChange={setQuantId}>
                    <SelectTrigger data-testid="select-quant"><SelectValue placeholder="اختر رصيداً" /></SelectTrigger>
                    <SelectContent>
                      {(balances.data ?? []).length === 0 && <div className="p-3 text-sm text-muted-foreground">لا توجد أرصدة</div>}
                      {(balances.data ?? []).map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.productName} · {b.warehouseName}{b.lotId ? ` · دفعة ${b.lotId}` : ""}{b.variantId ? ` · متغير ${b.variantId}` : ""} · كمية {b.quantity}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="grid gap-2">
                <Label>حساب الفروقات (مصروف / إيراد)</Label>
                {accounts.isLoading ? <Skeleton className="h-10" /> : (
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger data-testid="select-account"><SelectValue placeholder="اختر حساباً" /></SelectTrigger>
                    <SelectContent>
                      {(accounts.data ?? []).map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.nameAr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            {selected && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-sm animate-in fade-in md:grid-cols-4" data-testid="card-selected-quant">
                <div><div className="text-muted-foreground">الكمية</div><div className="font-mono">{selected.quantity}</div></div>
                <div><div className="text-muted-foreground">التكلفة الحالية</div><div className="font-mono">{money(selected.avgCost)}</div></div>
                <div><div className="text-muted-foreground">السعر المعياري</div><div className="font-mono text-primary">{money(selected.standardCost)}</div></div>
                <div><div className="text-muted-foreground">الفرق التقديري</div><div className="font-mono">{money(n(selected.quantity) * (n(selected.standardCost) - n(selected.avgCost)))}</div></div>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="reason">السبب (5 أحرف على الأقل)</Label>
              <Textarea id="reason" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} data-testid="input-reason" />
              {reason.length > 0 && !reasonOk && <p className="text-xs text-destructive">السبب قصير جداً</p>}
            </div>
            {formError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive animate-in fade-in" data-testid="text-form-error">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {formError}
              </div>
            )}
            <Button onClick={submitPreview} disabled={!formValid || preview.isPending} data-testid="button-preview">
              {preview.isPending ? "جارٍ إنشاء المعاينة…" : "إنشاء معاينة"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>طلبات إعادة التقييم</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => list.refetch()} disabled={list.isFetching} data-testid="button-refresh">
            <RefreshCw className={`size-4 ${list.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {list.isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : list.isError ? (
            <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <span>تعذّر تحميل الطلبات: {errMsg(list.error)}</span>
              <Button size="sm" variant="outline" onClick={() => list.refetch()}>إعادة المحاولة</Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground" data-testid="text-empty">لا توجد طلبات إعادة تقييم بعد</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>المنتج / المستودع</TableHead><TableHead>الكمية</TableHead>
                  <TableHead>التكلفة القديمة → المستهدفة</TableHead><TableHead>القيمة القديمة → الجديدة</TableHead>
                  <TableHead>الفرق</TableHead><TableHead>الحالة</TableHead><TableHead>السجل</TableHead><TableHead>إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const d = n(r.delta);
                  const isPendingRow = r.status === "preview" || r.status === "confirmed";
                  const selfApproval = user?.id === r.createdBy;
                  return (
                    <TableRow key={r.id} className="transition-colors" data-testid={`row-reval-${r.id}`}>
                      <TableCell className="font-mono text-xs">{r.id}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.productName}</div>
                        <div className="text-xs text-muted-foreground">{r.warehouseName} · رصيد #{r.quantId}</div>
                        <div className="mt-1 max-w-56 text-xs text-muted-foreground" title={r.reason}>السبب: {r.reason}</div>
                        <div className="text-xs text-muted-foreground">الحساب: {acctName(r.varianceAccountId)}</div>
                      </TableCell>
                      <TableCell className="font-mono">{r.quantity}</TableCell>
                      <TableCell className="font-mono text-xs">{money(r.oldCost)} → {money(r.targetCost)}</TableCell>
                      <TableCell className="font-mono text-xs">{money(r.oldValue)} → {money(r.newValue)}</TableCell>
                      <TableCell className={`font-mono font-semibold ${d > 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : ""}`} data-testid={`text-delta-${r.id}`}>
                        {d > 0 ? "+" : ""}{money(r.delta)}
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS[r.status]?.cls} variant="outline" data-testid={`status-reval-${r.id}`}>{STATUS[r.status]?.label ?? r.status}</Badge>
                        {r.journalEntryId && (
                          <Link href="/accounting" className="mt-1 block text-xs text-primary hover:underline">قيد #{r.journalEntryId}</Link>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div>أنشأه #{r.createdBy} · {dt(r.createdAt)}</div>
                        <div>تأكيد: {dt(r.confirmedAt)}</div>
                        <div>اعتمده {r.approvedBy ? `#${r.approvedBy}` : "—"} · {dt(r.approvedAt)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {r.status === "preview" && canCreate && (
                            <Button size="sm" onClick={() => setPending({ row: r, action: "confirm" })} data-testid={`button-confirm-${r.id}`}>تأكيد</Button>
                          )}
                          {r.status === "confirmed" && canApprove && (
                            <Button size="sm" disabled={selfApproval} title={selfApproval ? "لا يجوز اعتماد طلب أنشأته بنفسك" : undefined}
                              onClick={() => setPending({ row: r, action: "approve" })} data-testid={`button-approve-${r.id}`}>
                              اعتماد وترحيل
                            </Button>
                          )}
                          {r.status === "confirmed" && canApprove && selfApproval && (
                            <span className="text-[11px] text-muted-foreground">يتطلب معتمداً آخر</span>
                          )}
                          {isPendingRow && canCreate && (
                            <Button size="sm" variant="outline" onClick={() => setPending({ row: r, action: "cancel" })} data-testid={`button-cancel-${r.id}`}>إلغاء</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            إذا تغيّر السعر المعياري أو الرصيد بعد المعاينة سيرفض الخادم الترحيل؛ ألغِ الطلب وأنشئ معاينة جديدة.
          </p>
        </CardContent>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o && !transition.isPending) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.action === "approve" ? "اعتماد وترحيل القيد" : pending?.action === "confirm" ? "تأكيد الطلب" : "إلغاء الطلب"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {pending && (
                  <>
                    <div>{pending.row.productName} · {pending.row.warehouseName} · كمية {pending.row.quantity}</div>
                    <div className="font-mono">الفرق: {money(pending.row.delta)} على حساب {acctName(pending.row.varianceAccountId)}</div>
                    {pending.action === "approve" && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                        سيُنشأ قيد محاسبي مُرحّل وتُحدَّث تكلفة المخزون. التصحيح يتطلب إعادة تقييم مستقلة معتمدة، ولا يجوز عكس القيد منفردًا.
                      </div>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transition.isPending}>رجوع</AlertDialogCancel>
            <AlertDialogAction
              disabled={transition.isPending}
              onClick={(e) => { e.preventDefault(); if (pending) transition.mutate({ id: pending.row.id, action: pending.action }); }}
              data-testid="button-dialog-confirm"
            >
              {transition.isPending ? "جارٍ التنفيذ…" : pending?.action === "approve" ? "أؤكد الترحيل" : "متابعة"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
