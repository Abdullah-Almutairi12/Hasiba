import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useInspectTeamActivation,
  useAcceptTeamActivation,
  type InspectTeamActivation200,
} from "@workspace/api-client-react";
import { AlertTriangle, Calculator, CheckCircle2, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { MIN_NEW_PASSWORD, checkNewPassword, errorText } from "@/lib/team-access";
import { captureActivationToken,clearActivationToken } from "@/lib/activation-token";

type Phase = "reading" | "missing" | "inspecting" | "invalid" | "ready" | "done";

export default function TeamActivatePage() {
  // Token lives in memory only: captured from the fragment, then the
  // address bar is cleaned. Never stored, logged, or put in a query string.
  const tokenRef = useRef<string | null>(captureActivationToken(window.location.pathname,window.location.hash));
  const [phase, setPhase] = useState<Phase>("reading");
  const [info, setInfo] = useState<InspectTeamActivation200 | null>(null);
  const [invalidText, setInvalidText] = useState("");
  const [existing, setExisting] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [doneEmail, setDoneEmail] = useState("");
  const { user, isLoading: authLoading } = useAuth();
  const inspect = useInspectTeamActivation();
  const accept = useAcceptTeamActivation();
  const inspectRef = useRef(inspect.mutateAsync);
  inspectRef.current = inspect.mutateAsync;

  useEffect(() => {
    const token = tokenRef.current;
    if (!token) { setPhase("missing"); return; }
    setPhase("inspecting");
    const request=inspectRef.current({ data: { token } });
    if(window.location.hash)window.history.replaceState(window.history.state,"",window.location.pathname);
    request
      .then((res) => { setInfo(res); setPhase("ready"); })
      .catch((err) => { setInvalidText(errorText(err)); setPhase("invalid"); });
  }, []);

  const pwIssue = existing ? (pw ? null : "اكتب كلمة مرور حسابك الحالي.") : checkNewPassword(pw, [info?.email ?? "", info?.name ?? ""]);
  const mismatch = !existing && pw2 !== pw;
  // Linking an existing account requires an ordinary login (incl. MFA) as
  // that SAME identity first; then the original link is reopened.
  const sameIdentity = !!user && !!info && user.email.trim().toLowerCase() === info.email.trim().toLowerCase();
  const existingBlocked = existing && !sameIdentity;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setSubmitError(null);
    if (existingBlocked || pwIssue || mismatch || !tokenRef.current) return;
    try {
      const res = await accept.mutateAsync({ data: { token: tokenRef.current, password: pw } });
      tokenRef.current = null;
      clearActivationToken();
      setPw(""); setPw2("");
      setDoneEmail(res.email);
      setPhase("done");
    } catch (err) {
      setPw2("");
      setSubmitError(existing ? `${errorText(err)} تأكد من كلمة مرور حسابك الحالي — لن نغيّرها.` : errorText(err));
    }
  };

  return (
    <div dir="rtl" className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/10 to-transparent" />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Calculator className="size-5" /></span>
          <span className="text-2xl font-bold">حاسبة.AI</span>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          {(phase === "reading" || phase === "inspecting") && (
            <div className="space-y-3" data-testid="state-activation-loading">
              <Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-10 w-full" />
            </div>
          )}
          {phase === "missing" && (
            <Message icon={AlertTriangle} tone="warn" title="الرابط غير مكتمل" testId="state-activation-missing">
              افتح رابط التفعيل كما وصلك من مسؤول المنشأة. إن فقدته فاطلب منه رابطًا جديدًا.
            </Message>
          )}
          {phase === "invalid" && (
            <Message icon={AlertTriangle} tone="warn" title="تعذر استخدام هذا الرابط" testId="state-activation-invalid">
              {invalidText} قد يكون منتهيًا أو أُلغي أو استُخدم. اطلب من المسؤول رابطًا جديدًا.
            </Message>
          )}
          {phase === "done" && (
            <Message icon={CheckCircle2} tone="ok" title="تم التفعيل" testId="state-activation-done">
              <span>حسابك <span dir="ltr" className="font-mono">{doneEmail}</span> جاهز. سجّل الدخول بكلمة المرور التي اخترتها.</span>
              <Link href="/login" className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground" data-testid="link-go-login">الذهاب لتسجيل الدخول</Link>
            </Message>
          )}
          {phase === "ready" && info && (
            <form onSubmit={submit} className="space-y-5" noValidate>
              <div>
                <p className="text-xs font-semibold text-primary">دعوة للانضمام</p>
                <h1 className="mt-1 text-xl font-bold" data-testid="text-activation-company">{info.companyName}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  مرحبًا <span className="font-medium text-foreground" data-testid="text-activation-name">{info.name}</span>، سيكون دخولك بالبريد
                  {" "}<span dir="ltr" className="font-mono text-foreground" data-testid="text-activation-email">{info.email}</span>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm">
                {[{ v: false, l: "حساب جديد" }, { v: true, l: "لدي حساب بهذا البريد" }].map((o) => (
                  <button key={String(o.v)} type="button" onClick={() => { setExisting(o.v); setPw(""); setPw2(""); setTouched(false); setSubmitError(null); }}
                    className={cn("rounded-lg py-2 transition-colors", existing === o.v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}
                    data-testid={o.v ? "tab-existing-account" : "tab-new-account"} aria-pressed={existing === o.v}>
                    {o.l}
                  </button>
                ))}
              </div>

              <div>
                {existing && !sameIdentity && (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="note-existing-login-required">
                    {authLoading ? "نتحقق من جلسة الدخول…" : user ? (
                      <>أنت مسجّل الدخول بحساب <span dir="ltr" className="font-mono">{user.email}</span>، والدعوة لـ <span dir="ltr" className="font-mono">{info.email}</span>. سجّل الخروج ثم ادخل بالحساب الصحيح.</>
                    ) : (
                      <>لربط الدعوة بحسابك الحالي: ١) سجّل الدخول بالطريقة المعتادة بحساب <span dir="ltr" className="font-mono">{info.email}</span> (مع التحقق الثنائي إن كان مفعّلًا). ٢) افتح رابط الدعوة الأصلي من رسالتك مرة أخرى — الرابط لا يُحفظ هنا. ٣) أكّد كلمة مرورك الحالية. لن تتغير كلمة مرورك ولن يُتجاوز التحقق الثنائي.</>
                    )}
                    {!authLoading && <Link href="/login" className="mt-2 block font-semibold underline" data-testid="link-existing-login">الذهاب لتسجيل الدخول</Link>}
                  </div>
                )}
                <Label htmlFor="act-pw">{existing ? "كلمة مرور حسابك الحالي" : "كلمة مرور جديدة"}</Label>
                <Input id="act-pw" type="password" dir="ltr" autoComplete={existing ? "current-password" : "new-password"} value={pw}
                  onChange={(e) => setPw(e.target.value)} data-testid="input-activation-password" />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {existing ? "نتحقق أنك صاحب الحساب. كلمة المرور الحالية لن تتغير." : `${MIN_NEW_PASSWORD} حرفًا على الأقل. عبارة طويلة أسهل للتذكر وأصعب للتخمين.`}
                </p>
                {!existing && pw && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full origin-right transition-transform", pwIssue ? "bg-amber-500" : "bg-emerald-500")}
                      style={{ transform: `scaleX(${Math.min(1, pw.length / MIN_NEW_PASSWORD)})` }} />
                  </div>
                )}
                {touched && pwIssue && <p className="mt-1 text-xs text-destructive" data-testid="error-activation-password">{pwIssue}</p>}
              </div>

              {!existing && (
                <div>
                  <Label htmlFor="act-pw2">تأكيد كلمة المرور</Label>
                  <Input id="act-pw2" type="password" dir="ltr" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="input-activation-password-confirm" />
                  {touched && mismatch && <p className="mt-1 text-xs text-destructive">كلمتا المرور غير متطابقتين.</p>}
                </div>
              )}

              {submitError && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="error-activation-submit">{submitError}</p>}

              <Button type="submit" className="w-full" disabled={accept.isPending || existingBlocked} data-testid="button-accept-activation">
                {accept.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : existing ? <ShieldCheck className="me-2 size-4" /> : <KeyRound className="me-2 size-4" />}
                {existing ? "ربط الدعوة بحسابي" : "تفعيل الحساب"}
              </Button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">لن يطلب منك أحد من حاسبة كلمة مرورك.</p>
      </div>
    </div>
  );
}

function Message({ icon: Icon, tone, title, children, testId }: { icon: React.ComponentType<{ className?: string }>; tone: "ok" | "warn"; title: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="text-center" data-testid={testId}>
      <Icon className={cn("mx-auto mb-3 size-9", tone === "ok" ? "text-emerald-600" : "text-amber-600")} />
      <h1 className="text-lg font-bold">{title}</h1>
      <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
