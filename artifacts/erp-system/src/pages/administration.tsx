import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetAdministrationWorkspace, getGetAdministrationWorkspaceQueryKey, type AdministrationHandover } from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeftRight, Inbox, LogIn, RefreshCw, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { errorStatus, errorText } from "@/lib/team-access";
import { readAllEvidence, RightChips, Panel, Empty, type FinalizeEvidence } from "@/components/administration/shared";
import { IncomingCard, OutgoingCard, RecoveryCard } from "@/components/administration/handover-cards";
import { MembersPanel } from "@/components/administration/members-panel";
import { HandoverComposer } from "@/components/administration/handover-composer";
import { AdministrationSetupControls } from "@/components/administration/setup-controls";


export default function AdministrationPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const wsKey = getGetAdministrationWorkspaceQueryKey();
  const wsQ = useGetAdministrationWorkspace({ query: { queryKey: wsKey, refetchInterval: 15_000, refetchOnWindowFocus: true, retry: false } });
  const [evidence, setEvidence] = useState<FinalizeEvidence[]>([]);
  const [composer, setComposer] = useState<{ handover: AdministrationHandover | null } | null>(null);
  useEffect(() => { if (user?.id) setEvidence(readAllEvidence(user.id)); }, [user?.id]);
  const refreshEvidence = () => user?.id && setEvidence(readAllEvidence(user.id));
  const invalidate = () => qc.invalidateQueries({ queryKey: wsKey });

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
          <p className="font-bold">{st === 401 ? "انتهت جلستك في هذه المنشأة" : st === 403 ? "لا وصول إلى الإدارة في هذه المنشأة" : "تعذر تحميل الإدارة"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{st === 401 ? "بعد تغيير الوصول تُبطل جلسات المنشأة. سجّل الدخول مجددًا؛ أي دليل تنفيذ محفوظ على هذا الجهاز لن يُحذف." : errorText(wsQ.error)}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" onClick={() => void wsQ.refetch()} data-testid="button-retry-administration"><RefreshCw className="me-2 size-4" /> إعادة المحاولة</Button>
            {st === 401 && <Link href="/login" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" data-testid="link-relogin"><LogIn className="me-2 size-4" /> تسجيل الدخول</Link>}
          </div>
        </div>
      </div>
    );
  }

  const ws = wsQ.data;
  const isAdmin = ws.rights.includes("administrators");
  const incoming = ws.handovers.filter((h) => h.to_user_id === ws.userId);
  const outgoing = ws.handovers.filter((h) => h.from_user_id === ws.userId);
  const openOutgoing = outgoing.find((h) => h.state !== "completed" && h.state !== "cancelled") ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-16" dir="rtl">
      <section className="relative overflow-hidden rounded-2xl border bg-card p-5 sm:p-6">
        <div className="pointer-events-none absolute -start-16 -top-20 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-primary">إدارة النظام</p>
            <h1 className="mt-1 text-2xl font-bold">التسليم وتغيير الوصول</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">صفة الإدارة لا تثبت ملكية ولا تمنح اعتمادًا ماليًا. كل تسليم يقبله البديل صراحة ثم ينفذه المرسل.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">صلاحياتك:</span><RightChips list={ws.rights} testId="list-own-rights" /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(ws.rights.includes("users") || ws.rights.includes("settings")) && <Link href="/team-setup" className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:border-primary/50" data-testid="link-team-setup"><Users className="me-2 size-4" /> إعداد الفريق</Link>}
             {isAdmin && !openOutgoing && <Button size="sm" onClick={() => setComposer({ handover: null })} data-testid="button-new-handover"><ArrowLeftRight className="me-2 size-4" /> تسليم أو إضافة مدير</Button>}
          </div>
        </div>
      </section>

      {recovery}
      {(ws.rights.includes("settings")||ws.rights.includes("subscription"))&&<AdministrationSetupControls rights={ws.rights}/>}

      {ws.notifications.length > 0 && (
        <ul className="space-y-2" data-testid="list-notifications">
          {ws.notifications.map((n) => <li key={n.id} className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100" data-testid={`notice-${n.id}`}>{n.message}</li>)}
        </ul>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="الوارد إليك" icon={Inbox} count={incoming.length} testId="panel-incoming">
          {incoming.length === 0 ? <Empty text="لا تسليمات موجهة إليك. تتحدث القائمة تلقائيًا." testId="state-incoming-empty" /> :
            incoming.map((h) => <IncomingCard key={h.id} h={h} onChanged={invalidate} />)}
        </Panel>
        <Panel title="الصادر منك" icon={Send} count={outgoing.length} testId="panel-outgoing">
          {outgoing.length === 0 ? <Empty text={ws.rights.length ? "لم تقترح أي تسليم بعد." : "لا تملك مسؤوليات إدارية تسلّمها."} testId="state-outgoing-empty" /> :
            outgoing.map((h) => (
              <OutgoingCard key={h.id} h={h} userId={ws.userId} companyId={user?.companyId ?? null}
                onEdit={() => setComposer({ handover: h })}
                onChanged={() => { refreshEvidence(); void invalidate(); }} />
            ))}
        </Panel>
      </div>

      <MembersPanel ws={ws} canManage={isAdmin} onChanged={invalidate} />

      {composer && <HandoverComposer ws={ws} existing={composer.handover} onClose={() => setComposer(null)} onSaved={() => { setComposer(null); void invalidate(); }} />}
    </div>
  );
}


