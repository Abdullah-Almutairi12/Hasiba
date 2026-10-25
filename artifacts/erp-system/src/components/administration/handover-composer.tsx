import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAdministrationWorkspaceQueryKey, useSaveAdministrationHandover, useCreateTeamPerson, useInviteTeamPerson, getListTeamPeopleQueryKey, type AdministrationHandover, type AdministrationHandoverInputDeparture, type AdministrationHandoverInputResponsibilitiesItem, type AdministrationWorkspace } from "@workspace/api-client-react";
import { Copy, KeyRound, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { buildActivationUrl, emptyPerson, errorText } from "@/lib/team-access";
import { DEPARTURE_LABEL } from "@/components/administration/shared";
import { RightsPicker } from "@/components/administration/members-panel";

type Candidate = { kind: "user" | "person"; id: number } | null;

const ALL_RESPONSIBILITIES = ["users", "administrators", "settings", "subscription", "contact"] as const;

export function HandoverComposer({ ws, existing, onClose, onSaved, ownerTransfer: ownerTransferProp = false }: { ws: AdministrationWorkspace; existing: AdministrationHandover | null; onClose: () => void; onSaved: () => void; ownerTransfer?: boolean }) {
  const ownerTransfer = ownerTransferProp || existing?.owner_transfer === true;
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useSaveAdministrationHandover();
  const createPerson = useCreateTeamPerson();
  const invite = useInviteTeamPerson();
  const id = useMemo(() => existing?.id ?? crypto.randomUUID(), [existing]);
  const [mode, setMode] = useState<"replace" | "add">(!ownerTransfer && (existing?.departure === "retain" || !ws.rights.includes("administrators")) ? "add" : "replace");
  const canReplace = ws.rights.includes("administrators");
  const [departure, setDeparture] = useState<AdministrationHandoverInputDeparture>((existing && existing.departure !== "retain" ? existing.departure : "stay") as AdministrationHandoverInputDeparture);
  const [resp, setResp] = useState<string[]>(ownerTransfer ? [...ALL_RESPONSIBILITIES] : existing?.responsibilities ?? ws.rights);
  const [cand, setCand] = useState<Candidate>(existing?.to_user_id ? { kind: "user", id: existing.to_user_id } : existing?.person_id ? { kind: "person", id: existing.person_id } : null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  // active is ADMINISTRATION status, not account eligibility. A former admin
  // who stayed employed can be appointed again, with fresh personal acceptance.
  const members = ws.members.filter((m) => m.id !== ws.userId && !m.primary_owner && (!m.status||m.status==="active"));
  const effDeparture: AdministrationHandoverInputDeparture = mode === "add" ? "retain" : departure;
  const destructive = DEPARTURE_LABEL[effDeparture].destructive;

  const inviteNew = async () => {
    setError(null);
    if (!newName.trim() || !/^\S+@\S+\.\S+$/.test(newEmail.trim())) { setError("أدخل الاسم وبريدًا حقيقيًا صحيحًا."); return; }
    try {
      const p = await createPerson.mutateAsync({ data: { ...emptyPerson(), name: newName.trim(), email: newEmail.trim(), loginKinds: ["platform"], grants: [], deniedActions: [] } });
      const r = await invite.mutateAsync({ id: p.personId, data: { expectedRevision: p.revision } });
      setInviteUrl(buildActivationUrl(window.location.origin, import.meta.env.BASE_URL, r.activationToken));
      setCand({ kind: "person", id: p.personId });
      await Promise.all([qc.invalidateQueries({ queryKey: getGetAdministrationWorkspaceQueryKey() }), qc.invalidateQueries({ queryKey: getListTeamPeopleQueryKey() })]);
    } catch (err) { setError(errorText(err)); }
  };

  const submit = async () => {
    setError(null);
    if (!cand) { setError("اختر البديل أو ادعُ شخصًا جديدًا."); return; }
    if (ownerTransfer && ALL_RESPONSIBILITIES.some((r) => !resp.includes(r))) { setError("نقل مالك النظام يتطلب جميع المسؤوليات الخمس."); return; }
    if (!resp.length) { setError("اختر مسؤولية إدارية واحدة على الأقل."); return; }
    if (mode === "replace" && !resp.includes("administrators")) { setError("الاستبدال (بقاء/تعليق/إنهاء) يتطلب تسليم مسؤولية «مديرو النظام». لتعيين مدير إضافي بمجموعة جزئية اختر «إضافة مدير إضافي»."); return; }
    try {
      await save.mutateAsync({ data: { id, expectedRevision: existing?.revision ?? 0, toUserId: cand.kind === "user" ? cand.id : null, personId: cand.kind === "person" ? cand.id : null, responsibilities: resp as AdministrationHandoverInputResponsibilitiesItem[], departure: effDeparture, ...(ownerTransfer ? { ownerTransfer: true } : {}) } });
      toast({ title: existing ? "حُفظت مراجعة جديدة — يلزم قبول البديل مجددًا" : "أُرسل الاقتراح إلى البديل" });
      onSaved();
    } catch (err) { setError(errorText(err)); }
  };

  const busy = createPerson.isPending || invite.isPending;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid={ownerTransfer ? "dialog-owner-transfer" : "dialog-handover"}>
        <DialogHeader><DialogTitle>{ownerTransfer ? (existing ? `تعديل نقل مالك النظام (مراجعة ${existing.revision})` : "نقل مسؤولية مالك النظام") : existing ? `تعديل التسليم (مراجعة ${existing.revision})` : "تسليم الإدارة أو إضافة مدير"}</DialogTitle>
          <DialogDescription>{existing ? "أي تعديل يُلغي قبول البديل السابق." : "يقبل البديل صراحة بعد تفعيل حسابه، ثم تنفذ أنت النسخة المقبولة."}</DialogDescription></DialogHeader>

        {ownerTransfer && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="notice-owner-transfer">
            <p className="font-bold">هذا ليس تسليم إدارة عاديًا</p>
            <p className="mt-1 text-xs">ينتقل التحكم الكامل في المنشأة إلى البديل، بما فيه العمليات المالية والمديرون والاشتراك. يُشترط حساب مفعّل وقبول صريح منه، وتُسلَّم المسؤوليات الخمس كاملة. صفة مالك النظام لا تثبت الملكية القانونية.</p>
          </div>
        )}

        {!ownerTransfer && <div role="radiogroup" aria-label="نوع الإجراء" className="grid gap-2 sm:grid-cols-2">
          {([["replace", "استبدالي بمدير آخر", "تختار ما يحدث لوصولك بعد التنفيذ."], ["add", "إضافة مدير إضافي", "تبقى كما أنت؛ يمكن اختيار أي مجموعة من مسؤولياتك."]] as const).map(([k, t, b]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} disabled={k === "replace" && !canReplace} title={k === "replace" && !canReplace ? "يتطلب مسؤولية مديرو النظام" : undefined} onClick={() => setMode(k)} data-testid={`radio-mode-${k}`}
              className={cn("rounded-xl border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50", mode === k ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:border-primary/40")}>
              <p className="text-sm font-bold">{t}</p><p className="text-xs text-muted-foreground">{b}</p>
            </button>
          ))}
        </div>}

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">البديل</legend>
          {members.length + ws.pending.length === 0 && <p className="text-xs text-muted-foreground" data-testid="state-no-candidates">لا أعضاء مفعّلون أو أشخاص معلقون — ادعُ شخصًا جديدًا أدناه.</p>}
          <div className="grid max-h-48 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {members.map((m) => <CandidateRadio key={`u${m.id}`} active={cand?.kind === "user" && cand.id === m.id} onClick={() => setCand({ kind: "user", id: m.id })} name={m.name} sub="عضو مفعّل" testId={`radio-candidate-user-${m.id}`} />)}
            {ws.pending.map((m) => <CandidateRadio key={`p${m.id}`} active={cand?.kind === "person" && cand.id === m.id} onClick={() => setCand({ kind: "person", id: m.id })} name={m.name} sub={m.status ?? "بانتظار التفعيل"} testId={`radio-candidate-person-${m.id}`} />)}
          </div>
          <div className="rounded-xl border border-dashed p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><UserPlus className="size-4 text-primary" /> دعوة بديل جديد</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <div><Label htmlFor="new-admin-name" className="sr-only">الاسم</Label><Input id="new-admin-name" placeholder="الاسم" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="input-new-admin-name" /></div>
              <div><Label htmlFor="new-admin-email" className="sr-only">البريد</Label><Input id="new-admin-email" dir="ltr" type="email" placeholder="name@company.sa" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} data-testid="input-new-admin-email" /></div>
              <Button variant="outline" disabled={busy} onClick={() => void inviteNew()} data-testid="button-invite-new-admin">{busy ? <Loader2 className="me-2 size-4 animate-spin" /> : <KeyRound className="me-2 size-4" />} إنشاء دعوة</Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">دخول المنصة فقط بلا أي مسؤوليات وظيفية. لا يُرسل شيء خارجيًا — انسخ الرابط وسلّمه بنفسك. لإعداد أغنى استخدم <Link href="/team-setup" className="underline">إعداد الفريق</Link>.</p>
            {inviteUrl && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted p-2" data-testid="panel-invite-link">
                <code dir="ltr" className="flex-1 truncate text-xs" data-testid="text-invite-link">{inviteUrl}</code>
                <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(inviteUrl).then(() => toast({ title: "نُسخ الرابط" }))} data-testid="button-copy-invite"><Copy className="size-4" /></Button>
              </div>
            )}
          </div>
        </fieldset>

        {ownerTransfer ? <p className="text-xs text-muted-foreground" data-testid="text-owner-transfer-rights">تُنقل جميع المسؤوليات الإدارية الخمس مع التحكم المالي الكامل.</p> : <>
        <RightsPicker value={resp} onChange={setResp} prefix="handover" options={ws.rights} />
        <p className="text-[11px] text-muted-foreground">لا تُمنح أي صلاحيات تشغيلية أو مالية مع الإدارة.</p></>}

        {mode === "replace" && (
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-semibold">ما يحدث لوصولك بعد التنفيذ</legend>
            {(["stay", "suspend", "terminate"] as const).map((d) => (
              <label key={d} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm", departure === d && "border-primary/50 bg-primary/5")}>
                <input type="radio" name="departure" className="mt-1 accent-[hsl(var(--primary))]" checked={departure === d} onChange={() => setDeparture(d)} data-testid={`radio-departure-${d}`} />
                <span><span className="font-medium">{DEPARTURE_LABEL[d].title}</span><span className="block text-xs text-muted-foreground">{DEPARTURE_LABEL[d].body}</span></span>
              </label>
            ))}
          </fieldset>
        )}
        {destructive && (
          <label className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm" data-testid="warning-departure">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="checkbox-departure-ack" />
            {ownerTransfer ? "أفهم أن وصولي سيتغير عند التنفيذ وأن البديل سيصبح مالك النظام بتحكم مالي كامل." : "أفهم أن وصولي سيتغير عند التنفيذ ولن تُمنح أي صلاحيات مالية تلقائيًا."}
          </label>
        )}
        {error && <p role="alert" className="text-sm text-destructive" data-testid="error-handover">{error}</p>}
        <DialogFooter><Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button disabled={save.isPending || (destructive && !ack)} onClick={() => void submit()} data-testid="button-save-handover">{save.isPending && <Loader2 className="me-2 size-4 animate-spin" />} {existing ? "حفظ مراجعة جديدة" : ownerTransfer ? "إرسال طلب نقل الملكية" : "إرسال للبديل"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CandidateRadio({ active, onClick, name, sub, testId }: { active: boolean; onClick: () => void; name: string; sub: string; testId: string }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick} data-testid={testId}
      className={cn("rounded-lg border px-3 py-2 text-start text-sm transition-colors", active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:border-primary/40")}>
      <span className="font-medium">{name}</span><span className="block text-[11px] text-muted-foreground">{sub}</span>
    </button>
  );
}

