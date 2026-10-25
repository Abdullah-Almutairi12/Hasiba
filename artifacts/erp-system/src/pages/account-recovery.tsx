import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthenticateAdministrationRecovery } from "@workspace/api-client-react";
import { KeyRound, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/team-access";
import { readAllEvidence, type FinalizeEvidence } from "@/components/administration/shared";
import { RecoveryCard } from "@/components/administration/handover-cards";
import { ME_KEY } from "@/hooks/use-auth";
import { MfaChallenge } from "@/components/account/mfa-challenge";

/** Public, identity-only recovery. Never restores company access. */
export default function AccountRecoveryPage() {
  const auth = useAuthenticateAdministrationRecovery({ mutation: { gcTime: 0 } });
  const qc=useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<FinalizeEvidence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mfaStage, setMfaStage] = useState(false);
  const finish = (id: number) => { qc.clear(); qc.setQueryData(ME_KEY, null); setMfaStage(false); setUserId(id); setEvidence(readAllEvidence(id)); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!email.trim() || !password) { setError("أدخل البريد وكلمة المرور."); return; }
    try {
      const r = await auth.mutateAsync({ data: { email: email.trim(), password } });
      // Switching to identity-only authentication must not retain a former
      // company's cached financial/personnel data or authenticated navigation.
      qc.clear();
      qc.setQueryData(ME_KEY,null);
      setPassword("");
      if (r.mfaRequired) { setMfaStage(true); return; }
      if (typeof r.userId !== "number") { setError("استجابة غير متوقعة من الخادم."); return; }
      finish(r.userId);
    } catch (err) { setPassword(""); setError(errorText(err)); }
    finally { auth.reset(); }
  };

  return (
    <div className="min-h-[100dvh] bg-muted/30 px-4 py-10" dir="rtl">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="rounded-2xl border bg-card p-6">
          <p className="flex items-center gap-2 text-xs font-semibold text-primary"><ShieldCheck className="size-4" /> استرجاع نتيجة تنفيذ</p>
          <h1 className="mt-1 text-2xl font-bold">التحقق من تسليم سابق</h1>
          <p className="mt-1 text-sm text-muted-foreground">إذا نفّذت تسليمًا أو مغادرة وانقطع الاتصال قبل التأكيد، تحقّق هوّيتك هنا لمراجعة الأدلة المحفوظة على هذا الجهاز. هذا لا يعيد وصولك إلى أي منشأة.</p>
          {userId == null && mfaStage ? (
            <div className="mt-5"><MfaChallenge context="recovery" onCancel={() => setMfaStage(false)} onVerified={(r) => {
              // Receipt-only identity: never fill operational cache, never navigate to tenant pages.
              if (r.receiptOnly && typeof r.userId === "number") finish(r.userId);
              else { qc.clear(); qc.setQueryData(ME_KEY, null); setMfaStage(false); setError("لم تُرجع خطوة التحقق هوية استرجاع. أعد المحاولة."); }
            }} /></div>
          ) : userId == null ? (
            <form className="mt-5 space-y-3" onSubmit={(e) => void submit(e)}>
              <div><Label htmlFor="rec-email">البريد</Label><Input id="rec-email" dir="ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-recovery-email" /></div>
              <div><Label htmlFor="rec-pass">كلمة المرور</Label><Input id="rec-pass" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-recovery-password" /></div>
              {error && <p role="alert" className="text-sm text-destructive" data-testid="error-recovery">{error}</p>}
              <Button type="submit" className="w-full" disabled={auth.isPending} data-testid="button-recovery-authenticate">{auth.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <KeyRound className="me-2 size-4" />} التحقق من الهوية</Button>
            </form>
          ) : (
            <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" data-testid="state-recovery-authenticated">تم التحقق من هويتك فقط. لم يُستعد أي وصول إلى منشأة.</p>
          )}
        </div>
        {userId != null && (evidence.length === 0
          ? <div className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground" data-testid="state-recovery-empty">لا أدلة تنفيذ معلّقة محفوظة على هذا الجهاز لحسابك.</div>
          : <section className="space-y-2" data-testid="panel-finalize-recovery">
              {evidence.map((ev) => <RecoveryCard key={ev.id} ev={ev} userId={userId} onDone={() => setEvidence(readAllEvidence(userId))} />)}
            </section>)}
        <Link href="/login" className="inline-flex items-center gap-2 text-sm text-primary underline" data-testid="link-back-login"><LogIn className="size-4" /> العودة لتسجيل الدخول</Link>
      </div>
    </div>
  );
}
