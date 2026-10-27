import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetTeamSetup,
  useGetAdministrationWorkspace,
  getGetAdministrationWorkspaceQueryKey,
  getGetTeamSetupQueryKey,
  useSaveTeamSetup,
  useSaveTeamPolicy,
  useGetTeamCatalog,
  getGetTeamCatalogQueryKey,
  useListTeamPeople,
  getListTeamPeopleQueryKey,
  useCreateTeamPerson,
  usePreviewTeamPerson,
  useUpdateTeamAccess,
  useInviteTeamPerson,
  useRevokeTeamInvitation,
  useListBranches,
  useListWarehouses,
  useListPermissionTemplates,
  getListPermissionTemplatesQueryKey,
  type PermissionTemplate,
  type TeamCatalog,
  type TeamGrantInput,
  type TeamPerson,
  type TeamPersonInput,
  type TeamPreview,
  type TeamSetup,
  type InviteTeamPerson201,
  type Branch,
  type Warehouse,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  Copy,
  Eye,
  History,
  KeyRound,
  Loader2,
  Lock,
  MonitorSmartphone,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  RESOURCE_LABEL,
  actionsFor,
  baseReadAction,
  availableKeys,
  buildActivationUrl,
  canInvite,
  emptyGrant,
  emptyPerson,
  errorStatus,
  errorText,
  fromDraft,
  fromLocalInput,
  isCostAction,
  needsDeviceSetup,
  normalizePerson,
  personToInput,
  statusMeta,
  toDraft,
  toLocalInput,
  validatePerson,
  type GrantResource,
  type LoginKind,
} from "@/lib/team-access";
import { RETURN_MODE_LABEL, actionLabel, applyReturnMode, returnMode, type ReturnMode } from "@/lib/pos-actions";
import { LegacyConversionPanel } from "@/components/legacy-conversion-panel";
import { PermissionTemplatesPanel } from "@/components/team/permission-templates-panel";
import { GrantSourceSelector } from "@/components/team/grant-source-selector";
import { grantSource, toManual } from "@/lib/team-access";

const TONE: Record<string, string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  off: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  info: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
};

function StatusPill({ status, testId }: { status: string; testId?: string }) {
  const m = statusMeta(status);
  return (
    <span data-testid={testId} className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE[m.tone])}>
      {m.label}
    </span>
  );
}

const branchLabel = (branches: Branch[] | undefined, id: number) => {
  const b = branches?.find((x) => x.id === id);
  return b ? `${b.nameAr || b.name}${b.city ? ` — ${b.city}` : ""}` : id ? `فرع #${id}` : "لم يُحدد";
};
const warehouseLabel = (warehouses: Warehouse[] | undefined, id: number) => {
  const w = warehouses?.find((x) => x.id === id);
  return w ? w.nameAr || w.name : `مستودع #${id}`;
};

type Editing = { personId: number | null; person: TeamPersonInput; revision: number | null; status: string | null; userId?: number | null; membershipDeparture?: "suspend"|"terminate"|null };

export default function TeamSetupPage() {
  const adminQ = useGetAdministrationWorkspace({ query: { queryKey: getGetAdministrationWorkspaceQueryKey(), retry: false } });
  if (adminQ.isLoading) {
    return <div className="mx-auto max-w-6xl" data-testid="state-team-setup-checking"><Skeleton className="h-28 w-full rounded-2xl" /></div>;
  }
  if (adminQ.error) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-destructive/40 bg-card p-6 text-center" role="alert" data-testid="state-team-setup-access-error">
        <AlertTriangle className="mx-auto mb-2 size-7 text-destructive" />
        <p className="font-bold">تعذر التحقق من صلاحياتك الإدارية</p>
        <p className="mt-1 text-sm text-muted-foreground">{errorText(adminQ.error)}</p>
        <Button className="mt-4" variant="outline" onClick={() => void adminQ.refetch()} data-testid="button-retry-team-access"><RefreshCw className="me-2 size-4" /> إعادة المحاولة</Button>
      </div>
    );
  }
  const rights = adminQ.data?.rights ?? [];
  if (!rights.includes("users")) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border bg-card p-8 text-center" data-testid="state-team-setup-forbidden">
        <Lock className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h1 className="text-lg font-bold">إعداد الفريق يتطلب مسؤوليتي «المستخدمون» و«الإعدادات» معًا</h1>
        <p className="mt-2 text-xs text-muted-foreground" data-testid="text-missing-rights">ينقصك: مسؤولية المستخدمين. إعدادات المنشأة المنفصلة متاحة في صفحة الإدارة لمن يملك مسؤوليتها.</p>
        <p className="mt-2 text-sm text-muted-foreground">اطلب من مدير النظام إضافة الأشخاص وتحديد مسؤولياتهم.</p>
        <Link href="/account/membership" className="mt-3 inline-block text-sm text-primary underline" data-testid="link-administration-forbidden">عضويتي في المنشأة</Link>
      </div>
    );
  }
  return <TeamSetupInner canSettings={rights.includes("settings")} canSubscription={rights.includes("subscription")} />;
}

function TeamSetupInner({ canSubscription,canSettings }: { canSubscription: boolean;canSettings:boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const setupQ = useGetTeamSetup({ query: { queryKey: getGetTeamSetupQueryKey(), refetchOnWindowFocus: false } });
  const catalogQ = useGetTeamCatalog({ query: { queryKey: getGetTeamCatalogQueryKey(), staleTime: 300_000 } });
  const peopleQ = useListTeamPeople({ query: { queryKey: getListTeamPeopleQueryKey() } });
  const { data: branches } = useListBranches();
  const { data: warehouses } = useListWarehouses();
  const saveSetup = useSaveTeamSetup();

  const revisionRef = useRef<number | null>(null);
  const [conflict, setConflict] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const restoredRef = useRef(false);
  const lastDraftRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const setup = setupQ.data;
  useEffect(() => {
    if (setup && revisionRef.current === null) revisionRef.current = setup.revision;
  }, [setup]);

  // Restore draft once (resumable setup).
  useEffect(() => {
    if (restoredRef.current || !setup || !peopleQ.data) return;
    restoredRef.current = true;
    const d = fromDraft(setup.draft);
    lastDraftRef.current = JSON.stringify(toDraft(d.person, d.selectedPersonId));
    if (d.selectedPersonId) {
      const p = peopleQ.data.find((x) => x.personId === d.selectedPersonId);
      if (p) {
        const base = personToInput(p);
        const person = d.person && d.person.creationKey === p.creationKey ? d.person : base;
        setEditing({ personId: p.personId, person, revision: p.revision, status: p.status, userId: p.userId, membershipDeparture:p.membershipDeparture });
        return;
      }
    }
    if (d.person && (d.person.name || d.person.grants.length)) {
      setEditing({ personId: null, person: d.person, revision: null, status: null });
    }
  }, [setup, peopleQ.data]);

  const saveRef = useRef(saveSetup.mutateAsync);
  saveRef.current = saveSetup.mutateAsync;

  const persist = async (mode: "solo" | "team", step: TeamSetup["step"], draft: Record<string, unknown>) => {
    if(!canSettings)return null;
    if (revisionRef.current === null) return null;
    setDraftState("saving");
    try {
      const next = await saveRef.current({ data: { expectedRevision: revisionRef.current, mode, step, draft } });
      revisionRef.current = next.revision;
      qc.setQueryData(getGetTeamSetupQueryKey(), next);
      setDraftState("saved");
      return next;
    } catch (err) {
      setDraftState("failed");
      if (errorStatus(err) === 409) setConflict(true);
      else toast({ title: "تعذر حفظ المسودة", description: errorText(err), variant: "destructive" });
      return null;
    }
  };

  // Debounced draft autosave (compared against what was last sent).
  const mode = setup?.mode ?? "team";
  useEffect(() => {
    if (!canSettings || !restoredRef.current || conflict || !setup || mode !== "team") return;
    const draft = toDraft(editing?.person ?? null, editing?.personId ?? null);
    const json = JSON.stringify(draft);
    if (json === lastDraftRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastDraftRef.current = json;
      void persist("team", editing ? "access" : "people", draft as Record<string, unknown>);
    }, 1200);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, conflict, mode,canSettings]);

  const reloadAll = async () => {
    setConflict(false);
    revisionRef.current = null;
    restoredRef.current = false;
    await Promise.all([setupQ.refetch(), peopleQ.refetch()]);
  };

  if (setupQ.isLoading || catalogQ.isLoading || peopleQ.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4" data-testid="state-team-setup-loading">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (setupQ.error || catalogQ.error || peopleQ.error || !setup || !catalogQ.data) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-destructive/40 bg-card p-6 text-center" role="alert" data-testid="state-team-setup-error">
        <AlertTriangle className="mx-auto mb-2 size-7 text-destructive" />
        <p className="font-bold">تعذر تحميل إعداد الفريق</p>
        <p className="mt-1 text-sm text-muted-foreground">{errorText(setupQ.error ?? catalogQ.error ?? peopleQ.error)}</p>
        <Button className="mt-4" variant="outline" onClick={() => void reloadAll()} data-testid="button-retry-team-setup">
          <RefreshCw className="me-2 size-4" /> إعادة المحاولة
        </Button>
      </div>
    );
  }

  const people = peopleQ.data ?? [];
  const catalog = catalogQ.data;

  const chooseMode = async (m: "solo" | "team") => {
    const next = await persist(m, m === "solo" ? "done" : "people", {});
    if (next) {
      lastDraftRef.current = JSON.stringify(toDraft(null, null));
      setEditing(null);
      toast({ title: m === "solo" ? "ستعمل بمفردك — يمكنك إضافة فريق لاحقًا" : "وضع الفريق مفعّل" });
    }
  };

  const steps: { key: TeamSetup["step"]; label: string }[] = [
    { key: "people", label: "الأشخاص" },
    { key: "access", label: "المسؤوليات" },
    { key: "review", label: "المراجعة" },
    { key: "done", label: "تم" },
  ];
  const stepIdx = steps.findIndex((s) => s.key === setup.step);

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-16" dir="rtl">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl border bg-card p-5 sm:p-7">
        <div className="pointer-events-none absolute -start-16 -top-20 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-primary">إعداد الفريق</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">من يعمل معك، وأين بالضبط؟</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              أضف الأشخاص، واربط كل واحد بفرع ومستودعات محددة وإجراءات بعينها. لا شيء يُمنح افتراضيًا، وكل تغيير يُراجع قبل حفظه.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/settings/users" className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium hover:border-primary/50" data-testid="link-administration"><ShieldCheck className="size-4" /> المستخدمون والصلاحيات</Link>
            <ModeButton active={setup.mode === "solo"} onClick={() => void chooseMode("solo")} icon={User} label="أعمل بمفردي" testId="button-mode-solo" disabled={!canSettings||saveSetup.isPending} />
            <ModeButton active={setup.mode === "team"} onClick={() => void chooseMode("team")} icon={Users} label="لدي فريق" testId="button-mode-team" disabled={!canSettings||saveSetup.isPending} />
          </div>
        </div>
        <ol className="relative mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs" data-testid="list-setup-steps">
          {steps.map((s, i) => (
            <li key={s.key} className={cn("flex items-center gap-2", i <= stepIdx ? "text-foreground" : "text-muted-foreground")}>
              <span className={cn("grid size-5 place-items-center rounded-full border text-[10px] font-bold", i < stepIdx && "border-primary bg-primary text-primary-foreground", i === stepIdx && "border-primary text-primary")}>{i + 1}</span>
              {s.label}
            </li>
          ))}
          <li className="ms-auto text-muted-foreground" data-testid="status-draft">
            {!canSettings&&"تعديلات الأشخاص تحفظ من أزرار الحفظ؛ إعداد المنشأة ومسودته لا يعدلان دون مسؤولية الإعدادات."}
            {draftState === "saving" && "جارٍ حفظ المسودة…"}
            {draftState === "saved" && `المسودة محفوظة · مراجعة ${revisionRef.current ?? setup.revision}`}
            {draftState === "failed" && <span className="text-destructive">لم تُحفظ المسودة — بياناتك ما زالت على الشاشة</span>}
          </li>
        </ol>
      </section>

      {conflict && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="banner-setup-conflict">
          <AlertTriangle className="size-5 shrink-0" />
          <p className="flex-1 text-sm">عُدّل الإعداد من جلسة أخرى. توقف الحفظ التلقائي حتى لا تُستبدل تغييرات أحد. أعد التحميل لاستكمال أحدث نسخة.</p>
          <Button size="sm" variant="outline" onClick={() => void reloadAll()} data-testid="button-reload-conflict">
            <RefreshCw className="me-2 size-4" /> إعادة التحميل
          </Button>
        </div>
      )}

      {setup.mode === "solo" ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center" data-testid="state-solo">
          <User className="mx-auto mb-3 size-9 text-primary" />
          <h2 className="text-lg font-bold">أنت تعمل بمفردك</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">لن يرى أحد غيرك بيانات المنشأة. عندما تحتاج زميلًا، اختر «لدي فريق» وأكمل من حيث توقفت.</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <PeopleRoster
            people={people}
            selectedId={editing?.personId ?? null}
            creatingNew={!!editing && editing.personId === null}
            branches={branches}
            onNew={() => setEditing({ personId: null, person: emptyPerson(), revision: null, status: null })}
            onSelect={(p) => setEditing({ personId: p.personId, person: personToInput(p), revision: p.revision, status: p.status, userId: p.userId, membershipDeparture:p.membershipDeparture })}
          />
          {editing ? (
            <PersonEditor
              key={editing.person.creationKey}
              editing={editing}
              catalog={catalog}
              branches={branches}
              warehouses={warehouses}
              onChange={(person) => setEditing((e) => (e ? { ...e, person } : e))}
              onClose={() => setEditing(null)}
              onSaved={(p) => {
                setEditing({ personId: p.personId, person: personToInput(p), revision: p.revision, status: p.status, userId: p.userId, membershipDeparture:p.membershipDeparture });
                void persist("team", "review", toDraft(null, p.personId) as Record<string, unknown>);
              }}
              onReload={async () => {
                const res = await peopleQ.refetch();
                const fresh = res.data?.find((x) => x.personId === editing.personId);
                if (fresh) setEditing({ personId: fresh.personId, person: personToInput(fresh), revision: fresh.revision, status: fresh.status, userId: fresh.userId, membershipDeparture:fresh.membershipDeparture });
              }}
            />
          ) : (
            <div className="grid place-items-center rounded-2xl border border-dashed bg-card p-10 text-center" data-testid="state-no-person-selected">
              <div>
                <UserPlus className="mx-auto mb-3 size-9 text-primary" />
                <h2 className="text-lg font-bold">{people.length ? "اختر شخصًا لمراجعة مسؤولياته" : "ابدأ بأول شخص في فريقك"}</h2>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">بيانات موارد بشرية أساسية فقط — لا رواتب ولا حسابات بنكية هنا.</p>
                <Button className="mt-4" onClick={() => setEditing({ personId: null, person: emptyPerson(), revision: null, status: null })} data-testid="button-add-first-person">
                  <Plus className="me-2 size-4" /> إضافة شخص
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {setup.mode === "team" && <PermissionTemplatesPanel catalogActions={catalog.actions} branches={branches} warehouses={warehouses} />}

      <LegacyConversionPanel branches={branches} warehouses={warehouses} />

      {canSubscription ? <><p className="text-[11px] text-amber-700 dark:text-amber-300" data-testid="text-policy-dev-only">سياسة الاشتراك هنا للتطوير فقط ولا تغيّر أي التزام تجاري حقيقي.</p><PolicyPanel setup={setup} /></> : <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground" data-testid="text-policy-no-subscription">سياسة الوحدات والمقاعد تتطلب مسؤولية «الاشتراك».</p>}
    </div>
  );
}

function ModeButton({ active, onClick, icon: Icon, label, testId, disabled }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string; testId: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50",
      )}
    >
      <Icon className="size-4" /> {label}
    </button>
  );
}

function PeopleRoster({ people, selectedId, creatingNew, branches, onNew, onSelect }: {
  people: TeamPerson[]; selectedId: number | null; creatingNew: boolean; branches: Branch[] | undefined;
  onNew: () => void; onSelect: (p: TeamPerson) => void;
}) {
  return (
    <aside className="h-fit rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="font-bold">الفريق <span className="text-sm font-normal text-muted-foreground">({people.length})</span></h2>
        <Button size="sm" variant={creatingNew ? "default" : "outline"} onClick={onNew} data-testid="button-new-person">
          <Plus className="me-1 size-4" /> شخص
        </Button>
      </div>
      {people.length === 0 ? (
        <p className="p-5 text-center text-sm text-muted-foreground" data-testid="state-roster-empty">لا يوجد أحد بعد.</p>
      ) : (
        <ul className="divide-y">
          {people.map((p) => {
            const branchIds = Array.from(new Set((p.grants ?? []).map((g) => g.branchId)));
            return (
              <li key={p.personId}>
                <button
                  type="button"
                  onClick={() => onSelect(p)}
                  data-testid={`row-person-${p.personId}`}
                  className={cn("w-full p-4 text-start transition-colors hover:bg-muted/50", selectedId === p.personId && "bg-primary/5 ring-1 ring-inset ring-primary/30")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    <StatusPill status={p.status} testId={`status-person-${p.personId}`} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground" dir="ltr" style={{ textAlign: "right" }}>{p.email ?? "بلا بريد"}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.loginKinds.length === 0 && <Badge variant="outline" className="text-[10px]">سجل فقط</Badge>}
                    {p.loginKinds.includes("platform") && <Badge variant="outline" className="text-[10px]">المنصة</Badge>}
                    {p.loginKinds.includes("pos") && <Badge variant="outline" className="text-[10px]">نقطة البيع</Badge>}
                    {branchIds.map((b) => <Badge key={b} variant="secondary" className="text-[10px]">{branchLabel(branches, b)}</Badge>)}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function PersonEditor({ editing, catalog, branches, warehouses, onChange, onClose, onSaved, onReload }: {
  editing: Editing; catalog: TeamCatalog; branches: Branch[] | undefined; warehouses: Warehouse[] | undefined;
  onChange: (p: TeamPersonInput) => void; onClose: () => void; onSaved: (p: TeamPerson) => void; onReload: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { person, personId } = editing;
  const isNew = personId === null;
  const preview = usePreviewTeamPerson();
  const create = useCreateTeamPerson();
  const update = useUpdateTeamAccess();
  const invite = useInviteTeamPerson();
  const revoke = useRevokeTeamInvitation();

  const [previewData, setPreviewData] = useState<{ forJson: string; result: TeamPreview } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saveError, setSaveError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [inviteResult, setInviteResult] = useState<InviteTeamPerson201 | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  const issues = useMemo(() => validatePerson(person, catalog.actions, warehouses), [person, catalog.actions, warehouses]);
  const normalized = useMemo(() => normalizePerson(person), [person]);
  const json = JSON.stringify(normalized);
  const previewFresh = previewData?.forJson === json;
  const avail = availableKeys(catalog.actions);
  const templatesQ = useListPermissionTemplates({ query: { queryKey: getListPermissionTemplatesQueryKey() } });
  const suspended = editing.status === "suspended";

  const set = (patch: Partial<TeamPersonInput>) => onChange({ ...person, ...patch });
  const setGrant = (i: number, patch: Partial<TeamGrantInput>) => set({ grants: person.grants.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  const toggleKind = (k: LoginKind) => set({ loginKinds: person.loginKinds.includes(k) ? person.loginKinds.filter((x) => x !== k) : [...person.loginKinds, k] });

  const refreshPeople = () => qc.invalidateQueries({ queryKey: getListTeamPeopleQueryKey() });

  const runPreview = async () => {
    setShowIssues(true);
    if (issues.length) return;
    setSaveError(null);
    try {
      const result = await preview.mutateAsync({ data: normalized });
      setPreviewData({ forJson: json, result });
      setPreviewOpen(true);
    } catch (err) {
      toast({ title: "تعذرت المعاينة", description: errorText(err), variant: "destructive" });
    }
  };

  const commit = async (suspendedFlag = suspended) => {
    setSaveError(null);
    try {
      const saved = isNew
        ? await create.mutateAsync({ data: normalized })
        : await update.mutateAsync({ id: personId!, data: { expectedRevision: editing.revision ?? 0, person: normalized, suspended: suspendedFlag } });
      setPreviewOpen(false);
      await refreshPeople();
      onSaved(saved);
      toast({ title: isNew ? "أُضيف الشخص" : suspendedFlag !== suspended ? (suspendedFlag ? "أوقف الوصول" : "استُعيد الوصول") : "حُفظت المسؤوليات" });
    } catch (err) {
      const conflict = errorStatus(err) === 409;
      setSaveError({ text: errorText(err), conflict });
      setPreviewOpen(false);
    }
  };

  const doInvite = async () => {
    if (personId === null || editing.revision === null) return;
    try {
      const res = await invite.mutateAsync({ id: personId, data: { expectedRevision: editing.revision } });
      setInviteResult(res);
      await refreshPeople();
      await onReload();
    } catch (err) {
      toast({ title: "تعذر إنشاء الدعوة", description: errorText(err), variant: "destructive" });
    }
  };

  const doRevoke = async () => {
    if (personId === null) return;
    try {
      await revoke.mutateAsync({ id: personId });
      toast({ title: "أُلغيت الدعوة — الرابط السابق لم يعد صالحًا" });
      await refreshPeople();
      await onReload();
    } catch (err) {
      toast({ title: "تعذر إلغاء الدعوة", description: errorText(err), variant: "destructive" });
    }
  };

  const addTemplate = (tpl: TeamCatalog["templates"][number]) => {
    const resource = tpl.resource as GrantResource;
    set({ grants: [...person.grants, { ...emptyGrant(resource), actions: tpl.actions.filter((a) => avail.has(a)) }] });
  };

  const saving = create.isPending || update.isPending;
  const issueFor = (path: string) => (showIssues ? issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`)) : []);

  return (
    <section className="space-y-4" data-testid="panel-person-editor">
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">{isNew ? "شخص جديد" : person.name || "بلا اسم"}</h2>
            {editing.status && <StatusPill status={editing.status} testId="status-editing-person" />}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-editor">إغلاق</Button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="person-name">الاسم</Label>
            <Input id="person-name" value={person.name} onChange={(e) => set({ name: e.target.value })} placeholder="مثال: ريم العتيبي" data-testid="input-person-name" />
            <FieldIssues list={issueFor("name")} />
          </div>
          <div>
            <Label htmlFor="person-email">البريد الإلكتروني (اختياري)</Label>
            <Input id="person-email" dir="ltr" type="email" value={person.email ?? ""} onChange={(e) => set({ email: e.target.value || null })} placeholder="name@company.sa" data-testid="input-person-email" disabled={!!editing.userId} />
            {!!editing.userId && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300" data-testid="text-email-locked">الحساب مفعّل — لا يمكن تغيير بريد هويته من هنا.</p>}
            <p className="mt-1 text-[11px] text-muted-foreground">بريد الشخص الحقيقي. لا ننشئ بريدًا وهميًا ولا نعتبره موثّقًا قبل أن يفعّل حسابه.</p>
            <FieldIssues list={issueFor("email")} />
          </div>
        </div>

        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-semibold">طريقة الدخول</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <KindCard checked={person.loginKinds.length === 0} onClick={() => set({ loginKinds: [] })} icon={User} title="سجل فقط" body="موظف في السجل دون أي دخول." testId="toggle-login-none" />
            <KindCard checked={person.loginKinds.includes("platform")} onClick={() => toggleKind("platform")} icon={KeyRound} title="المنصة" body="دخول سحابي بكلمة مرور كاملة." testId="toggle-login-platform" />
            <KindCard checked={person.loginKinds.includes("pos")} onClick={() => toggleKind("pos")} icon={ShoppingCart} title="نقطة البيع" body="بكلمة مرور كاملة — لا رمز PIN سريع." testId="toggle-login-pos" />
          </div>
          {needsDeviceSetup(person) && (
            <div className="mt-3 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="notice-device-setup">
              <MonitorSmartphone className="size-4 shrink-0" />
              <span>دخول نقطة البيع دون بريد يبقى «يتطلب جهازًا مسجّلًا» ولن يُفعّل حتى يتوفر تسجيل الأجهزة. أضف بريد الشخص الحقيقي إن أردت تفعيله الآن.</span>
            </div>
          )}
        </fieldset>
      </div>

      {/* Responsibilities */}
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold">المسؤوليات</h3>
            <p className="text-xs text-muted-foreground">كل مسؤولية مرتبطة بفرع واحد ومستودعاته فقط. أضف مسؤولية منفصلة لكل فرع.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => set({ grants: [...person.grants, emptyGrant("inventory")] })} data-testid="button-add-grant-inventory">
              <Package className="me-1 size-4" /> مخزون
            </Button>
            <Button size="sm" variant="outline" onClick={() => set({ grants: [...person.grants, emptyGrant("pos")] })} data-testid="button-add-grant-pos">
              <ShoppingCart className="me-1 size-4" /> نقطة بيع
            </Button>
          </div>
        </div>
        {catalog.templates.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">قوالب جاهزة (تحتاج اختيار الفرع):</span>
            {catalog.templates.map((t) => (
              <button key={t.key} type="button" onClick={() => addTemplate(t)} className="rounded-full border px-3 py-1 hover:border-primary hover:text-primary" data-testid={`button-template-${t.key}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <FieldIssues list={showIssues ? issues.filter((i) => i.path === "grants") : []} />

        {person.grants.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="state-no-grants">
            لا مسؤوليات بعد. الشخص لن يرى شيئًا حتى تضيف واحدة.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {person.grants.map((g, i) => (
              <GrantCard
                key={i}
                index={i}
                grant={g}
                catalog={catalog}
                branches={branches}
                warehouses={warehouses}
                issues={issueFor(`grants.${i}`)}
                templates={templatesQ.data ?? []}
                available={avail}
                onChange={(patch) => setGrant(i, patch)}
                onRemove={() => set({ grants: person.grants.filter((_, j) => j !== i) })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Denials */}
      <div className="rounded-2xl border bg-card p-5">
        <h3 className="font-bold">منع صريح</h3>
        <p className="text-xs text-muted-foreground">المنع يتقدّم على أي مسؤولية، حتى لو أضفتها لاحقًا.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {catalog.actions.filter((a) => a.available).map((a) => (
            <label key={a.key} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
              <Checkbox
                checked={person.deniedActions.includes(a.key)}
                onCheckedChange={(v) => set({ deniedActions: v ? [...person.deniedActions, a.key] : person.deniedActions.filter((x) => x !== a.key) })}
                data-testid={`checkbox-deny-${a.key}`}
              />
              <span className="flex-1">{actionLabel(a.key, a.label)}</span>
              <span className="text-[10px] text-muted-foreground">{RESOURCE_LABEL[a.resource] ?? a.resource}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">سلاسل الموافقات لهذه المسؤوليات غير مدعومة بعد، لذلك لا يوجد محرر لها هنا.</p>
      </div>

      {/* Actions */}
      {saveError && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center" data-testid="banner-save-error">
          <AlertTriangle className="size-5 shrink-0 text-destructive" />
          <span className="flex-1">لم يُحفظ شيء. {saveError.text} تعديلاتك ما زالت هنا.</span>
          {saveError.conflict && (
            <Button size="sm" variant="outline" onClick={() => { setSaveError(null); void onReload(); }} data-testid="button-reload-person">
              <RefreshCw className="me-2 size-4" /> فتح أحدث نسخة
            </Button>
          )}
        </div>
      )}
      {showIssues && issues.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="list-person-issues">
          <p className="mb-1 font-semibold">أكمل ما يلي قبل المعاينة:</p>
          <ul className="list-disc space-y-0.5 ps-5">{issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
        </div>
      )}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-2xl border bg-card/95 p-3 shadow-sm backdrop-blur">
        <Button onClick={() => void runPreview()} disabled={preview.isPending || saving} data-testid="button-preview-person">
          {preview.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Eye className="me-2 size-4" />}
          معاينة الوصول ثم الحفظ
        </Button>
        {!isNew && (
          <>
            {canInvite(person) && editing.status !== "suspended" && (
              <Button variant="outline" onClick={() => void doInvite()} disabled={invite.isPending} data-testid="button-invite-person">
                <KeyRound className="me-2 size-4" /> إنشاء رابط تفعيل
              </Button>
            )}
            {editing.status === "invited" && (
              <Button variant="ghost" onClick={() => void doRevoke()} disabled={revoke.isPending} data-testid="button-revoke-invitation">
                <Ban className="me-2 size-4" /> إلغاء الدعوة
              </Button>
            )}
            {suspended && editing.membershipDeparture==="terminate" ? (
              <span className="text-sm text-muted-foreground">عضوية منتهية؛ إعادة الانضمام تحتاج إجراءً مستقلًا مخوّلًا، وليست استعادة تعليق.</span>
            ) : suspended ? (
              <Button variant="outline" onClick={() => void commit(false)} disabled={saving} data-testid="button-restore-person">
                <RotateCcw className="me-2 size-4" /> استعادة الوصول
              </Button>
            ) : (
              <Button variant="ghost" className="text-destructive" onClick={() => setConfirmSuspend(true)} disabled={saving} data-testid="button-suspend-person">
                <Ban className="me-2 size-4" /> إيقاف الوصول
              </Button>
            )}
          </>
        )}
        <span className="ms-auto flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="text-history-note">
          <History className="size-3.5" /> كل حفظ وإيقاف ودعوة يُسجَّل في سجل التدقيق{editing.revision !== null ? ` · مراجعة ${editing.revision}` : ""}
        </span>
      </div>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>الوصول الفعلي بعد الحفظ</DialogTitle>
            <DialogDescription>هذا ما سيتمكن {normalized.name || "الشخص"} من فعله بالضبط، كما حسبه الخادم.</DialogDescription>
          </DialogHeader>
          {previewData && (
            <div className="space-y-3" data-testid="panel-preview-result">
              {previewData.result.grants.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">لا وصول فعلي — سجل فقط.</p>
              ) : (
                previewData.result.grants.map((g, i) => (
                  <div key={i} className="rounded-xl border p-3 text-sm" data-testid={`preview-grant-${i}`}>
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                      {g.resource === "pos" ? <ShoppingCart className="size-4 text-primary" /> : <Package className="size-4 text-primary" />}
                      {RESOURCE_LABEL[g.resource]} · <Building2 className="size-3.5" /> {branchLabel(branches, g.branchId)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">المستودعات: {g.warehouseIds.map((w) => warehouseLabel(warehouses, w)).join("، ")}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {g.actions.map((a) => <Badge key={a} variant="secondary">{actionLabel(a, catalog.actions.find((x) => x.key === a)?.label)}</Badge>)}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {g.amountLimit ? `سقف ${g.resource==="inventory"?"الحركة":g.resource==="procurement"?"أمر الشراء":"البيع"}: ${g.amountLimit} ر.س` : "بلا سقف إضافي"}
                      {g.startsAt && ` · من ${new Date(g.startsAt).toLocaleString("ar-SA")}`}
                      {g.endsAt && ` · حتى ${new Date(g.endsAt).toLocaleString("ar-SA")}`}
                    </div>
                  </div>
                ))
              )}
              {normalized.deniedActions.length > 0 && (
                <p className="text-xs"><span className="font-semibold">ممنوع صراحة:</span> {normalized.deniedActions.map((a) => actionLabel(a, catalog.actions.find((x) => x.key === a)?.label)).join("، ")}</p>
              )}
              {previewData.result.warnings.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="list-preview-warnings">
                  {previewData.result.warnings.map((w, i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w}</li>)}
                </ul>
              )}
              <p className="text-xs text-muted-foreground" data-testid="text-preview-slot">
                {previewData.result.reservesAccessSlot ? "سيحجز هذا الشخص مقعد دخول ضمن مخصصات المنشأة." : "لن يستهلك مقعد دخول."}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPreviewOpen(false)} data-testid="button-preview-back">رجوع للتعديل</Button>
            <Button onClick={() => void commit()} disabled={!previewFresh || saving} data-testid="button-confirm-save-person">
              {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <ShieldCheck className="me-2 size-4" />}
              تأكيد وحفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend confirm */}
      <Dialog open={confirmSuspend} onOpenChange={setConfirmSuspend}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إيقاف وصول {person.name}؟</DialogTitle>
            <DialogDescription>يتوقف الدخول وكل المسؤوليات فورًا. يبقى السجل وتاريخه، ويمكنك الاستعادة لاحقًا.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmSuspend(false)}>تراجع</Button>
            <Button variant="destructive" onClick={() => { setConfirmSuspend(false); void commit(true); }} data-testid="button-confirm-suspend">إيقاف الوصول</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InviteDialog result={inviteResult} name={person.name} onClose={() => setInviteResult(null)} />
    </section>
  );
}

function FieldIssues({ list }: { list: { message: string }[] }) {
  if (!list.length) return null;
  return <div className="mt-1 space-y-0.5">{list.map((i, k) => <p key={k} className="text-xs text-destructive">{i.message}</p>)}</div>;
}

function KindCard({ checked, onClick, icon: Icon, title, body, testId }: { checked: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; title: string; body: string; testId: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onClick} data-testid={testId}
      className={cn("flex items-start gap-3 rounded-xl border p-3 text-start transition-colors", checked ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
      <Icon className={cn("mt-0.5 size-4", checked ? "text-primary" : "text-muted-foreground")} />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{body}</span>
      </span>
    </button>
  );
}

function GrantCard({ index, grant, catalog, branches, warehouses, issues, onChange, onRemove, templates, available }: {
  index: number; grant: TeamGrantInput; catalog: TeamCatalog; branches: Branch[] | undefined; warehouses: Warehouse[] | undefined;
  issues: { message: string }[]; onChange: (p: Partial<TeamGrantInput>) => void; onRemove: () => void;
  templates: PermissionTemplate[]; available: Set<string>;
}) {
  const inherited = grantSource(grant) === "inherit";
  const branchWarehouses = (warehouses ?? []).filter((w) => w.branchId === grant.branchId);
  const actions = actionsFor(catalog.actions, grant.resource);
  return (
    <div className={cn("rounded-xl border p-4", issues.length ? "border-amber-400" : "")} data-testid={`card-grant-${index}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
          {grant.resource === "pos" ? <ShoppingCart className="size-4" /> : <Package className="size-4" />}
        </span>
        <Select value={grant.resource} onValueChange={(v) => onChange({ resource: v as GrantResource, actions: [], warehouseIds:[], amountLimit: null, ...toManual() })}>
          <SelectTrigger className="w-36" data-testid={`select-grant-resource-${index}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inventory">المخزون</SelectItem>
            <SelectItem value="pos">نقطة البيع</SelectItem>
            <SelectItem value="procurement">الموردون وأوامر الشراء</SelectItem>
            <SelectItem value="sales">فواتير العملاء — عرض وطباعة وتصدير مستقل</SelectItem>
          </SelectContent>
        </Select>
        <Select value={grant.branchId ? String(grant.branchId) : ""} onValueChange={(v) => onChange({ branchId: Number(v), warehouseIds: [] })}>
          <SelectTrigger className="w-52" data-testid={`select-grant-branch-${index}`}><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
          <SelectContent>
            {(branches ?? []).map((b) => <SelectItem key={b.id} value={String(b.id)}>{branchLabel(branches, b.id)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="ms-auto" onClick={onRemove} aria-label="حذف المسؤولية" data-testid={`button-remove-grant-${index}`}>
          <Trash2 className="size-4 text-rose-600" />
        </Button>
      </div>

      <GrantSourceSelector index={index} grant={grant} templates={templates} available={available} onChange={onChange} />
      {grant.resource==="sales"&&<p className="mt-3 text-sm text-muted-foreground">
        العرض شرط مستقل للطباعة والتصدير، ولا يمنحهما ضمنيًا. الفرع والفترة والمنع الفردي تطبق على كل إجراء.
        المستودع اختياري؛ تركه فارغًا يعني الفواتير ذات الفرع المثبت، لا كل الشركات.
        الحساب القديم يحتفظ بمساره حتى تحويل صريح ومعاينة معتمدة؛ لا تحويل تلقائي للأدوار غير المغطاة.
      </p>}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold">المستودعات في هذا الفرع</p>
          {!grant.branchId ? (
            <p className="text-xs text-muted-foreground">اختر الفرع أولًا.</p>
          ) : branchWarehouses.length === 0 ? (
            <p className="text-xs text-muted-foreground">لا مستودعات لهذا الفرع.</p>
          ) : (
            <div className="space-y-1.5">
              {branchWarehouses.map((w) => (
                <label key={w.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={grant.warehouseIds.includes(w.id)}
                    onCheckedChange={(v) => onChange({ warehouseIds: v ? [...grant.warehouseIds, w.id] : grant.warehouseIds.filter((x) => x !== w.id) })}
                    data-testid={`checkbox-grant-${index}-warehouse-${w.id}`}
                  />
                  {w.nameAr || w.name}
                </label>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold">الإجراءات المسموحة</p>
          <div className="space-y-1.5">
            {actions.map((a) => (
              <label key={a.key} className={cn("flex items-center gap-2 text-sm", !a.available && "opacity-60")}>
                <Checkbox
                  disabled={!a.available || inherited}
                  checked={grant.actions.includes(a.key)}
                  onCheckedChange={(v) => onChange({ actions: v ? [...grant.actions, a.key] : grant.actions.filter((x) => x !== a.key) })}
                  data-testid={`checkbox-grant-${index}-action-${a.key}`}
                />
                <span className="flex-1">{actionLabel(a.key, a.label)}</span>
                {!a.available && <span className="rounded border px-1.5 text-[10px] text-muted-foreground">غير مدعوم بعد</span>}
                {a.available && isCostAction(a.key) && <span className="rounded border border-amber-300 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">يكشف التكلفة</span>}
              </label>
            ))}
            {grant.resource === "pos" && !inherited && actions.some((a) => a.key === "pos.return.request" && a.available) && (
              <ReturnModeSelect index={index} grant={grant} directAvailable={actions.some((a) => a.key === "pos.return.direct" && a.available)} onChange={onChange} />
            )}
            {actions.length === 0 && <p className="text-xs text-muted-foreground">لا إجراءات معرّفة لهذا المورد.</p>}
            {actions.length > 0 && (
              <p className={cn("text-[11px]", grant.actions.length > 0 && !grant.actions.includes(baseReadAction(grant.resource)) ? "font-semibold text-destructive" : "text-muted-foreground")} data-testid={`text-grant-${index}-base-read`}>
                صلاحية العرض الأساسية ({baseReadAction(grant.resource)}) شرط لكل إجراء آخر، ولا تُضاف تلقائيًا. منعها يُسقط كل إجراءات المورد.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {(grant.resource !== "inventory" || grant.actions.some(a=>["inventory.move.receipt","inventory.move.issue","inventory.transfer.send","inventory.transfer.receive"].includes(a))) && (
          <div>
            <Label className="text-xs">{grant.resource==="inventory"?"سقف قيمة حركة المخزون المحسوبة خادميًا":grant.resource==="procurement"?"سقف قيمة أمر الشراء":grant.resource==="sales"?"سقف قيمة الفاتورة المعروضة (بالريال فقط)":"سقف قيمة البيع الواحد"} (ر.س)</Label>
            <Input dir="ltr" inputMode="decimal" placeholder="بلا سقف" value={grant.amountLimit ?? ""} onChange={(e) => onChange({ amountLimit: e.target.value || null })} data-testid={`input-grant-limit-${index}`} />
          </div>
        )}
        <div>
          <Label className="text-xs">يبدأ (اختياري)</Label>
          <Input type="datetime-local" value={toLocalInput(grant.startsAt)} onChange={(e) => onChange({ startsAt: fromLocalInput(e.target.value) })} data-testid={`input-grant-start-${index}`} />
        </div>
        <div>
          <Label className="text-xs">ينتهي (اختياري)</Label>
          <Input type="datetime-local" value={toLocalInput(grant.endsAt)} onChange={(e) => onChange({ endsAt: fromLocalInput(e.target.value) })} data-testid={`input-grant-end-${index}`} />
        </div>
      </div>
      <FieldIssues list={issues} />
    </div>
  );
}

function ReturnModeSelect({ index, grant, directAvailable, onChange }: { index: number; grant: TeamGrantInput; directAvailable: boolean; onChange: (p: Partial<TeamGrantInput>) => void }) {
  const mode = returnMode(grant.actions);
  const options: ReturnMode[] = directAvailable ? ["deny", "approval", "direct"] : ["deny", "approval"];
  return (
    <div className="mt-2 rounded-lg border border-dashed p-2" data-testid={`panel-grant-${index}-return-mode`}>
      <Label className="text-xs">الإرجاع (اختصار لخانتي الطلب والمباشر فقط)</Label>
      <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={mode}
        onChange={(e) => { const v = e.target.value as ReturnMode; if (v !== "custom") onChange({ actions: applyReturnMode(grant.actions, v) }); }}
        data-testid={`select-grant-${index}-return-mode`}>
        {options.map((m) => <option key={m} value={m}>{RETURN_MODE_LABEL[m]}</option>)}
        {mode === "custom" && <option value="custom" disabled>{RETURN_MODE_LABEL.custom}</option>}
      </select>
      <p className="mt-1 text-[11px] text-muted-foreground">لا يمنح استلام المخزون ولا الصرف ولا إثبات الرد الخارجي؛ فعّلها صراحة من الخانات أعلاه. الاعتماد نفسه غير متاح بعد.</p>
    </div>
  );
}

function InviteDialog({ result, name, onClose }: { result: InviteTeamPerson201 | null; name: string; onClose: () => void }) {
  const { toast } = useToast();
  const url = result ? buildActivationUrl(window.location.origin, import.meta.env.BASE_URL, result.activationToken) : "";
  return (
    <Dialog open={!!result} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>رابط تفعيل {name}</DialogTitle>
          <DialogDescription>يظهر مرة واحدة فقط. لم يُرسل أي بريد — سلّم الرابط للشخص بنفسك عبر قناة موثوقة.</DialogDescription>
        </DialogHeader>
        {result && (
          <div className="space-y-3">
            <div className="break-all rounded-lg border bg-muted/40 p-3 font-mono text-xs" dir="ltr" data-testid="text-activation-url">{url}</div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span data-testid="text-activation-expires">ينتهي: {new Date(result.expiresAt).toLocaleString("ar-SA")}</span>
              <span>·</span>
              <span data-testid="text-delivery-mode">التسليم: {result.deliveryMode === "manual-development" ? "يدوي (بيئة تطوير)" : result.deliveryMode}</span>
            </div>
            <p className="text-xs text-muted-foreground">البريد لا يُعدّ موثّقًا حتى يفعّل الشخص حسابه بنفسه. إن أُغلقت هذه النافذة فأنشئ رابطًا جديدًا.</p>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={async () => {
            try { await navigator.clipboard.writeText(url); toast({ title: "نُسخ الرابط" }); }
            catch { toast({ title: "تعذر النسخ — انسخه يدويًا", variant: "destructive" }); }
          }} data-testid="button-copy-activation"><Copy className="me-2 size-4" /> نسخ</Button>
          <Button onClick={onClose} data-testid="button-close-activation"><CheckCircle2 className="me-2 size-4" /> تم التسليم</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DEV_MODULES = [
  { key: "inventory", label: "المخزون" },
  { key: "pos", label: "نقطة البيع" },
];

function PolicyPanel({ setup }: { setup: TeamSetup }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useSaveTeamPolicy();
  const p = setup.policy;
  const [open, setOpen] = useState(false);
  const [modules, setModules] = useState<string[]>(p.enabledModules);
  const [seat, setSeat] = useState<string>(p.seatLimit == null ? "" : String(p.seatLimit));
  useEffect(() => { setModules(p.enabledModules); setSeat(p.seatLimit == null ? "" : String(p.seatLimit)); }, [p.enabledModules, p.seatLimit]);

  const submit = async () => {
    const n = seat.trim() === "" ? null : Number(seat);
    if (n !== null && (!Number.isInteger(n) || n < 0)) { toast({ title: "عدد المقاعد عدد صحيح موجب", variant: "destructive" }); return; }
    try {
      const policy = await save.mutateAsync({ data: { enabledModules: modules, seatLimit: n } });
      qc.setQueryData<TeamSetup>(getGetTeamSetupQueryKey(), (old) => (old ? { ...old, policy } : old));
      toast({ title: "حُدّثت مخصصات التطوير" });
    } catch (err) {
      toast({ title: "تعذر الحفظ", description: errorText(err), variant: "destructive" });
    }
  };

  return (
    <section className="rounded-2xl border bg-card p-5" data-testid="panel-policy">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h3 className="font-bold">المخصصات</h3>
          <p className="text-xs text-muted-foreground">
            مقاعد الدخول النشطة {p.activeLoginSeats}{p.seatLimit != null ? ` من ${p.seatLimit}` : ""} · محجوزة {p.reservedAccessSlots} · المصدر: {p.source}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} data-testid="button-toggle-policy">{open ? "إخفاء" : "محرر التطوير"}</Button>
      </div>
      {open && (
        <div className="mt-4 space-y-3 rounded-xl border border-dashed p-4">
          <p className="text-xs text-amber-700 dark:text-amber-300">أداة لبيئة التطوير فقط. ليست اشتراكًا مدفوعًا ولا أسعارًا ولا فوترة.</p>
          <div className="flex flex-wrap gap-4">
            {DEV_MODULES.map((m) => (
              <label key={m.key} className="flex items-center gap-2 text-sm">
                <Checkbox checked={modules.includes(m.key)} onCheckedChange={(v) => setModules(v ? [...modules, m.key] : modules.filter((x) => x !== m.key))} data-testid={`checkbox-module-${m.key}`} />
                {m.label}
              </label>
            ))}
          </div>
          <div className="max-w-xs">
            <Label className="text-xs">حد مقاعد الدخول (فارغ = بلا حد)</Label>
            <Input dir="ltr" inputMode="numeric" value={seat} onChange={(e) => setSeat(e.target.value)} data-testid="input-seat-limit" />
          </div>
          <Button size="sm" onClick={() => void submit()} disabled={save.isPending} data-testid="button-save-policy">حفظ المخصصات</Button>
        </div>
      )}
    </section>
  );
}
