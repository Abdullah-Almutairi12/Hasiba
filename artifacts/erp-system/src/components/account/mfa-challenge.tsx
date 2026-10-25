import { useEffect, useState } from "react";
import { useVerifyAccountMfa, type AccountSecurityResult } from "@workspace/api-client-react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FactorInput } from "@/components/account/factor-input";
import { factorValid, normalizeRecovery, type FactorMode } from "@/lib/account-security";
import { errorText } from "@/lib/team-access";

/**
 * Second stage after a correct password. The limited session it completes
 * is never written into the auth/me cache here; the caller decides what the
 * verified result means (tenant login vs receipt-only recovery).
 */
export function MfaChallenge({ onVerified, onCancel, context }: {
  onVerified: (r: AccountSecurityResult) => void | Promise<void>;
  onCancel: () => void;
  context: "login" | "recovery";
}) {
  const verify = useVerifyAccountMfa();
  const [mode, setMode] = useState<FactorMode>("totp");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => setValue(""), []);
  const ready = factorValid(mode, value);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || verify.isPending) return;
    setError(null);
    try {
      const data = mode === "totp" ? { token: value } : { recoveryCode: normalizeRecovery(value) };
      const r = await verify.mutateAsync({ data });
      setValue("");
      await onVerified(r);
    } catch (err) {
      setValue("");
      setError(errorText(err) || "تعذّر التحقق من العامل الإضافي.");
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="form-mfa-challenge">
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          كلمة المرور صحيحة. هذا الحساب محمي بعامل تحقق إضافي؛ أدخل الرمز الحالي من تطبيق المصادقة أو أحد رموز الاسترداد.
          {context === "recovery" ? " إكمال هذه الخطوة يتحقق من هويتك فقط ولا يعيد أي وصول إلى منشأة." : " لا يُفتح أي جزء من النظام قبل إكمال هذه الخطوة."}
        </span>
      </div>
      <FactorInput id="mfa-challenge" mode={mode} onMode={setMode} value={value} onChange={setValue} disabled={verify.isPending} />
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" data-testid="error-mfa-challenge">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={!ready || verify.isPending} data-testid="button-mfa-verify">
          {verify.isPending && <Loader2 className="me-2 size-4 animate-spin" />} تحقق
        </Button>
        <Button type="button" variant="outline" disabled={verify.isPending} onClick={onCancel} data-testid="button-mfa-cancel">رجوع</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">فقدت تطبيق المصادقة ورموز الاسترداد؟ إعادة تعيين كلمة المرور لا تعطّل العامل الإضافي؛ تواصل مع مسؤول هويتك.</p>
    </form>
  );
}
