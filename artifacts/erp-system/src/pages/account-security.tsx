import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAccountSecurity,
  getGetAccountSecurityQueryKey,
  useChangeAccountPassword,
  useRevokeAccountSessions,
  useStartAccountTotp,
  useConfirmAccountTotp,
  useDisableAccountTotp,
  useRenewAccountRecoveryCodes,
  useUpdateCompanyMfaPolicy,
  type AccountSecurityState,
} from "@workspace/api-client-react";
import {
  AlertTriangle, CheckCircle2, Copy, KeyRound, Loader2, LogOut, MonitorSmartphone, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, Smartphone, Building2, Lock,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { FactorInput } from "@/components/account/factor-input";
import { ME_KEY, useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/team-access";
import {
  PASSWORD_MIN_LENGTH, TOTP_RE, buildProof, passwordProblem, proofReady, type FactorMode,
} from "@/lib/account-security";

/** Sensitive mutations: keep nothing in the mutation cache after completion. */
const NO_CACHE = { mutation: { gcTime: 0 } };

type Pending = { secret: string; uri: string; expiresAt: number; replacing: boolean };

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; }
}

function ErrorLine({ msg, id }: { msg: string | null; id: string }) {
  if (!msg) return null;
  return <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" data-testid={`error-${id}`}><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{msg}</p>;
}

/** Shown exactly once. Lives only in component memory; never persisted or logged. */
export function RecoveryCodesOnce({ codes, onDismiss }: { codes: string[]; onDismiss: () => void }) {
  const [ack, setAck] = useState(false);
  return (
    <div className="space-y-3 rounded-xl border-2 border-amber-400/60 bg-amber-50 p-4 dark:bg-amber-950/30" data-testid="panel-recovery-codes">
      <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-100"><KeyRound className="size-4" /> رموز الاسترداد — تظهر مرة واحدة فقط</p>
      <p className="text-xs text-amber-900/80 dark:text-amber-100/80">احفظها في مكان آمن خارج هذا الجهاز. كل رمز يُستخدم مرة واحدة بدل تطبيق المصادقة. لن نعرضها مجددًا، وأي تجديد لاحق يلغي المجموعة كاملة.</p>
      <ol className="grid gap-1.5 sm:grid-cols-2" dir="ltr">
        {codes.map((c, i) => (
          <li key={i} className="break-all rounded-md border bg-background px-2 py-1.5 font-mono text-[11px]" data-testid={`text-recovery-code-${i}`}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(codes.join("\n"))} data-testid="button-copy-recovery-codes"><Copy className="me-1 size-3.5" /> نسخ</Button>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="checkbox-recovery-saved" /> حفظتُ الرموز</label>
        <Button type="button" size="sm" disabled={!ack} onClick={onDismiss} data-testid="button-dismiss-recovery-codes">إخفاء نهائيًا</Button>
      </div>
    </div>
  );
}

export default function AccountSecurityPage() {
  const status = useGetAccountSecurity();
  const { user } = useAuth();
  const s = status.data;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6" dir="rtl">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs font-semibold text-primary"><ShieldCheck className="size-4" /> هويتك على المنصة</p>
        <h1 className="text-2xl font-bold">أمان حسابي</h1>
        <p className="text-sm text-muted-foreground">هذه الإعدادات تخص هويتك أنت فقط عبر كل المنشآت. لا تمنح أي صلاحية على المنشأة ولا تغيّر حسابات الآخرين.</p>
      </header>

      {user?.mfaEnrollmentRequired && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-400/60 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100" data-testid="banner-mfa-enrollment-required">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-bold">المنشأة تشترط التحقق الثنائي</p><p className="text-xs">لن يتاح أي جزء تشغيلي من النظام حتى تُكمل تسجيل تطبيق المصادقة أدناه وتؤكده.</p></div>
        </div>
      )}

      {status.isLoading ? (
        <div className="space-y-3" data-testid="state-security-loading">
          <Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /><Skeleton className="h-40 w-full" />
        </div>
      ) : status.isError || !s ? (
        <Card data-testid="state-security-error"><CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <AlertTriangle className="size-8 text-destructive" />
          <p className="text-sm">تعذّر تحميل حالة أمان الحساب. {errorText(status.error)}</p>
          <Button variant="outline" onClick={() => void status.refetch()} data-testid="button-security-retry"><RefreshCw className="me-2 size-4" /> إعادة المحاولة</Button>
        </CardContent></Card>
      ) : (
        <SecurityBody s={s} />
      )}
    </div>
  );
}

function SecurityBody({ s }: { s: AccountSecurityState }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  // Shared fresh proof. Cleared after every sensitive attempt and on unmount.
  const [currentPassword, setCurrentPassword] = useState("");
  const [mode, setMode] = useState<FactorMode>("totp");
  const [factor, setFactor] = useState("");
  const clearProof = () => { setCurrentPassword(""); setFactor(""); };
  const ready = proofReady(currentPassword, s.mfaEnabled, mode, factor);
  const proof = () => buildProof(currentPassword, s.mfaEnabled, mode, factor);

  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [newToken, setNewToken] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [policyRequired, setPolicyRequired] = useState(s.companyRequiresMfa);
  const [now, setNow] = useState(() => Date.now());
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const setErr = (k: string, v: string | null) => setErrors((e) => ({ ...e, [k]: v }));

  const changePw = useChangeAccountPassword(NO_CACHE);
  const revoke = useRevokeAccountSessions(NO_CACHE);
  const start = useStartAccountTotp(NO_CACHE);
  const confirm = useConfirmAccountTotp(NO_CACHE);
  const disable = useDisableAccountTotp(NO_CACHE);
  const renew = useRenewAccountRecoveryCodes(NO_CACHE);
  const policy = useUpdateCompanyMfaPolicy(NO_CACHE);
  const busy = changePw.isPending || revoke.isPending || start.isPending || confirm.isPending || disable.isPending || renew.isPending || policy.isPending;

  // Secrets never outlive this view.
  useEffect(() => () => { setPending(null); setCodes(null); setCurrentPassword(""); setFactor(""); setNewPw(""); setNewPw2(""); setNewToken(""); }, []);
  useEffect(() => { setPolicyRequired(s.companyRequiresMfa); }, [s.companyRequiresMfa]);
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [pending]);
  const remaining = pending ? Math.max(0, Math.round((pending.expiresAt - now) / 1000)) : 0;
  useEffect(() => { if (pending && remaining === 0) { setPending(null); setNewToken(""); } }, [pending, remaining]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: getGetAccountSecurityQueryKey() });
    await qc.invalidateQueries({ queryKey: ME_KEY });
  };

  const run = async <T,>(key: string, fn: () => Promise<T>, after: (r: T) => void | Promise<void>, reset: () => void) => {
    setErr(key, null);
    try { const r = await fn(); await after(r); }
    catch (err) { setErr(key, errorText(err) || "تعذّر تنفيذ العملية."); }
    finally { clearProof(); reset(); }
  };

  const pwProblem = newPw || newPw2 ? passwordProblem(newPw, newPw2) : null;
  const onChangePassword = () => run("password",
    () => changePw.mutateAsync({ data: { ...proof(), newPassword: newPw } }),
    (r) => {
      setNewPw(""); setNewPw2("");
      if (r.reauthenticate) {
        // All platform sessions are gone: drop every private cached record.
        qc.clear();
        qc.setQueryData(ME_KEY, null);
        toast({ title: "تم تغيير كلمة المرور", description: "أُنهيت كل الجلسات. سجّل الدخول بكلمة المرور الجديدة." });
        setLocation("/login", { replace: true });
      }
    }, changePw.reset);

  const onStart = () => run("start",
    () => start.mutateAsync({ data: proof() }),
    (r) => {
      if (!r.secret || !r.otpauthUri) throw new Error("لم تُرجع بيانات التسجيل.");
      setPending({ secret: r.secret, uri: r.otpauthUri, expiresAt: Date.now() + (r.expiresInSeconds ?? 600) * 1000, replacing: s.mfaEnabled });
      setNow(Date.now());
    }, start.reset);

  const onConfirm = () => {
    // Confirmation proves the NEW factor: current password + new code only.
    const pw = currentPassword;
    return run("confirm",
      () => confirm.mutateAsync({ data: { currentPassword: pw, token: newToken } }),
      async (r) => {
        setPending(null); setNewToken("");
        if (r.recoveryCodes?.length) setCodes(r.recoveryCodes);
        toast({ title: "تم تفعيل تطبيق المصادقة" });
        await refresh();
      }, () => { setNewToken(""); confirm.reset(); });
  };

  const onDisable = () => run("disable", () => disable.mutateAsync({ data: proof() }), async () => {
    toast({ title: "تم إيقاف التحقق الثنائي" }); await refresh();
  }, disable.reset);

  const onRenew = () => run("renew", () => renew.mutateAsync({ data: proof() }), async (r) => {
    if (r.recoveryCodes?.length) setCodes(r.recoveryCodes);
    await refresh();
  }, renew.reset);

  const onRevoke = () => run("revoke", () => revoke.mutateAsync({ data: proof() }), async () => {
    toast({ title: "أُنهيت الجلسات الأخرى", description: "جلستك الحالية جُدّدت وبقيت نشطة." });
    await qc.invalidateQueries({ queryKey: getGetAccountSecurityQueryKey() });
  }, revoke.reset);

  const onPolicy = () => run("policy", () => policy.mutateAsync({ data: { ...proof(), required: policyRequired } }), async () => {
    toast({ title: policyRequired ? "أصبح التحقق الثنائي إلزاميًا في هذه المنشأة" : "أُلغي إلزام التحقق الثنائي في هذه المنشأة" });
    await refresh();
  }, policy.reset);

  const proofHint = s.mfaEnabled ? "كلمة المرور الحالية + رمز العامل الحالي" : "كلمة المرور الحالية";

  return (
    <div className="space-y-5">
      {/* Overview */}
      <div className="grid gap-3 sm:grid-cols-3" data-testid="panel-security-overview">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">التحقق الثنائي</p>
          <p className="mt-1 flex items-center gap-2 font-bold" data-testid="status-mfa">{s.mfaEnabled ? <><ShieldCheck className="size-4 text-emerald-600" /> مفعّل</> : <><ShieldOff className="size-4 text-muted-foreground" /> غير مفعّل</>}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">رموز الاسترداد المتبقية</p>
          <p className={`mt-1 font-bold tabular-nums ${s.mfaEnabled && s.recoveryCodesRemaining <= 2 ? "text-amber-600" : ""}`} data-testid="status-recovery-remaining">{s.mfaEnabled ? s.recoveryCodesRemaining : "—"}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">سياسة المنشأة الحالية</p>
          <p className="mt-1 font-bold" data-testid="status-company-policy">{s.companyRequiresMfa ? "التحقق الثنائي إلزامي" : "اختياري"}</p>
        </div>
      </div>

      {codes && <RecoveryCodesOnce codes={codes} onDismiss={() => setCodes(null)} />}

      {/* Fresh proof */}
      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Lock className="size-4 text-primary" /> إثبات الهوية للعملية التالية</CardTitle>
          <CardDescription>كل عملية حساسة تتطلب {proofHint}. تُمسح هذه الحقول بعد كل محاولة.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sec-current">كلمة المرور الحالية</Label>
            <Input id="sec-current" type="password" dir="ltr" autoComplete="current-password" value={currentPassword} disabled={busy} onChange={(e) => setCurrentPassword(e.target.value)} data-testid="input-current-password" />
          </div>
          {s.mfaEnabled && <FactorInput id="proof" mode={mode} onMode={setMode} value={factor} onChange={setFactor} disabled={busy} />}
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4 text-primary" /> تغيير كلمة المرور</CardTitle>
          <CardDescription>بعد التغيير تُنهى كل جلساتك على المنصة بما فيها هذه، وتعود لتسجيل الدخول.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="sec-new">كلمة المرور الجديدة</Label><Input id="sec-new" type="password" dir="ltr" autoComplete="new-password" value={newPw} disabled={busy} onChange={(e) => setNewPw(e.target.value)} placeholder={`${PASSWORD_MIN_LENGTH} حرفًا على الأقل`} data-testid="input-new-password" /></div>
            <div className="space-y-1.5"><Label htmlFor="sec-new2">تأكيد كلمة المرور</Label><Input id="sec-new2" type="password" dir="ltr" autoComplete="new-password" value={newPw2} disabled={busy} onChange={(e) => setNewPw2(e.target.value)} data-testid="input-new-password-confirm" /></div>
          </div>
          {pwProblem && <p className="text-xs text-muted-foreground" data-testid="text-password-problem">{pwProblem}</p>}
          <ErrorLine msg={errors.password ?? null} id="password" />
          <Button disabled={busy || !ready || !newPw || !!passwordProblem(newPw, newPw2)} onClick={() => void onChangePassword()} data-testid="button-change-password">
            {changePw.isPending && <Loader2 className="me-2 size-4 animate-spin" />} تغيير كلمة المرور
          </Button>
        </CardContent>
      </Card>

      {/* Second factor */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Smartphone className="size-4 text-primary" /> تطبيق المصادقة (TOTP)</CardTitle>
          <CardDescription>
            {s.mfaEnabled ? "مفعّل. يمكنك استبداله بجهاز جديد بإثبات العامل الحالي أولًا، ثم تأكيد الجديد." : "يضيف رمزًا متغيرًا من تطبيق على هاتفك بعد كلمة المرور."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!s.encryptionConfigured && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100" data-testid="text-encryption-missing">تشفير أسرار التحقق غير مهيأ على الخادم بعد؛ لا يمكن بدء تسجيل جديد حاليًا.</p>
          )}
          {pending ? (
            <div className="space-y-3 rounded-xl border border-dashed border-primary/40 p-4" data-testid="panel-totp-pending">
              <p className="text-sm font-bold">تسجيل مؤقت — {pending.replacing ? "الاستبدال" : "التفعيل"} لم يحدث بعد</p>
              <p className="text-xs text-muted-foreground">أضف الحساب في تطبيق المصادقة يدويًا بالمفتاح أدناه أو بالرابط. لن يُفعَّل شيء حتى تؤكّد برمز جديد من التطبيق{pending.replacing ? "؛ العامل القديم يبقى فعّالًا حتى ذلك الحين" : ""}. ينتهي خلال <span className="font-bold tabular-nums" data-testid="text-totp-expiry">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>.</p>
              <div className="space-y-1"><Label>المفتاح السري (إدخال يدوي)</Label><code className="block break-all rounded-md bg-muted p-2 font-mono text-xs" dir="ltr" data-testid="text-totp-secret">{pending.secret}</code></div>
              <div className="space-y-1"><Label>رابط الإعداد</Label><code className="block break-all rounded-md bg-muted p-2 font-mono text-[10px]" dir="ltr" data-testid="text-totp-uri">{pending.uri}</code></div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="sec-new-token">الرمز الجديد من التطبيق</Label><Input id="sec-new-token" dir="ltr" inputMode="numeric" maxLength={6} className="font-mono tracking-widest" value={newToken} disabled={busy} onChange={(e) => setNewToken(e.target.value.replace(/\D/g, "").slice(0, 6))} data-testid="input-new-totp" /></div>
                <p className="self-end text-xs text-muted-foreground">التأكيد يتطلب كلمة المرور الحالية (أعلاه) والرمز الجديد فقط، لا العامل القديم.</p>
              </div>
              <ErrorLine msg={errors.confirm ?? null} id="confirm" />
              <div className="flex gap-2">
                <Button disabled={busy || !currentPassword || !TOTP_RE.test(newToken)} onClick={() => void onConfirm()} data-testid="button-confirm-totp">{confirm.isPending && <Loader2 className="me-2 size-4 animate-spin" />} تأكيد وتفعيل</Button>
                <Button variant="outline" disabled={busy} onClick={() => { setPending(null); setNewToken(""); }} data-testid="button-cancel-totp">إلغاء</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !ready || !s.encryptionConfigured} onClick={() => void onStart()} data-testid="button-start-totp">
                {start.isPending && <Loader2 className="me-2 size-4 animate-spin" />} {s.mfaEnabled ? "استبدال الجهاز" : "بدء التسجيل"}
              </Button>
              {s.mfaEnabled && (
                <Button variant="outline" className="text-destructive" disabled={busy || !ready || s.companyRequiresMfa} onClick={() => void onDisable()} title={s.companyRequiresMfa ? "المنشأة تشترط التحقق الثنائي" : undefined} data-testid="button-disable-totp">
                  {disable.isPending && <Loader2 className="me-2 size-4 animate-spin" />} إيقاف التحقق الثنائي
                </Button>
              )}
            </div>
          )}
          {s.mfaEnabled && <p className="text-[11px] text-muted-foreground">لا يمكن الإيقاف إذا كانت أي منشأة تنتمي إليها تشترط التحقق الثنائي.</p>}
          <ErrorLine msg={errors.start ?? null} id="start" />
          <ErrorLine msg={errors.disable ?? null} id="disable" />
        </CardContent>
      </Card>

      {/* Recovery codes */}
      {s.mfaEnabled && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="size-4 text-primary" /> رموز الاسترداد</CardTitle>
            <CardDescription>التجديد يلغي كل الرموز الحالية ({s.recoveryCodesRemaining} متبقية) ويصدر 10 رموز جديدة تُعرض مرة واحدة.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ErrorLine msg={errors.renew ?? null} id="renew" />
            <Button variant="outline" disabled={busy || !ready} onClick={() => void onRenew()} data-testid="button-renew-recovery">{renew.isPending && <Loader2 className="me-2 size-4 animate-spin" />} تجديد المجموعة كاملة</Button>
          </CardContent>
        </Card>
      )}

      {/* Sessions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><MonitorSmartphone className="size-4 text-primary" /> الجلسات النشطة</CardTitle>
          <CardDescription>إنهاء الجلسات الأخرى يُبقي هذه الجلسة بعد تجديدها.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {s.sessions.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground" data-testid="state-sessions-empty">لا جلسات نشطة مسجلة.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {s.sessions.map((x) => (
                <li key={x.reference} className="flex items-center justify-between gap-2 p-3 text-sm" data-testid={`row-session-${x.reference}`}>
                  <span className="font-mono text-xs" dir="ltr">{x.reference}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {x.current && <Badge variant="outline" className="border-emerald-400 text-emerald-700">هذه الجلسة</Badge>}
                    تنتهي {fmtDate(x.expiresAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ErrorLine msg={errors.revoke ?? null} id="revoke" />
          <Button variant="outline" disabled={busy || !ready || s.sessions.filter((x) => !x.current).length === 0} onClick={() => void onRevoke()} data-testid="button-revoke-sessions">
            {revoke.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <LogOut className="me-2 size-4" />} إنهاء الجلسات الأخرى
          </Button>
        </CardContent>
      </Card>

      {/* Policy */}
      {s.canManagePolicy && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Building2 className="size-4 text-primary" /> سياسة المنشأة الحالية</CardTitle>
            <CardDescription>تنطبق على المنشأة النشطة فقط ({(user?.companies ?? []).find((c) => c.id === user?.companyId)?.name ?? "—"})، لا على المنصة كلها. الأعضاء غير المسجلين يُحوَّلون للتسجيل قبل أي وصول.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm">إلزام كل الأعضاء بالتحقق الثنائي</span>
              <Switch checked={policyRequired} disabled={busy} onCheckedChange={setPolicyRequired} data-testid="switch-company-mfa-policy" />
            </div>
            <ErrorLine msg={errors.policy ?? null} id="policy" />
            <Button disabled={busy || !ready || policyRequired === s.companyRequiresMfa} onClick={() => void onPolicy()} data-testid="button-save-mfa-policy">{policy.isPending && <Loader2 className="me-2 size-4 animate-spin" />} حفظ السياسة</Button>
          </CardContent>
        </Card>
      )}

      <p className="flex items-center gap-2 text-[11px] text-muted-foreground"><CheckCircle2 className="size-3.5" /> نسيت كلمة المرور تختلف عن فقدان العامل الإضافي: إعادة التعيين لا تعطّل التحقق الثنائي.</p>
    </div>
  );
}
