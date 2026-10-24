import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListApprovalRules,
  useCreateApprovalRule,
  useUpdateApprovalRule,
  useDeleteApprovalRule,
  useListApprovalRequests,
  useGetApprovalRequest,
  useActOnApprovalRequest,
  useListDelegations,
  useCreateDelegation,
  useDeleteDelegation,
  useListFinancialLimits,
  useUpsertFinancialLimit,
  useListAutomationRules,
  useCreateAutomationRule,
  useUpdateAutomationRule,
  useDeleteAutomationRule,
  useListAutomationRuns,
  useListApproverCandidates,
  useListBranches,
  getGetApprovalRequestQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Workflow, Bot, Coins, UserCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DOC_TYPES = [
  { v: "purchase_order",  label: "أوامر الشراء" },
  { v: "sales_order",     label: "أوامر البيع" },
  { v: "credit_note",         label: "إشعارات دائنة (ترحيل)" },
  { v: "credit_note_cancel",  label: "إلغاء إشعارات دائنة" },
  { v: "payment_run",     label: "دفعات الموردين" },
  { v: "expense_claim",   label: "مطالبات المصروفات" },
  { v: "leave_request",   label: "طلبات الإجازة" },
  { v: "journal_entry",   label: "قيود محاسبية" },
  { v: "pos_over_limit",  label: "تجاوزات حدود نقاط البيع" },
];

const ROLES = ["owner", "manager", "accountant", "sales", "cashier", "inventory", "marketing", "auditor", "hr", "production"];
const ROLE_LABELS: Record<string, string> = {
  owner: "مالك المنشأة", manager: "مدير", accountant: "محاسب", sales: "مبيعات", cashier: "كاشير",
  inventory: "مستودع", marketing: "تسويق", auditor: "مدقق", hr: "موارد بشرية", production: "إنتاج",
};

function useInvalidateWorkflow() {
  const qc = useQueryClient();
  return (prefix: string) =>
    qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) && (q.queryKey[0] as string)?.includes(prefix),
    });
}

// ---------------------------------------------------------------------------
// Approval Matrix
// ---------------------------------------------------------------------------
function ApprovalMatrix() {
  const { toast } = useToast();
  const inv = useInvalidateWorkflow();
  const { data: rules } = useListApprovalRules();
  const { data: branches } = useListBranches();
  const create = useCreateApprovalRule();
  const update = useUpdateApprovalRule();
  const del = useDeleteApprovalRule();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState("purchase_order");
  const [minAmount, setMinAmount] = useState("0");
  const [maxAmount, setMaxAmount] = useState("");
  const [mode, setMode] = useState<"sequential" | "parallel">("sequential");
  const [branchId, setBranchId] = useState<string>("__all__");
  const [steps, setSteps] = useState<Array<{ sequence: number; approverRole: string; minAmount: number }>>([
    { sequence: 1, approverRole: "manager", minAmount: 0 },
  ]);

  const submit = async () => {
    try {
      await create.mutateAsync({
        data: {
          name,
          docType,
          minAmount: Number(minAmount),
          maxAmount: maxAmount === "" ? null : Number(maxAmount),
          mode,
          branchId: branchId === "__all__" ? null : Number(branchId),
          isActive: true,
          steps,
        },
      });
      toast({ title: "تم إنشاء قاعدة الاعتماد" });
      setOpen(false); setName(""); setMinAmount("0"); setMaxAmount("");
      setBranchId("__all__");
      setSteps([{ sequence: 1, approverRole: "manager", minAmount: 0 }]);
      inv("/workflow/approval-rules");
    } catch (err) {
      toast({ title: "تعذّر الحفظ", description: String(err), variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Workflow className="size-5" /> مصفوفة الاعتمادات</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="me-1 size-4" /> قاعدة جديدة</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>قاعدة اعتماد</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>الاسم</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>نوع المستند</Label>
                  <Select value={docType} onValueChange={setDocType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DOC_TYPES.map((d) => <SelectItem key={d.v} value={d.v}>{d.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>الوضع</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as "sequential" | "parallel")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sequential">تسلسلي</SelectItem>
                      <SelectItem value="parallel">متوازي</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>الحد الأدنى للمبلغ</Label><Input value={minAmount} onChange={(e) => setMinAmount(e.target.value)} /></div>
                <div><Label>الحد الأعلى (فارغ = بلا حد)</Label><Input value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} /></div>
                <div className="col-span-2">
                  <Label>الفرع (فارغ = جميع الفروع)</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">— جميع الفروع —</SelectItem>
                      {branches?.map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>{b.nameAr ?? b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>خطوات السلسلة</Label>
                  <Button variant="outline" size="sm" onClick={() =>
                    setSteps([...steps, { sequence: steps.length + 1, approverRole: "manager", minAmount: 0 }])
                  }><Plus className="me-1 size-3" /> خطوة</Button>
                </div>
                <div className="space-y-2">
                  {steps.map((s, i) => (
                    <div key={i} className="grid grid-cols-12 items-end gap-2 rounded border p-2">
                      <div className="col-span-2"><Label className="text-xs">ترتيب</Label><Input type="number" value={s.sequence} onChange={(e) => { const n = [...steps]; n[i] = { ...s, sequence: Number(e.target.value) }; setSteps(n); }} /></div>
                      <div className="col-span-5"><Label className="text-xs">دور المعتمِد</Label>
                        <Select value={s.approverRole} onValueChange={(v) => { const n = [...steps]; n[i] = { ...s, approverRole: v }; setSteps(n); }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-4"><Label className="text-xs">الحد الأدنى</Label><Input type="number" value={s.minAmount} onChange={(e) => { const n = [...steps]; n[i] = { ...s, minAmount: Number(e.target.value) }; setSteps(n); }} /></div>
                      <div className="col-span-1"><Button variant="ghost" size="icon" onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Trash2 className="size-4 text-rose-600" /></Button></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter><Button onClick={submit} disabled={!name || steps.length === 0}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>الاسم</TableHead><TableHead>المستند</TableHead><TableHead>الوضع</TableHead>
            <TableHead>المبلغ</TableHead><TableHead>الخطوات</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(rules ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{DOC_TYPES.find((d) => d.v === r.docType)?.label ?? r.docType}</TableCell>
                <TableCell><Badge variant="outline">{r.mode === "sequential" ? "تسلسلي" : "متوازي"}</Badge></TableCell>
                <TableCell>{r.minAmount} → {r.maxAmount ?? "∞"}</TableCell>
                <TableCell>{r.steps.map((s) => s.approverRole).join(" → ")}</TableCell>
                <TableCell className="space-x-1 space-x-reverse">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await update.mutateAsync({ id: r.id, data: { isActive: !r.isActive } });
                      inv("/workflow/approval-rules");
                      toast({ title: r.isActive ? "تم تعطيل القاعدة" : "تم تفعيل القاعدة" });
                    }}
                  >
                    {r.isActive ? "تعطيل" : "تفعيل"}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={async () => { await del.mutateAsync({ id: r.id }); inv("/workflow/approval-rules"); }}><Trash2 className="size-4 text-rose-600" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {(!rules || rules.length === 0) && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">لا توجد قواعد بعد</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pending Approvals
// ---------------------------------------------------------------------------
function PendingApprovals() {
  const inv = useInvalidateWorkflow();
  const { data: requests } = useListApprovalRequests({ status: "pending" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: detail } = useGetApprovalRequest(selectedId ?? 0, {
    query: { enabled: !!selectedId, queryKey: getGetApprovalRequestQueryKey(selectedId ?? 0) },
  });
  const act = useActOnApprovalRequest();
  const [comment, setComment] = useState("");
  const { toast } = useToast();

  const submitAct = async (action: "approve" | "reject" | "request_changes") => {
    if (!selectedId) return;
    try {
      await act.mutateAsync({ id: selectedId, data: { action, comment: comment || null } });
      toast({ title: action === "approve" ? "تم الاعتماد" : action === "reject" ? "تم الرفض" : "تم طلب تعديلات" });
      setSelectedId(null); setComment("");
      inv("/workflow/approval-requests");
      inv("/workflow/inbox");
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><UserCheck className="size-5" /> طلبات بانتظار الاعتماد</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المرجع</TableHead><TableHead>المستند</TableHead><TableHead>المبلغ</TableHead>
            <TableHead>مُقدِّم الطلب</TableHead><TableHead>الخطوة</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(requests ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.recordRef ?? `#${r.recordId}`}</TableCell>
                <TableCell>{DOC_TYPES.find((d) => d.v === r.docType)?.label ?? r.docType}</TableCell>
                <TableCell>{r.amount.toLocaleString("ar-SA")}</TableCell>
                <TableCell>{r.submittedByName ?? "—"}</TableCell>
                <TableCell><Badge>الخطوة {r.currentStep}</Badge></TableCell>
                <TableCell><Button size="sm" onClick={() => setSelectedId(r.id)}>مراجعة</Button></TableCell>
              </TableRow>
            ))}
            {(!requests || requests.length === 0) && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">لا توجد طلبات معلّقة</TableCell></TableRow>}
          </TableBody>
        </Table>

        <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>طلب اعتماد {detail?.recordRef ?? ""}</DialogTitle></DialogHeader>
            {detail && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">المستند: </span>{DOC_TYPES.find((d) => d.v === detail.docType)?.label}</div>
                  <div><span className="text-muted-foreground">المبلغ: </span>{detail.amount.toLocaleString("ar-SA")}</div>
                  <div><span className="text-muted-foreground">مُقدِّم: </span>{detail.submittedByName ?? "—"}</div>
                  <div><span className="text-muted-foreground">الحالة: </span>{detail.status}</div>
                </div>
                <div>
                  <div className="mb-1 text-xs font-bold">السلسلة</div>
                  <ol className="list-decimal space-y-1 ps-5">
                    {detail.steps.map((s) => (
                      <li key={s.id}>دور: <Badge variant="outline">{s.approverRole}</Badge>{s.minAmount > 0 && ` (≥ ${s.minAmount})`}</li>
                    ))}
                  </ol>
                </div>
                {detail.actions.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-bold">السجل</div>
                    <ul className="space-y-1 text-xs">
                      {detail.actions.map((a) => (
                        <li key={a.id} className="rounded border p-1.5">
                          <strong>{a.approverName ?? "—"}</strong> — {a.action}
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
              <Button variant="outline" onClick={() => submitAct("request_changes")}>طلب تعديلات</Button>
              <Button variant="destructive" onClick={() => submitAct("reject")}>رفض</Button>
              <Button onClick={() => submitAct("approve")}>اعتماد</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Financial Limits
// ---------------------------------------------------------------------------
function FinancialLimits() {
  const { toast } = useToast();
  const inv = useInvalidateWorkflow();
  const { data: limits } = useListFinancialLimits();
  const upsert = useUpsertFinancialLimit();

  const [role, setRole] = useState("cashier");
  const [actionKey, setActionKey] = useState("pos.discount_pct");
  const [maxValue, setMaxValue] = useState("");
  const [description, setDescription] = useState("");

  const grouped = useMemo(() => {
    const m = new Map<string, typeof limits>();
    for (const l of limits ?? []) {
      const arr = m.get(l.actionKey) ?? [];
      arr.push(l);
      m.set(l.actionKey, arr);
    }
    return Array.from(m.entries());
  }, [limits]);

  const submit = async () => {
    try {
      await upsert.mutateAsync({
        data: {
          role,
          actionKey,
          maxValue: maxValue === "" ? null : Number(maxValue),
          description: description || null,
        },
      });
      toast({ title: "تم تحديث الحد المالي" });
      setMaxValue(""); setDescription("");
      inv("/workflow/financial-limits");
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Coins className="size-5" /> الحدود المالية لكل دور</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-2 rounded border p-3 md:grid-cols-5">
          <div><Label>الدور</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>المفتاح</Label><Input value={actionKey} onChange={(e) => setActionKey(e.target.value)} placeholder="pos.discount_pct" /></div>
          <div><Label>الحد الأعلى (فارغ = بلا حد)</Label><Input value={maxValue} onChange={(e) => setMaxValue(e.target.value)} /></div>
          <div><Label>الوصف</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="flex items-end"><Button onClick={submit} className="w-full">حفظ</Button></div>
        </div>
        {grouped.map(([key, rows]) => (
          <div key={key}>
            <div className="mb-1 text-sm font-bold">{key}</div>
            <Table>
              <TableHeader><TableRow><TableHead>الدور</TableHead><TableHead>الحد الأعلى</TableHead><TableHead>الوصف</TableHead></TableRow></TableHeader>
              <TableBody>
                {(rows ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell><Badge variant="outline">{l.role}</Badge></TableCell>
                    <TableCell>{l.maxValue == null ? "بلا حد" : l.maxValue}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.description ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Delegations
// ---------------------------------------------------------------------------
function Delegations() {
  const { toast } = useToast();
  const inv = useInvalidateWorkflow();
  const { data: dels } = useListDelegations();
  const { data: users } = useListApproverCandidates();
  const create = useCreateDelegation();
  const del = useDeleteDelegation();
  const [fromUserId, setFromUserId] = useState<number | null>(null);
  const [toUserId, setToUserId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");

  const submit = async () => {
    if (!fromUserId || !toUserId || !fromDate || !toDate) return;
    try {
      await create.mutateAsync({
        data: { fromUserId, toUserId, fromDate, toDate, reason: reason || null },
      });
      toast({ title: "تم إنشاء التفويض" });
      setReason("");
      inv("/workflow/delegations");
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    }
  };

  const userName = (id: number) => users?.find((u) => u.id === id)?.name ?? `#${id}`;

  return (
    <Card>
      <CardHeader><CardTitle>تفويض الصلاحيات</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 rounded border p-3 md:grid-cols-6">
          <div><Label>من</Label>
            <Select value={fromUserId?.toString() ?? ""} onValueChange={(v) => setFromUserId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
              <SelectContent>{(users ?? []).map((u) => <SelectItem key={u.id} value={u.id.toString()}>{u.name} ({u.role})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>إلى</Label>
            <Select value={toUserId?.toString() ?? ""} onValueChange={(v) => setToUserId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
              <SelectContent>{(users ?? []).map((u) => <SelectItem key={u.id} value={u.id.toString()}>{u.name} ({u.role})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>من تاريخ</Label><Input type="datetime-local" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div><Label>إلى تاريخ</Label><Input type="datetime-local" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          <div><Label>السبب</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="flex items-end"><Button onClick={submit} className="w-full">إضافة</Button></div>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>من</TableHead><TableHead>إلى</TableHead><TableHead>الفترة</TableHead><TableHead>السبب</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {(dels ?? []).map((d) => (
              <TableRow key={d.id}>
                <TableCell>{userName(d.fromUserId)}</TableCell>
                <TableCell>{userName(d.toUserId)}</TableCell>
                <TableCell className="text-xs">{new Date(d.fromDate).toLocaleString("ar-SA")} → {new Date(d.toDate).toLocaleString("ar-SA")}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.reason ?? "—"}</TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={async () => { await del.mutateAsync({ id: d.id }); inv("/workflow/delegations"); }}><Trash2 className="size-4 text-rose-600" /></Button></TableCell>
              </TableRow>
            ))}
            {(!dels || dels.length === 0) && <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">لا توجد تفويضات</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Automation Rules
// ---------------------------------------------------------------------------
function AutomationRules() {
  const { toast } = useToast();
  const inv = useInvalidateWorkflow();
  const { data: rules } = useListAutomationRules();
  const { data: runs } = useListAutomationRuns({});
  const create = useCreateAutomationRule();
  const updateRule = useUpdateAutomationRule();
  const del = useDeleteAutomationRule();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<"record_created" | "record_updated" | "state_changed" | "scheduled">("state_changed");
  const [entity, setEntity] = useState("purchase_order");
  const [state, setState] = useState("confirmed");
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  type Cond = { field: string; op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "contains"; value: string };
  type Act =
    | { type: "send_notification"; recipientRole: string; title: string; message: string; channel: "inapp" | "email" | "whatsapp" }
    | { type: "set_field"; field: string; value: string }
    | { type: "call_webhook"; url: string; method: "POST" | "PUT" | "PATCH"; payload?: string }
    | { type: "create_record"; entity: string; payload: string };
  const [conds, setConds] = useState<Cond[]>([]);
  const [actions, setActions] = useState<Act[]>([
    { type: "send_notification", recipientRole: "manager", title: "إشعار آلي", message: "حدث جديد على {{id}}", channel: "inapp" },
  ]);

  const submit = async () => {
    try {
      const trigger: Record<string, unknown> = { type: triggerType };
      if (triggerType === "scheduled") { trigger.intervalMinutes = Number(intervalMinutes); if (entity) trigger.entity = entity; }
      else { trigger.entity = entity; if (triggerType === "state_changed") trigger.state = state; }
      const serialActions = actions.map((a) => {
        if (a.type === "call_webhook") {
          let payload: unknown = undefined;
          if (a.payload) { try { payload = JSON.parse(a.payload); } catch { payload = a.payload; } }
          return { type: a.type, url: a.url, method: a.method, payload };
        }
        if (a.type === "create_record") {
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(a.payload || "{}"); } catch { payload = {}; }
          return { type: a.type, entity: a.entity, payload };
        }
        if (a.type === "set_field") {
          return { type: a.type, field: "notes", value: a.value };
        }
        return a;
      });
      await create.mutateAsync({
        data: {
          name,
          description: description || null,
          trigger,
          conditions: conds.map((c) => {
            let value: unknown = c.value;
            try { value = JSON.parse(c.value); } catch { /* keep string */ }
            return { field: c.field, op: c.op, value };
          }),
          actions: serialActions,
          isActive: true,
        },
      });
      toast({ title: "تم إنشاء قاعدة الأتمتة" });
      setOpen(false); setName(""); setDescription("");
      setConds([]);
      setActions([{ type: "send_notification", recipientRole: "manager", title: "إشعار آلي", message: "حدث جديد على {{id}}", channel: "inapp" }]);
      inv("/workflow/automation-rules");
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Bot className="size-5" /> قواعد الأتمتة</CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="me-1 size-4" /> قاعدة جديدة</Button></DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader><DialogTitle>قاعدة أتمتة</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">النطاق: الشركة الحالية وصلاحيات مُنشئ القاعدة عند التنفيذ. التعديل الآلي محصور بملاحظات أمر شراء مسودة، والإنشاء بتنبيه داخلي. لا تعديل مالي أو اعتماد آلي ولا إرسال خارجي. مصادر الأحداث المتحققة حاليًا: purchase_order وinvoice وleave_request.</p>
                <div><Label>الاسم</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>الوصف</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>نوع المحفّز</Label>
                    <Select value={triggerType} onValueChange={(v) => setTriggerType(v as typeof triggerType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="record_created">إنشاء سجل</SelectItem>
                        <SelectItem value="record_updated">تحديث سجل</SelectItem>
                        <SelectItem value="state_changed">تغيير حالة</SelectItem>
                        <SelectItem value="scheduled">مجدول</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {triggerType === "scheduled" ? (
                    <div><Label>كل (دقيقة)</Label><Input value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} /><Label>الكيان (فارغ لتنبيه زمني فقط)</Label><Input value={entity} onChange={e => setEntity(e.target.value)} placeholder="invoice" /></div>
                  ) : (
                    <div><Label>الكيان</Label><Input value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="purchase_order" /></div>
                  )}
                  {triggerType === "state_changed" && (
                    <div className="col-span-2"><Label>الحالة</Label><Input value={state} onChange={(e) => setState(e.target.value)} placeholder="confirmed" /></div>
                  )}
                </div>
                <div className="rounded border p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-bold">الشروط</div>
                    <Button variant="outline" size="sm" onClick={() =>
                      setConds([...conds, { field: "", op: "eq", value: "" }])
                    }><Plus className="me-1 size-3" /> شرط</Button>
                  </div>
                  <div className="space-y-1">
                    {conds.length === 0 && <div className="text-xs text-muted-foreground">بدون شروط — تنطبق على كل سجل.</div>}
                    {conds.map((c, i) => (
                      <div key={i} className="grid grid-cols-12 items-end gap-1">
                        <div className="col-span-4"><Input placeholder="الحقل" value={c.field} onChange={(e) => { const n = [...conds]; n[i] = { ...c, field: e.target.value }; setConds(n); }} /></div>
                        <div className="col-span-3">
                          <Select value={c.op} onValueChange={(v) => { const n = [...conds]; n[i] = { ...c, op: v as Cond["op"] }; setConds(n); }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {["eq","ne","gt","lt","gte","lte","contains"].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-4"><Input placeholder="القيمة" value={c.value} onChange={(e) => { const n = [...conds]; n[i] = { ...c, value: e.target.value }; setConds(n); }} /></div>
                        <div className="col-span-1"><Button variant="ghost" size="icon" onClick={() => setConds(conds.filter((_, j) => j !== i))}><Trash2 className="size-4 text-rose-600" /></Button></div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded border p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-bold">الإجراءات</div>
                    <Select value="" onValueChange={(v) => {
                      if (!v) return;
                      if (v === "send_notification") setActions([...actions, { type: "send_notification", recipientRole: "manager", title: "", message: "", channel: "inapp" }]);
                      if (v === "set_field") setActions([...actions, { type: "set_field", field: "notes", value: "" }]);
                      if (v === "call_webhook") setActions([...actions, { type: "call_webhook", url: "", method: "POST", payload: "" }]);
                      if (v === "create_record") setActions([...actions, { type: "create_record", entity: "notification_inbox", payload: "{}" }]);
                    }}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="+ إضافة إجراء" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="send_notification">إرسال إشعار</SelectItem>
                        <SelectItem value="set_field">ملاحظات مسودة شراء</SelectItem>
                        <SelectItem value="call_webhook" disabled>webhook — غير متاح دون موصل متحقق</SelectItem>
                        <SelectItem value="create_record">إنشاء تنبيه داخلي</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    {actions.map((a, i) => (
                      <div key={i} className="rounded border p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <Badge variant="outline" className="text-[10px]">{a.type}</Badge>
                          <Button variant="ghost" size="icon" onClick={() => setActions(actions.filter((_, j) => j !== i))}><Trash2 className="size-3.5 text-rose-600" /></Button>
                        </div>
                        {a.type === "send_notification" && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">دور المستلم</Label>
                              <Select value={a.recipientRole} onValueChange={(v) => { const n = [...actions]; n[i] = { ...a, recipientRole: v }; setActions(n); }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">القناة</Label>
                              <Select value={a.channel} onValueChange={(v) => { const n = [...actions]; n[i] = { ...a, channel: v as "inapp" | "email" | "whatsapp" }; setActions(n); }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="inapp">داخل النظام</SelectItem>
                                  <SelectItem value="email" disabled>بريد — غير مفعّل لهذا المسار</SelectItem>
                                  <SelectItem value="whatsapp" disabled>واتساب — غير مفعّل لهذا المسار</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-2"><Label className="text-xs">العنوان</Label><Input value={a.title} onChange={(e) => { const n = [...actions]; n[i] = { ...a, title: e.target.value }; setActions(n); }} /></div>
                            <div className="col-span-2"><Label className="text-xs">الرسالة</Label><Input value={a.message} onChange={(e) => { const n = [...actions]; n[i] = { ...a, message: e.target.value }; setActions(n); }} /></div>
                          </div>
                        )}
                        {a.type === "set_field" && (
                          <div className="grid grid-cols-2 gap-2">
                            <div><Label className="text-xs">الحقل المسموح</Label><Input value="notes" readOnly /></div>
                            <div><Label className="text-xs">الملاحظات (أمر شراء مسودة فقط)</Label><Input value={a.value} onChange={(e) => { const n = [...actions]; n[i] = { ...a, value: e.target.value }; setActions(n); }} /></div>
                          </div>
                        )}
                        {a.type === "call_webhook" && (
                          <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-2"><Label className="text-xs">URL</Label><Input value={a.url} onChange={(e) => { const n = [...actions]; n[i] = { ...a, url: e.target.value }; setActions(n); }} /></div>
                            <div>
                              <Label className="text-xs">الطريقة</Label>
                              <Select value={a.method} onValueChange={(v) => { const n = [...actions]; n[i] = { ...a, method: v as "POST" | "PUT" | "PATCH" }; setActions(n); }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="POST">POST</SelectItem>
                                  <SelectItem value="PUT">PUT</SelectItem>
                                  <SelectItem value="PATCH">PATCH</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-3"><Label className="text-xs">الحمولة (JSON اختياري)</Label><Textarea rows={2} value={a.payload ?? ""} onChange={(e) => { const n = [...actions]; n[i] = { ...a, payload: e.target.value }; setActions(n); }} /></div>
                          </div>
                        )}
                        {a.type === "create_record" && (
                          <div className="grid grid-cols-2 gap-2">
                            <div><Label className="text-xs">الجدول</Label>
                              <Select value={a.entity} onValueChange={(v) => { const n = [...actions]; n[i] = { ...a, entity: v }; setActions(n); }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="notification_inbox">notification_inbox</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="col-span-2"><Label className="text-xs">التنبيه (JSON: recipientRole، title، message)</Label><Textarea rows={3} placeholder={'{"recipientRole":"manager","title":"تذكير","message":"المستند {{reference}}"}'} value={a.payload} onChange={(e) => { const n = [...actions]; n[i] = { ...a, payload: e.target.value }; setActions(n); }} /></div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter><Button onClick={submit} disabled={!name}>حفظ</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>المحفّز</TableHead><TableHead>الإجراءات</TableHead><TableHead>آخر تنفيذ</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {(rules ?? []).map((r) => {
                const trig = r.trigger as { type: string; entity?: string; state?: string; intervalMinutes?: number };
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline">{trig.type}</Badge>{" "}
                      {trig.entity ?? ""}{trig.state ? ` → ${trig.state}` : ""}
                      {trig.intervalMinutes ? ` كل ${trig.intervalMinutes} د` : ""}
                    </TableCell>
                    <TableCell className="text-xs">{(r.actions as unknown[]).length} إجراء</TableCell>
                    <TableCell className="text-xs">{r.lastRunAt ? new Date(r.lastRunAt).toLocaleString("ar-SA") : "—"}</TableCell>
                    <TableCell className="space-x-1 space-x-reverse">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await updateRule.mutateAsync({ id: r.id, data: { isActive: !r.isActive } });
                          inv("/workflow/automation-rules");
                          toast({ title: r.isActive ? "تم تعطيل القاعدة" : "تم تفعيل القاعدة" });
                        }}
                      >
                        {r.isActive ? "تعطيل" : "تفعيل"}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={async () => { await del.mutateAsync({ id: r.id }); inv("/workflow/automation-rules"); }}><Trash2 className="size-4 text-rose-600" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!rules || rules.length === 0) && <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">لا توجد قواعد بعد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">سجل التنفيذ</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>الوقت</TableHead><TableHead>القاعدة</TableHead><TableHead>الحالة</TableHead><TableHead>السجلات</TableHead><TableHead>الإجراءات</TableHead></TableRow></TableHeader>
            <TableBody>
              {(runs ?? []).slice(0, 30).map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-xs">{new Date(run.triggeredAt).toLocaleString("ar-SA")}</TableCell>
                  <TableCell className="text-xs">#{run.ruleId}</TableCell>
                  <TableCell><Badge variant={run.status === "success" ? "default" : run.status === "failed" ? "destructive" : "secondary"}>{run.status}</Badge></TableCell>
                  <TableCell>{run.matchedRecords}</TableCell>
                  <TableCell>{run.actionsExecuted}</TableCell>
                </TableRow>
              ))}
              {(!runs || runs.length === 0) && <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">لا يوجد تنفيذ بعد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function WorkflowTab() {
  return (
    <Tabs defaultValue="approvals" className="space-y-4">
      <TabsList>
        <TabsTrigger value="approvals">الاعتمادات</TabsTrigger>
        <TabsTrigger value="matrix">المصفوفة</TabsTrigger>
        <TabsTrigger value="limits">الحدود المالية</TabsTrigger>
        <TabsTrigger value="delegations">التفويضات</TabsTrigger>
        <TabsTrigger value="automations">الأتمتة</TabsTrigger>
      </TabsList>
      <TabsContent value="approvals"><PendingApprovals /></TabsContent>
      <TabsContent value="matrix"><ApprovalMatrix /></TabsContent>
      <TabsContent value="limits"><FinancialLimits /></TabsContent>
      <TabsContent value="delegations"><Delegations /></TabsContent>
      <TabsContent value="automations"><AutomationRules /></TabsContent>
    </Tabs>
  );
}
