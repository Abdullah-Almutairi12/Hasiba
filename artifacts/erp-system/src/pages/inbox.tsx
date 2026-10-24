import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useListInbox,
  useMarkInboxRead,
  useMarkAllInboxRead,
  useListApprovalRequests,
  useGetApprovalRequest,
  useActOnApprovalRequest,
  useListDelegations,
  useCreateDelegation,
  useDeleteDelegation,
  useListApproverCandidates,
  useListBranches,
  getListInboxQueryKey,
  getGetApprovalRequestQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { CheckCheck, Inbox, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";

const DOC_LABELS: Record<string, string> = {
  purchase_order: "أمر شراء",
  sales_order: "أمر بيع",
  credit_note: "إشعار دائن (ترحيل)",
  credit_note_cancel: "إلغاء إشعار دائن",
  payment_run: "دفعة موردين",
  expense_claim: "مطالبة مصروف",
  leave_request: "طلب إجازة",
  journal_entry: "قيد محاسبي",
  pos_over_limit: "تجاوز حد نقطة البيع",
};

// ---------------------------------------------------------------------------
// Self-service delegation card. Any logged-in user can configure delegations
// FROM themselves to a colleague — useful when going on vacation. The same
// /workflow/delegations endpoint admins use is reused; the API enforces that
// non-admins can only create delegations from their own user id.
// ---------------------------------------------------------------------------
function MyDelegations() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const { data: dels, isLoading, error } = useListDelegations();
  const { data: users } = useListApproverCandidates();
  const { data: branches } = useListBranches();
  const create = useCreateDelegation();
  const del = useDeleteDelegation();
  const [toUserId, setToUserId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [branchId, setBranchId] = useState("all");
  const [docType, setDocType] = useState("purchase_order");
  const [maxAmount, setMaxAmount] = useState("");

  const inv = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        (q.queryKey[0] as string)?.includes("/workflow/delegations"),
    });
  const submit = async () => {
    if (!meId || !toUserId || !fromDate || !toDate) {
      toast({ title: "اكمل جميع الحقول", variant: "destructive" });
      return;
    }
    try {
      await create.mutateAsync({
        data: { fromUserId: meId, toUserId, fromDate: new Date(fromDate).toISOString(),
          toDate: new Date(toDate).toISOString(), reason: reason || null,
          branchId: branchId === "all" ? null : Number(branchId), docTypes: [docType],
          maxAmount: maxAmount === "" ? null : Number(maxAmount) },
      });
      toast({ title: "تم إنشاء التفويض" });
      setReason(""); setToUserId(null); setFromDate(""); setToDate("");
      inv();
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    }
  };
  const userName = (id: number) => users?.find((u) => u.id === id)?.name ?? `#${id}`;
  // Show only delegations the current user is involved in (from-or-to).
  const myDels = (dels ?? []).filter((d) => d.fromUserId === meId || d.toUserId === meId);

  return (
    <Card>
      <CardHeader><CardTitle>تفويضاتي</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">حدد نوع العملية والفرع والحد. التفويض لا يمنح وصولًا إلى مستندات غير مسموحة، وإلغاؤه لا يحذف تاريخ القرارات.</p>
        <div className="grid grid-cols-1 gap-2 rounded border p-3 md:grid-cols-5">
          <div>
            <Label>تفويض إلى</Label>
            <Select value={toUserId?.toString() ?? ""} onValueChange={(v) => setToUserId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="اختر زميلاً" /></SelectTrigger>
              <SelectContent>
                {(users ?? []).filter((u) => u.id !== meId).map((u) => (
                  <SelectItem key={u.id} value={u.id.toString()}>{u.name} ({APPROVAL_ROLES[u.role] ?? u.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>من تاريخ</Label><Input type="datetime-local" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div><Label>إلى تاريخ</Label><Input type="datetime-local" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          <div><Label>نوع العملية</Label><Select value={docType} onValueChange={setDocType}>
            <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(DOC_LABELS).map(([value, label]) =>
              <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>الفرع</Label><Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="all">كل الفروع — يتطلب صلاحية شاملة</SelectItem>
              {(branches ?? []).map(b => <SelectItem key={b.id} value={String(b.id)}>{b.nameAr || b.name}</SelectItem>)}
            </SelectContent></Select></div>
          <div><Label>حد قيمة العملية (بنفس وحدة نوعها)</Label><Input type="number" min="0" step="0.0001" value={maxAmount}
            placeholder="دون حد إضافي؛ تبقى حدود الشخص سارية" onChange={e => setMaxAmount(e.target.value)} /></div>
          <div><Label>السبب</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="flex items-end"><Button onClick={submit} disabled={create.isPending} className="w-full">{create.isPending ? "جارٍ الحفظ…" : "إضافة"}</Button></div>
        </div>
        {isLoading && <p role="status">جارٍ تحميل التفويضات…</p>}
        {error && <p role="alert" className="text-destructive">تعذر تحميل التفويضات، ولم تُمسح بيانات الإدخال.</p>}
        <Table>
          <TableHeader><TableRow>
            <TableHead>من</TableHead><TableHead>إلى</TableHead><TableHead>الفترة</TableHead>
            <TableHead>السبب</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {myDels.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{userName(d.fromUserId)}</TableCell>
                <TableCell>{userName(d.toUserId)}</TableCell>
                <TableCell className="text-xs">
                  {new Date(d.fromDate).toLocaleString("ar-SA")} → {new Date(d.toDate).toLocaleString("ar-SA")}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>{d.docTypes?.map(t => DOC_LABELS[t] ?? t).join("، ") || "قديم — يلزم مراجعة النطاق"}</div>
                  <div>{d.branchId ? branches?.find(b => b.id === d.branchId)?.nameAr || `فرع #${d.branchId}` : "نطاق المنشأة"} · الحد {d.maxAmount ?? "دون حد إضافي"}</div>
                  <div>{d.reason ?? "—"} · {d.revokedAt ? "ملغى — محفوظ تاريخيًا" : new Date(d.toDate) <= new Date() ? "منتهي" : "ضمن الفترة المحددة"}</div>
                </TableCell>
                <TableCell>
                  {d.fromUserId === meId && (
                    <Button variant="ghost" size="icon" aria-label="إلغاء التفويض مع حفظ السجل" disabled={!!d.revokedAt || del.isPending} onClick={async () => {
                      try { await del.mutateAsync({ id: d.id }); await inv(); toast({ title: "ألغي التفويض وحُفظ السجل" }); }
                      catch { toast({ title: "تعذر إلغاء التفويض", variant: "destructive" }); }
                    }}>
                      <Trash2 className="size-4 text-rose-600" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {myDels.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                لا توجد تفويضات. أضف واحدة قبل الإجازة لتمرير قراراتك إلى زميل.
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const APPROVAL_ROLES: Record<string, string> = {
  owner: "مالك المنشأة", manager: "مدير", accountant: "محاسب", hr: "الموارد البشرية",
  sales: "مبيعات", cashier: "كاشير", auditor: "مدقق", employee: "موظف", warehouse: "مستودع",
};
const APPROVAL_ACTIONS: Record<string, string> = {
  approve: "اعتماد", reject: "رفض", request_changes: "طلب تعديلات", comment: "تعليق", delegated: "تفويض",
};

export default function InboxPage() {
  const { isRTL } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: items } = useListInbox(
    {},
    { query: { refetchInterval: 30_000, queryKey: getListInboxQueryKey({}) } },
  );
  const { data: requests } = useListApprovalRequests({ status: "pending" });
  const markRead = useMarkInboxRead();
  const markAllRead = useMarkAllInboxRead();
  const act = useActOnApprovalRequest();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [selectedStepToken, setSelectedStepToken] = useState("");
  const decisionAttempt = useRef<{ intent: string; decisionId: string; stepToken: string } | null>(null);
  const decisionInFlight = useRef(false);
  useEffect(() => {
    setSelectedStepToken("");
    decisionAttempt.current = null;
  }, [selectedId]);

  // Deep-link: ?request=N opens that approval request directly. Used by
  // email notification links so approvers land on the action dialog.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("request");
    if (r && /^\d+$/.test(r)) setSelectedId(Number(r));
  }, []);

  const { data: detail } = useGetApprovalRequest(
    selectedId ?? 0,
    { query: { enabled: !!selectedId, refetchInterval: 30_000, queryKey: getGetApprovalRequestQueryKey(selectedId ?? 0) } },
  );

  const list = items ?? [];
  const reqs = requests ?? [];

  const invalidate = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        ((q.queryKey[0] as string)?.includes("/workflow/inbox") ||
          (q.queryKey[0] as string)?.includes("/workflow/approval-requests")),
    });

  const onActionClick = async (action: "approve" | "reject" | "request_changes") => {
    const step = detail?.actionableSteps?.find(s => s.stepToken === selectedStepToken) ?? detail?.actionableSteps?.[0];
    if (!selectedId || !step || decisionInFlight.current) return;
    // Polling may reveal a subsequent step. A retry remains bound to the
    // originally selected step until the user explicitly changes selection.
    const intent = JSON.stringify([selectedId, selectedStepToken, action, comment]);
    if (decisionAttempt.current?.intent !== intent) {
      decisionAttempt.current = { intent, decisionId: crypto.randomUUID(), stepToken: step.stepToken };
    }
    decisionInFlight.current = true;
    try {
      const result = await act.mutateAsync({ id: selectedId, data: {
        action, comment: comment || null, stepToken: decisionAttempt.current.stepToken, decisionId: decisionAttempt.current.decisionId,
      } });
      toast({
        title:
          action === "approve" ? (result.finished ? "تم الاعتماد" : "اعتمدت الخطوة؛ المراجعة مستمرة") :
          action === "reject" ? "تم الرفض" : "تم طلب تعديلات",
      });
      setSelectedId(null);
      setComment("");
      invalidate();
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    } finally {
      decisionInFlight.current = false;
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      <div className="flex items-end justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Inbox className="size-6" /> صندوق الوارد
        </h1>
        {list.some((i) => !i.isRead) && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => { await markAllRead.mutateAsync(); invalidate(); }}
          >
            <CheckCheck className="me-1 size-4" /> تعليم الكل كمقروء
          </Button>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>طلبات بانتظار اعتمادك</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>المرجع</TableHead>
              <TableHead>المستند</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>مُقدِّم الطلب</TableHead>
              <TableHead>الخطوة</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {reqs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.recordRef ?? `#${r.recordId}`}</TableCell>
                  <TableCell>{DOC_LABELS[r.docType] ?? r.docType}</TableCell>
                  <TableCell>{r.amount.toLocaleString("ar-SA")}</TableCell>
                  <TableCell>{r.submittedByName ?? "—"}</TableCell>
                  <TableCell><Badge>الخطوة {r.currentStep}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => setSelectedId(r.id)}>مراجعة</Button>
                  </TableCell>
                </TableRow>
              ))}
              {reqs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد طلبات بحاجة إلى إجراء منك
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الإشعارات — حالة القراءة مستقلة عن مهام الاعتماد</CardTitle></CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">لا توجد إشعارات</div>
          ) : (
            <ul className="divide-y">
              {list.map((it) => (
                <li
                  key={it.id}
                  className={`cursor-pointer px-2 py-2 hover:bg-muted/50 ${it.isRead ? "" : "bg-primary/5"}`}
                  onClick={async () => {
                    if (!it.isRead) await markRead.mutateAsync({ id: it.id });
                    invalidate();
                    if (it.link) {
                      const m = it.link.match(/request=(\d+)/);
                      if (m) setSelectedId(Number(m[1]));
                      else setLocation(it.link);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{it.title}</div>
                      {it.type === "approval" && <Badge variant={it.requiresAction ? "default" : "outline"}>
                        {it.requiresAction ? "يحتاج إجراء منك" : "إشعار محفوظ — لا يتطلب إجراء منك"}
                      </Badge>}
                      <div className="text-xs text-muted-foreground">{it.message}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(it.createdAt).toLocaleString("ar-SA")}
                      </div>
                    </div>
                    <Badge variant={it.isRead ? "outline" : "default"} className="shrink-0 text-[10px]">
                      {it.type === "approval" ? "اعتماد" : it.type === "automation" ? "أتمتة" : "نظام"}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <MyDelegations />

      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>طلب اعتماد {detail?.recordRef ?? ""}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              {detail.policyReviewRequired ? (
                <p role="status" className="rounded border border-amber-500 p-2">
                  لم تثبت سياسة هذه المراجعة وحقائق مصدرها، أو انتهت صلاحيتها. أعد تقديمها من المستند؛ لا يمكن اعتمادها مباشرة.
                  {detail.reviewInvalidatedReason && <span className="block">السبب: {detail.reviewInvalidatedReason}</span>}
                </p>
              ) : detail.policyRevision && (
                <p className="text-xs text-muted-foreground">نسخة السياسة المحفوظة: <code dir="ltr">{detail.policyRevision.slice(0, 12)}</code> · تبقى الصلاحيات الحالية مطلوبة.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">المستند: </span>{DOC_LABELS[detail.docType] ?? detail.docType}</div>
                <div><span className="text-muted-foreground">المبلغ: </span>{detail.amount.toLocaleString("ar-SA")}</div>
                <div><span className="text-muted-foreground">مُقدِّم: </span>{detail.submittedByName ?? "—"}</div>
                <div><span className="text-muted-foreground">الحالة: </span>{
                  ({ pending: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض", changes_requested: "بحاجة لتعديلات",
                    cancelled: "ملغى", consumed: "مستخدم في العملية" } as Record<string, string>)[detail.status] ?? "غير متاحة للإجراء"
                }</div>
              </div>
              <div>
                <div className="mb-1 text-xs font-bold">السلسلة</div>
                <ol className="list-decimal space-y-1 ps-5">
                  {detail.steps.map((s) => (
                    <li key={s.id}>الخطوة {s.sequence} · دور: <Badge variant="outline">{APPROVAL_ROLES[s.approverRole] ?? "دور مخصص"}</Badge></li>
                  ))}
                </ol>
              </div>
              {detail.actions.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-bold">السجل</div>
                  <ul className="space-y-1 text-xs">
                    {detail.actions.map((a) => (
                      <li key={a.id} className="rounded border p-1.5">
                        <strong>{a.approverName ?? "—"}</strong> — {APPROVAL_ACTIONS[a.action] ?? "إجراء محفوظ"}
                        {a.comment && <div className="text-muted-foreground">{a.comment}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div><Label>تعليق</Label><Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} /></div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {(detail?.actionableSteps?.length ?? 0) > 1 && <select aria-label="خطوة المراجعة"
              value={selectedStepToken || detail?.actionableSteps?.[0]?.stepToken || ""} onChange={e => setSelectedStepToken(e.target.value)}>
              {detail?.actionableSteps?.map(s => <option key={s.stepToken} value={s.stepToken}>الخطوة {s.sequence}</option>)}
            </select>}
            {!detail?.actionableSteps?.length && <p className="text-xs text-muted-foreground">لا يوجد إجراء متاح لصلاحيتك وحالة الطلب الحالية</p>}
            <Button disabled={act.isPending || !detail?.actionableSteps?.length} variant="outline" onClick={() => onActionClick("request_changes")}>طلب تعديلات</Button>
            <Button disabled={act.isPending || !detail?.actionableSteps?.length} variant="destructive" onClick={() => onActionClick("reject")}>رفض</Button>
            <Button disabled={act.isPending || !detail?.actionableSteps?.length || detail.policyReviewRequired} onClick={() => onActionClick("approve")}>اعتماد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
