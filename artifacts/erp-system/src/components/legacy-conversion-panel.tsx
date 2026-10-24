import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLegacyTeamUsers,
  getListLegacyTeamUsersQueryKey,
  usePreviewLegacyTeamConversion,
  useApplyLegacyTeamConversion,
  usePreviewLegacyTeamRollback,
  getPreviewLegacyTeamRollbackQueryKey,
  useRollbackLegacyTeamConversion,
  getListTeamPeopleQueryKey,
  type Branch,
  type LegacyTeamPreview,
  type LegacyTeamUser,
  type TeamGrantInput,
  type TeamPersonInput,
  type Warehouse,
} from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Loader2, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorText, fromLocalInput, toLocalInput } from "@/lib/team-access";
import {
  LEGACY_CEILING,
  MIN_ROLLBACK_REASON,
  conversionBody,
  initialLegacyPerson,
  isConverted,
  isReverted,
  legacyIssues,
  legacyKind,
  roleLabel,
  rollbackReasonOk,
  stateLabel,
} from "@/lib/legacy-conversion";

type Props = { branches: Branch[] | undefined; warehouses: Warehouse[] | undefined };

export function LegacyConversionPanel({ branches, warehouses }: Props) {
  const listQ = useListLegacyTeamUsers({ query: { queryKey: getListLegacyTeamUsersQueryKey() } });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const users = listQ.data ?? [];
  const selected = users.find((u) => u.userId === selectedId) ?? null;

  return (
    <section className="rounded-2xl border bg-card" data-testid="panel-legacy-conversion">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <div>
          <h2 className="flex items-center gap-2 font-bold"><ArrowLeftRight className="size-4 text-primary" /> تحويل المستخدمين القدامى</h2>
          <p className="text-xs text-muted-foreground">حوّل الكاشير وأمين المخزون إلى مسؤوليات محددة بفرع ومستودع. لا تُضاف أي صلاحية أوسع من دورهم الحالي.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void listQ.refetch()} data-testid="button-refresh-legacy"><RefreshCw className="size-4" /></Button>
      </div>
      {listQ.isLoading ? (
        <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : listQ.error ? (
        <div role="alert" className="p-4 text-sm text-destructive" data-testid="state-legacy-error">
          {errorText(listQ.error)}
          <Button size="sm" variant="outline" className="ms-2" onClick={() => void listQ.refetch()} data-testid="button-retry-legacy">إعادة المحاولة</Button>
        </div>
      ) : users.length === 0 ? (
        <p className="p-5 text-center text-sm text-muted-foreground" data-testid="state-legacy-empty">لا يوجد مستخدمون بصلاحيات قديمة.</p>
      ) : (
        <div className="grid gap-0 md:grid-cols-[280px_1fr]">
          <ul className="divide-y border-b md:border-b-0 md:border-e">
            {users.map((u) => (
              <li key={u.userId}>
                <button type="button" onClick={() => setSelectedId(u.userId)} data-testid={`row-legacy-${u.userId}`}
                  className={cn("w-full p-3 text-start hover:bg-muted/50", selectedId === u.userId && "bg-primary/5 ring-1 ring-inset ring-primary/30")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{u.name}</span>
                    <Badge variant="outline" className="text-[10px]" data-testid={`status-legacy-${u.userId}`}>{stateLabel(u.conversionState)}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{roleLabel(u.role)} · <span dir="ltr">{u.email ?? "بلا بريد"}</span></div>
                  {!u.eligible && !isConverted(u.conversionState) && !isReverted(u.conversionState) && (
                    <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300" data-testid={`text-legacy-blocked-${u.userId}`}>{u.reason || "غير مؤهل للتحويل."}</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="p-4">
            {!selected ? (
              <p className="text-sm text-muted-foreground" data-testid="state-legacy-none">اختر مستخدمًا لمراجعة حالته.</p>
            ) : isReverted(selected.conversionState) ? (
              <ReadOnlyNote user={selected} text="أُعيدت صلاحيات هذا المستخدم القديمة. السجل للقراءة فقط ولا يمكن تحويله مجددًا من هنا." />
            ) : isConverted(selected.conversionState) ? (
              <RollbackBox key={`rb-${selected.userId}`} user={selected} />
            ) : !selected.eligible || !legacyKind(selected.role) ? (
              <ReadOnlyNote user={selected} text={selected.reason || "غير مؤهل: يلزم مستخدم كاشير أو مخزون مرتبط بموظف واحد ودون صلاحيات مخصصة."} />
            ) : (
              <ConvertBox key={`cv-${selected.userId}`} user={selected} branches={branches} warehouses={warehouses} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ReadOnlyNote({ user, text }: { user: LegacyTeamUser; text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-4 text-sm" data-testid="state-legacy-readonly">
      <p className="font-bold">{user.name}</p>
      <p className="mt-1 text-muted-foreground">{text}</p>
    </div>
  );
}

function PreviewView({ p }: { p: LegacyTeamPreview }) {
  return (
    <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-sm" data-testid="panel-legacy-preview">
      <p>الدور الأصلي: <b data-testid="text-preview-role">{roleLabel(p.originalRole)}</b></p>
      <div className="flex flex-wrap gap-1" data-testid="list-preview-actions">
        {p.allowedActions.length ? p.allowedActions.map((a) => <Badge key={a} variant="secondary" dir="ltr">{a}</Badge>) : <span className="text-muted-foreground">لا إجراءات</span>}
      </div>
      {p.warnings.map((w, i) => (
        <p key={i} className="flex gap-2 text-amber-800 dark:text-amber-200" data-testid={`text-preview-warning-${i}`}><AlertTriangle className="size-4 shrink-0" />{w}</p>
      ))}
    </div>
  );
}

function ConvertBox({ user, branches, warehouses }: { user: LegacyTeamUser } & Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [person, setPerson] = useState<TeamPersonInput>(() => initialLegacyPerson(user)!);
  const [preview, setPreview] = useState<{ forJson: string; result: LegacyTeamPreview } | null>(null);
  const [done, setDone] = useState(false);
  const previewM = usePreviewLegacyTeamConversion();
  const applyM = useApplyLegacyTeamConversion();
  const kind = legacyKind(user.role)!;
  const g = person.grants[0];
  const issues = useMemo(() => legacyIssues(user, person), [user, person]);
  const body = conversionBody(user, person);
  const json = JSON.stringify(body);
  const fresh = preview?.forJson === json;

  const setGrant = (patch: Partial<TeamGrantInput>) => setPerson((p) => ({ ...p, grants: [{ ...p.grants[0], ...patch }] }));
  const branchWh = (warehouses ?? []).filter((w) => w.branchId === g.branchId);
  const branchOptions = user.branchId ? (branches ?? []).filter((b) => b.id === user.branchId) : branches ?? [];

  const runPreview = async () => {
    try {
      const result = await previewM.mutateAsync({ data: body });
      setPreview({ forJson: json, result });
    } catch (err) {
      toast({ title: "تعذرت المعاينة", description: errorText(err), variant: "destructive" });
    }
  };
  const apply = async () => {
    if (!fresh || !preview) return;
    try {
      await applyM.mutateAsync({ data: { ...body, expectedDigest: preview.result.digest } });
      setDone(true);
      toast({ title: "اكتمل التحويل" });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListLegacyTeamUsersQueryKey() }),
        qc.invalidateQueries({ queryKey: getListTeamPeopleQueryKey() }),
      ]);
    } catch (err) {
      setPreview(null);
      toast({ title: "تعذر التحويل", description: errorText(err), variant: "destructive" });
    }
  };

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" data-testid="state-legacy-converted">
        <CheckCircle2 className="mb-1 size-5" /> حُوّل {user.name} إلى مسؤوليات محددة. يظهر الآن ضمن الفريق.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="panel-legacy-convert">
      <div>
        <p className="font-bold" data-testid="text-legacy-name">{user.name}</p>
        <p className="text-xs text-muted-foreground">{roleLabel(user.role)} · <span dir="ltr">{user.email ?? "بلا بريد"}</span></p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>الفرع</Label>
          <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={g.branchId || ""} disabled={!!user.branchId}
            onChange={(e) => setGrant({ branchId: Number(e.target.value) || 0, warehouseIds: [] })} data-testid="select-legacy-branch">
            <option value="">اختر الفرع</option>
            {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.nameAr || b.name}</option>)}
            {user.branchId && !branchOptions.length && <option value={user.branchId}>فرع #{user.branchId}</option>}
          </select>
        </div>
        {kind === "pos" && (
          <div>
            <Label htmlFor="legacy-limit">سقف المبلغ (اختياري)</Label>
            <Input id="legacy-limit" dir="ltr" value={g.amountLimit ?? ""} onChange={(e) => setGrant({ amountLimit: e.target.value || null })} data-testid="input-legacy-limit" />
          </div>
        )}
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">المستودعات</legend>
        {branchWh.length === 0 ? <p className="text-xs text-muted-foreground">لا مستودعات لهذا الفرع.</p> : (
          <div className="flex flex-wrap gap-3">
            {branchWh.map((w) => (
              <label key={w.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={g.warehouseIds.includes(w.id)} data-testid={`check-legacy-wh-${w.id}`}
                  onCheckedChange={(c) => setGrant({ warehouseIds: c ? [...g.warehouseIds, w.id] : g.warehouseIds.filter((x) => x !== w.id) })} />
                {w.nameAr || w.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">الإجراءات (يمكن التضييق فقط)</legend>
        <div className="flex flex-wrap gap-3">
          {LEGACY_CEILING[kind].map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm" dir="ltr">
              <Checkbox checked={g.actions.includes(a)} data-testid={`check-legacy-action-${a}`}
                onCheckedChange={(c) => setGrant({ actions: c ? [...g.actions, a] : g.actions.filter((x) => x !== a) })} />
              {a}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>يبدأ (اختياري)</Label>
          <Input type="datetime-local" value={toLocalInput(g.startsAt)} onChange={(e) => setGrant({ startsAt: fromLocalInput(e.target.value) })} data-testid="input-legacy-starts" />
        </div>
        <div>
          <Label>ينتهي (اختياري)</Label>
          <Input type="datetime-local" value={toLocalInput(g.endsAt)} onChange={(e) => setGrant({ endsAt: fromLocalInput(e.target.value) })} data-testid="input-legacy-ends" />
        </div>
      </div>
      {issues.length > 0 && (
        <ul className="list-disc ps-5 text-xs text-destructive" data-testid="list-legacy-issues">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
      )}
      {preview && !fresh && <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="text-legacy-preview-stale">تغيّرت الإعدادات بعد المعاينة — أعد المعاينة قبل التطبيق.</p>}
      {preview && fresh && <PreviewView p={preview.result} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void runPreview()} disabled={issues.length > 0 || previewM.isPending} data-testid="button-legacy-preview">
          {previewM.isPending && <Loader2 className="me-2 size-4 animate-spin" />}معاينة
        </Button>
        <Button onClick={() => void apply()} disabled={!fresh || issues.length > 0 || applyM.isPending} data-testid="button-legacy-apply">
          {applyM.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <ShieldCheck className="me-2 size-4" />}تطبيق التحويل
        </Button>
      </div>
    </div>
  );
}

function RollbackBox({ user }: { user: LegacyTeamUser }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const previewQ = usePreviewLegacyTeamRollback(user.userId, {
    query: { enabled: open, queryKey: getPreviewLegacyTeamRollbackQueryKey(user.userId), staleTime: 0, gcTime: 0 },
  });
  const rollbackM = useRollbackLegacyTeamConversion();

  const doRollback = async () => {
    if (!previewQ.data || !rollbackReasonOk(reason) || !confirmed) return;
    try {
      const res = await rollbackM.mutateAsync({ id: user.userId, data: { expectedDigest: previewQ.data.digest, reason: reason.trim() } });
      toast({ title: res.restored ? "أُعيدت الصلاحيات القديمة" : "لم تتم الاستعادة", variant: res.restored ? "default" : "destructive" });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListLegacyTeamUsersQueryKey() }),
        qc.invalidateQueries({ queryKey: getListTeamPeopleQueryKey() }),
      ]);
      qc.removeQueries({ queryKey: getPreviewLegacyTeamRollbackQueryKey(user.userId) });
    } catch (err) {
      toast({ title: "تعذرت الاستعادة", description: errorText(err), variant: "destructive" });
      void previewQ.refetch();
    }
  };

  return (
    <div className="space-y-3" data-testid="panel-legacy-rollback">
      <p className="font-bold">{user.name}</p>
      <p className="text-sm text-muted-foreground">حُوّل هذا المستخدم إلى مسؤوليات محددة. يمكنك التراجع وإعادة دوره القديم بعد المعاينة.</p>
      {!open ? (
        <Button variant="outline" onClick={() => setOpen(true)} data-testid="button-legacy-rollback-preview"><RotateCcw className="me-2 size-4" />معاينة التراجع</Button>
      ) : previewQ.isLoading ? (
        <Skeleton className="h-24" />
      ) : previewQ.error || !previewQ.data ? (
        <div role="alert" className="text-sm text-destructive">{errorText(previewQ.error)} <Button size="sm" variant="outline" onClick={() => void previewQ.refetch()} data-testid="button-retry-rollback-preview">إعادة</Button></div>
      ) : (
        <>
          <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid="notice-rollback-broader">
            <AlertTriangle className="size-4 shrink-0" /> التراجع يعيد صلاحيات الدور القديم الأوسع ويزيل القيود المحددة بالفرع والمستودع.
          </div>
          <PreviewView p={previewQ.data} />
          <div>
            <Label htmlFor="rollback-reason">سبب التراجع (لا يقل عن {MIN_ROLLBACK_REASON} أحرف)</Label>
            <Input id="rollback-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-rollback-reason" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(!!c)} data-testid="check-rollback-confirm" />
            أفهم أن الصلاحيات القديمة الأوسع ستُستعاد.
          </label>
          <Button variant="destructive" disabled={!rollbackReasonOk(reason) || !confirmed || rollbackM.isPending} onClick={() => void doRollback()} data-testid="button-legacy-rollback">
            {rollbackM.isPending && <Loader2 className="me-2 size-4 animate-spin" />}تأكيد التراجع
          </Button>
        </>
      )}
    </div>
  );
}
