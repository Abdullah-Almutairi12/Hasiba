import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetAdministrationWorkspace, getGetAdministrationWorkspaceQueryKey, useAppointPrimarySystemOwner, type AdministrationHandover, type AdministrationWorkspace } from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeftRight, Crown, Inbox, KeyRound, LogIn, RefreshCw, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth, ME_KEY } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { errorStatus, errorText } from "@/lib/team-access";
import { readAllEvidence, RightChips, Panel, Empty, type FinalizeEvidence } from "@/components/administration/shared";
import { IncomingCard, OutgoingCard, RecoveryCard } from "@/components/administration/handover-cards";
import { MembersPanel } from "@/components/administration/members-panel";
import { HandoverComposer } from "@/components/administration/handover-composer";
import { AdministrationSetupControls } from "@/components/administration/setup-controls";
import { MembershipDeparture } from "@/components/administration/membership-departure";
import {ProcurementReceivingPolicy} from "@/components/procurement-receiving-policy";

type Variant = "users" | "membership" | "legacy";

export function PrimaryOwnerPanel({ ws, onTransfer, onChanged }: { ws: AdministrationWorkspace; onTransfer: () => void; onChanged: () => void }) {
  const appoint = useAppointPrimarySystemOwner();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [ack, setAck] = useState(false);
  const owner = ws.members.find((m) => m.primary_owner || (ws.primaryOwnerId != null && m.id === ws.primaryOwnerId));
  const run = async () => {
    try {
      await appoint.mutateAsync({ data: { acknowledge: true } });
      toast({ title: "عُيّنت مالك النظام لهذه المنشأة" });
      await qc.invalidateQueries({ queryKey: ME_KEY });
    } catch (err) { toast({ title: "تعذر التعيين", description: errorText(err), variant: "destructive" }); }
    finally { onChanged(); }
  };
  return (
    <section className="rounded-2xl border border-amber-300/70 bg-gradient-to-l from-amber-50/70 to-card p-5 dark:border-amber-800 dark:from-amber-950/20" data-testid="panel-primary-owner">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 font-bold"><Crown className="size-4 text-amber-600" /> مالك النظام</p>
          <p className="mt-1 text-xs text-muted-foreground">مسؤولية حساب تعيّنها الجهة المشتركة، وليست إثباتًا للملكية القانونية. يملك التحكم الكامل داخل المنشأة بما فيه العمليات المالية، مع بقاء عزل الشركات وسلامة القيود والسجل.</p>
          <p className="mt-2 text-sm" data-testid="text-primary-owner">
            {ws.isPrimaryOwner ? "أنت مالك النظام لهذه المنشأة." : owner ? <>المالك الحالي: <span className="font-semibold">{owner.name}</span></> : ws.primaryOwnerId ? "عُيّن مالك للنظام." : "لم يُعيَّن مالك للنظام بعد."}
          </p>
        </div>
        {ws.isPrimaryOwner && <Button variant="outline" onClick={onTransfer} data-testid="button-owner-transfer"><ArrowLeftRight className="me-2 size-4" /> نقل مسؤولية مالك النظام</Button>}
      </div>
      {!ws.primaryOwnerId && !ws.isPrimaryOwner && (ws.canAppointPrimaryOwner ? (
        <div className="mt-4 rounded-xl border bg-card p-3" data-testid="panel-appoint-owner">
          <p className="text-sm font-semibold">تعيين أول مالك للنظام</p>
          <p className="mt-1 text-xs text-muted-foreground">حسابك مؤهل للتعيين الأول. لا يُحوَّل أي حامل للدور القديم تلقائيًا.</p>
          <label className="mt-2 flex items-start gap-2 text-sm"><Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="checkbox-appoint-ack" /> أقر بأنني مخوّل من الجهة المشتركة بتولي مسؤولية مالك النظام، بما فيها التحكم المالي الكامل.</label>
          <Button className="mt-3" size="sm" disabled={!ack || appoint.isPending} onClick={() => void run()} data-testid="button-appoint-owner"><Crown className="me-2 size-4" /> تعيين نفسي مالكًا للنظام</Button>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground" data-testid="state-owner-assignment-needed">يلزم تعيين موثّق من الجهة المشتركة لهذه المنشأة. لا يمكن تعيين مالك النظام من هنا بحسابك الحالي.</p>
      ))}
    </section>
  );
}

export default function AdministrationPage({ variant = "legacy" }: { variant?: Variant }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const wsKey = getGetAdministrationWorkspaceQueryKey();
  const wsQ = useGetAdministrationWorkspace({ query: { queryKey: wsKey, refetchInterval: 15_000, refetchOnWindowFocus: true, retry: false } });
  const [evidence, setEvidence] = useState<FinalizeEvidence[]>([]);
  const [composer, setComposer] = useState<{ handover: AdministrationHandover | null; ownerTransfer?: boolean } | null>(null);
  useEffect(() => { if (user?.id) setEvidence(readAllEvidence(user.id)); }, [user?.id]);
  const refreshEvidence = () => user?.id && setEvidence(readAllEvidence(user.id));
  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: wsKey }), qc.invalidateQueries({ queryKey: ME_KEY })]);
  const membership = variant === "membership";

  const recovery = user?.id && evidence.length > 0 && (
    <section className="space-y-2" data-testid="panel-finalize-recovery">
      {evidence.map((ev) => <RecoveryCard key={ev.id} ev={ev} userId={user.id} onDone={() => { refreshEvidence(); void invalidate(); }} />)}
    </section>
  );

  if (wsQ.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4" data-testid="state-administration-loading">
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-60 rounded-2xl" /><Skeleton className="h-60 rounded-2xl" /></div>
      </div>
    );
  }
  if (wsQ.error || !wsQ.data) {
    const st = errorStatus(wsQ.error);
    return (
      <div className="mx-auto max-w-xl space-y-4" dir="rtl">
        {recovery}
        <div className="rounded-2xl border border-destructive/40 bg-card p-6 text-center" role="alert" data-testid="state-administration-error">
          <AlertTriangle className="mx-auto mb-2 size-7 text-destructive" />
          <p className="font-bold">{st === 401 ? "انتهت جلستك في هذه المنشأة" : st === 403 ? "لا وصول إلى المستخدمين والصلاحيات في هذه المنشأة" : "تعذر التحميل"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{st === 401 ? "بعد تغيير الوصول تُبطل جلسات المنشأة. سجّل الدخول مجددًا؛ أي دليل تنفيذ محفوظ على هذا الجهاز لن يُحذف." : errorText(wsQ.error)}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => void wsQ.refetch()} data-testid="button-retry-administration"><RefreshCw className="me-2 size-4" /> إعادة المحاولة</Button>
            {st === 401 && <Link href="/login" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" data-testid="link-relogin"><LogIn className="me-2 size-4" /> تسجيل الدخول</Link>}
            {(st === 401 || st === 403) && <Link href="/account/recovery" className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium" data-testid="link-account-recovery"><KeyRound className="me-2 size-4" /> التحقق من تنفيذ سابق</Link>}
          </div>
        </div>
      </div>
    );
  }

  const ws = wsQ.data;
  const isAdmin = ws.rights.includes("administrators") || ws.isPrimaryOwner === true;
  const incoming = ws.handovers.filter((h) => h.to_user_id === ws.userId);
  const outgoing = ws.handovers.filter((h) => h.from_user_id === ws.userId);
  const openOutgoing = outgoing.find((h) => h.state !== "completed" && h.state !== "cancelled") ?? null;
  const canSee = ws.rights.length > 0 || ws.isPrimaryOwner === true;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-16" dir="rtl">
      <section className="relative overflow-hidden rounded-2xl border bg-card p-5 sm:p-6">
        <div className="pointer-events-none absolute -start-16 -top-20 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-primary">{membership ? "حسابي" : "الإعدادات"}</p>
            <h1 className="mt-1 text-2xl font-bold" data-testid="text-page-title">{membership ? "عضويتي في المنشأة" : "المستخدمون والصلاحيات"}</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{membership
              ? "مغادرة المنشأة أو تسليم مسؤولياتك اختيارية. كل تسليم يقبله البديل صراحة ثم تنفذه أنت."
              : "مالك النظام مسؤول الحساب بكامل صلاحيات المنشأة، وليس بالضرورة مالكها القانوني. المديرون الآخرون يملكون المسؤوليات الممنوحة لهم فقط."}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">صلاحياتك:</span><RightChips list={ws.rights} testId="list-own-rights" /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!membership && (ws.rights.includes("users") || ws.rights.includes("settings")) && <Link href="/team-setup" className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:border-primary/50" data-testid="link-team-setup"><Users className="me-2 size-4" /> إعداد الفريق</Link>}
            {membership ? <Link href="/settings/users" className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:border-primary/50" data-testid="link-settings-users">المستخدمون والصلاحيات</Link>
              : <Link href="/account/membership" className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:border-primary/50" data-testid="link-account-membership">عضويتي</Link>}
            {membership && isAdmin && !openOutgoing && <Button size="sm" onClick={() => setComposer({ handover: null,ownerTransfer:ws.isPrimaryOwner===true })} data-testid="button-new-handover"><ArrowLeftRight className="me-2 size-4" /> {ws.isPrimaryOwner?"نقل مسؤوليتي قبل المغادرة":"تسليم مسؤولياتي"}</Button>}
          </div>
        </div>
      </section>

      {recovery}
      {!membership && ws.rights.includes("settings") && <ProcurementReceivingPolicy />}
      {!membership && ws.rights.includes("settings") && <ProcurementReceivingPolicy kind="stocktake" />}
      {!membership && isAdmin && <PrimaryOwnerPanel ws={ws} onChanged={() => void invalidate()} onTransfer={() => !openOutgoing && setComposer({ handover: null, ownerTransfer: true })} />}
      {membership&&<MembershipDeparture primary={ws.isPrimaryOwner===true}/>}
      {!membership && (ws.rights.includes("settings")||ws.rights.includes("subscription"))&&<AdministrationSetupControls rights={ws.rights}/>}

      {ws.notifications.length > 0 && (
        <ul className="space-y-2" data-testid="list-notifications">
          {ws.notifications.map((n) => <li key={n.id} className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100" data-testid={`notice-${n.id}`}>{n.message}</li>)}
        </ul>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="الوارد إليك" icon={Inbox} count={incoming.length} testId="panel-incoming">
          {incoming.length === 0 ? <Empty text="لا تسليمات موجهة إليك. تتحدث القائمة تلقائيًا." testId="state-incoming-empty" /> :
            incoming.map((h) => <IncomingCard key={h.id} h={h} onChanged={() => void invalidate()} />)}
        </Panel>
        <Panel title="الصادر منك" icon={Send} count={outgoing.length} testId="panel-outgoing">
          {outgoing.length === 0 ? <Empty text={canSee ? "لم تقترح أي تسليم بعد." : "لا تملك مسؤوليات إدارية تسلّمها."} testId="state-outgoing-empty" /> :
            outgoing.map((h) => (
              <OutgoingCard key={h.id} h={h} userId={ws.userId} companyId={user?.companyId ?? null}
                onEdit={() => setComposer({ handover: h })}
                onChanged={() => { refreshEvidence(); void invalidate(); }} />
            ))}
        </Panel>
      </div>

      {!membership && isAdmin && <MembersPanel ws={ws} canManage={isAdmin} onChanged={() => void invalidate()} />}

      {composer && <HandoverComposer ws={ws} existing={composer.handover} ownerTransfer={composer.ownerTransfer} onClose={() => setComposer(null)} onSaved={() => { setComposer(null); void invalidate(); }} />}
    </div>
  );
}
