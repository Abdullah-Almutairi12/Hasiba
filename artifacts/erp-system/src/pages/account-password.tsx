import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ME_KEY } from "@/hooks/use-auth";
import { useRequestAccountPasswordReset, useResetAccountPassword } from "@workspace/api-client-react";
import { CheckCircle2, Info, KeyRound, Loader2, LogIn, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/team-access";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@/lib/account-security";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Pure read of #token=… (safe under StrictMode double render). */
export function readFragmentToken(hash: string): string | null {
  if (!hash) return null;
  const t = new URLSearchParams(hash.slice(1)).get("token");
  return t && TOKEN_RE.test(t) ? t : t !== null ? "" : null;
}

export default function AccountPasswordPage() {
  // Captured in component state during render; the fragment is stripped in an
  // idempotent effect, so a StrictMode re-run cannot lose the captured token.
  const [token, setToken] = useState<string | null>(() => readFragmentToken(window.location.hash));
  // Bumped per newly consumed fragment so a replacement token remounts the form.
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const strip = () => {
      if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    };
    strip();
    // Same-document navigation to #token=… on an already-open page.
    const onHash = () => {
      const next = readFragmentToken(window.location.hash);
      strip();
      if (next === null) return; // empty fragment never clears a held token
      setToken(next);
      setGeneration((g) => g + 1);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-muted/30 px-4 py-10" dir="rtl">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="rounded-2xl border bg-card p-6">
          {token === null ? <ForgotForm /> : <ResetForm key={generation} token={token} />}
        </div>
        <div className="rounded-2xl border bg-card p-4 text-xs leading-relaxed text-muted-foreground" data-testid="text-factor-distinction">
          <p className="font-bold text-foreground">نسيت كلمة المرور أم فقدت تطبيق المصادقة؟</p>
          إعادة تعيين كلمة المرور لا تعطّل التحقق الثنائي. إذا فقدت تطبيق المصادقة فاستخدم أحد رموز الاسترداد عند تسجيل الدخول، أو تواصل مع مسؤول هويتك.
        </div>
        <Link href="/login" className="inline-flex items-center gap-2 text-sm text-primary underline" data-testid="link-back-login"><LogIn className="size-4" /> العودة لتسجيل الدخول</Link>
      </div>
    </div>
  );
}

function ForgotForm() {
  const req = useRequestAccountPasswordReset({ mutation: { gcTime: 0 } });
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!email.trim()) return;
    try { await req.mutateAsync({ data: { email: email.trim().toLowerCase() } }); req.reset(); setSent(true); }
    catch (err) { setError(errorText(err) || "تعذّر إرسال الطلب."); }
  };
  return (
    <>
      <p className="flex items-center gap-2 text-xs font-semibold text-primary"><Mail className="size-4" /> نسيت كلمة المرور</p>
      <h1 className="mt-1 text-2xl font-bold">طلب إعادة تعيين</h1>
      <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100" data-testid="text-email-not-active">
        <Info className="mt-0.5 size-4 shrink-0" /> هذه الخطوة تُجهّز الطلب فقط. التسليم عبر البريد الإلكتروني الخارجي غير مفعّل بعد، فلن يصلك رابط حاليًا.
      </p>
      {sent ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" data-testid="state-reset-requested">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> إن كان البريد مسجلًا فقد جُهّز طلب إعادة التعيين. لا نؤكد وجود الحسابات.
        </p>
      ) : (
        <form className="mt-5 space-y-3" onSubmit={(e) => void submit(e)}>
          <div><Label htmlFor="fp-email">البريد</Label><Input id="fp-email" type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-forgot-email" /></div>
          {error && <p role="alert" className="text-sm text-destructive" data-testid="error-forgot">{error}</p>}
          <Button type="submit" className="w-full" disabled={req.isPending || !email.trim()} data-testid="button-request-reset">{req.isPending && <Loader2 className="me-2 size-4 animate-spin" />} إرسال الطلب</Button>
        </form>
      )}
    </>
  );
}

function ResetForm({ token }: { token: string }) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const reset = useResetAccountPassword({ mutation: { gcTime: 0 } });
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { setPw(""); setPw2(""); }, []);
  const valid = TOKEN_RE.test(token);
  const problem = pw || pw2 ? passwordProblem(pw, pw2) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!valid || passwordProblem(pw, pw2)) return;
    try { await reset.mutateAsync({ data: { token, newPassword: pw } }); reset.reset(); setPw(""); setPw2("");
      // Server revoked every session: drop any stale identity/private cache.
      qc.clear(); qc.setQueryData(ME_KEY, null);
      setDone(true); }
    catch (err) { setError(errorText(err) || "الرابط غير صالح أو منتهي."); }
  };

  if (done) return (
    <div className="space-y-3" data-testid="state-reset-done">
      <p className="flex items-center gap-2 text-lg font-bold"><CheckCircle2 className="size-5 text-emerald-600" /> تم تعيين كلمة المرور</p>
      <p className="text-sm text-muted-foreground">سجّل الدخول الآن بكلمة المرور الجديدة. إن كان التحقق الثنائي مفعّلًا فسيُطلب كالمعتاد.</p>
      <Button onClick={() => setLocation("/login")} data-testid="button-goto-login">تسجيل الدخول</Button>
    </div>
  );

  return (
    <>
      <p className="flex items-center gap-2 text-xs font-semibold text-primary"><KeyRound className="size-4" /> إعادة التعيين</p>
      <h1 className="mt-1 text-2xl font-bold">كلمة مرور جديدة</h1>
      {!valid ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="error-reset-token">الرابط غير مكتمل أو تالف. اطلب إعادة تعيين جديدة.</p>
      ) : (
        <form className="mt-5 space-y-3" onSubmit={(e) => void submit(e)}>
          <div><Label htmlFor="rp-new">كلمة المرور الجديدة</Label><Input id="rp-new" type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`${PASSWORD_MIN_LENGTH} حرفًا على الأقل`} data-testid="input-reset-password" /></div>
          <div><Label htmlFor="rp-new2">تأكيد كلمة المرور</Label><Input id="rp-new2" type="password" dir="ltr" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="input-reset-password-confirm" /></div>
          {problem && <p className="text-xs text-muted-foreground">{problem}</p>}
          {error && <p role="alert" className="text-sm text-destructive" data-testid="error-reset">{error}</p>}
          <Button type="submit" className="w-full" disabled={reset.isPending || !!passwordProblem(pw, pw2)} data-testid="button-reset-password">{reset.isPending && <Loader2 className="me-2 size-4 animate-spin" />} تعيين كلمة المرور</Button>
        </form>
      )}
    </>
  );
}
