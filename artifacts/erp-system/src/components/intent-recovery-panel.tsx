import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Visible only while an unresolved financial intent exists. Offers the exact
 * replay and the server check/close; never a local "discard".
 */
export function IntentRecoveryPanel({
  error, busy, recoveryRejected, scopeMismatch, managerEmail, needsPassword, onRecover, onClose, testId = "intent-recovery",
}: {
  error: string;
  busy: boolean;
  recoveryRejected: boolean;
  scopeMismatch: boolean;
  /** Set when the original attempt carried a manager override (password is never stored). */
  managerEmail?: string | null;
  needsPassword?: boolean;
  onRecover: (password?: string) => void;
  onClose: (password?: string) => void;
  testId?: string;
}) {
  const [password, setPassword] = useState("");
  const pw = needsPassword ? password : undefined;
  const blocked = busy || scopeMismatch || (!!needsPassword && !password);
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid={testId}>
      <p className="font-semibold">عملية سابقة نتيجتها غير مؤكدة — محفوظة بنصها ومفتاحها الأصليين</p>
      {error && <p data-testid={`${testId}-error`}>{error}</p>}
      {needsPassword && (
        <div className="space-y-1">
          <p>أُرسلت بموافقة المدير {managerEmail ?? ""}. كلمة المرور لا تُحفظ؛ أدخلها لإعادة الطلب نفسه أو التحقق منه.</p>
          <Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة مرور المدير" data-testid={`${testId}-password`} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!recoveryRejected && (
          <Button size="sm" type="button" disabled={blocked} onClick={() => onRecover(pw)} data-testid={`${testId}-recover`}>استرجاع النتيجة</Button>
        )}
        <Button size="sm" type="button" variant="outline" disabled={blocked} onClick={() => onClose(pw)} data-testid={`${testId}-close`}>تحقق وأغلق</Button>
      </div>
      <p className="text-[11px] opacity-80">«تحقق وأغلق» يسأل الخادم: إن كانت نُفذت تُعرض نتيجتها الأصلية، وإن لم تُنفذ تُغلق نهائيًا. لا تبدأ عملية جديدة قبل ذلك.</p>
    </div>
  );
}
