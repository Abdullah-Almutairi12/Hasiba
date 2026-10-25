import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { lockPosDevice } from "@workspace/api-client-react";
import { Lock, Repeat, LogOut, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { selectResponsibility } from "@/lib/workspace-responsibility";
import { clearEphemeralPosState, findPendingEvidence, setPosMode, type PendingEvidence } from "@/lib/pos-device-client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Action = "lock" | "switch" | "logout";
const LABEL: Record<Action, string> = { lock: "قفل الجهاز", switch: "تبديل الكاشير", logout: "إنهاء الجلسة" };

/** Lock / switch / logout for trusted-device POS sessions only. */
export function PosDeviceControls({ hasCart = false }: { hasCart?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [confirmCart, setConfirmCart] = useState<Action | null>(null);
  const [blocked, setBlocked] = useState<{ action: Action; items: PendingEvidence[] } | null>(null);

  if (!user?.posDevice) return null;

  const run = async (action: Action, cartAccepted = false) => {
    setError("");
    // Lock/logout always allowed (security); evidence stays bound to this
    // cashier and /pos-device refuses any other cashier until resolved.
    // Switching hands the till to someone else, so it is blocked outright.
    if (action === "switch") {
      const pending = findPendingEvidence(user.id, user.companyId);
      if (pending.length) { setBlocked({ action, items: pending }); return; }
    }
    // An ordinary unpaid cart is never discarded silently.
    if (hasCart && !cartAccepted) { setConfirmCart(action); return; }
    setBusy(action);
    try {
      await lockPosDevice();
    } catch (e) {
      const status = (e as { status?: number }).status;
      // 401 means the server session is already gone; anything else is a real failure.
      if (status !== 401) {
        setError("تعذر إنهاء جلسة الجهاز على الخادم. تحقق من الاتصال وأعد المحاولة.");
        setBusy(null);
        return;
      }
    }
    clearEphemeralPosState(user.id, user.companyId);
    setPosMode(false);
    selectResponsibility(qc, null);
    qc.clear();
    setBusy(null);
    setLocation(`/pos-device?after=${action}`, { replace: true });
  };

  return (
    <div className="flex items-center gap-1" data-testid="pos-device-controls">
      {(["lock", "switch", "logout"] as Action[]).map((a) => {
        const Icon = a === "lock" ? Lock : a === "switch" ? Repeat : LogOut;
        return (
          <button key={a} type="button" disabled={!!busy} onClick={() => void run(a)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-200/60 disabled:opacity-50 dark:hover:bg-neutral-800/60"
            data-testid={`button-pos-device-${a}`}>
            <Icon className="size-3.5" />{busy === a ? "جارٍ…" : LABEL[a]}
          </button>
        );
      })}
      {error && <span role="alert" className="text-red-700 dark:text-red-300" data-testid="text-pos-device-lock-error">{error}</span>}
      <Dialog open={!!confirmCart} onOpenChange={(o) => !o && setConfirmCart(null)}>
        <DialogContent dir="rtl" data-testid="dialog-pos-device-discard-cart">
          <DialogHeader>
            <DialogTitle>تجاهل السلة غير المدفوعة؟</DialogTitle>
            <DialogDescription>
              في السلة أصناف لم تُدفع بعد. {confirmCart ? LABEL[confirmCart] : ""} سيُفرغها ولن تُحفظ. هذا لا يمس أي عملية مالية معلقة؛ تلك تبقى محفوظة للكاشير نفسه.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmCart(null)} data-testid="button-cancel-discard-cart">إلغاء والعودة للسلة</Button>
            <Button variant="destructive" onClick={() => { const a = confirmCart; setConfirmCart(null); if (a) void run(a, true); }} data-testid="button-confirm-discard-cart">تجاهل السلة والمتابعة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!blocked} onOpenChange={(o) => !o && setBlocked(null)}>
        <DialogContent dir="rtl" data-testid="dialog-pos-device-blocked">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-amber-600" />لا يمكن {blocked ? LABEL[blocked.action] : ""} الآن</DialogTitle>
            <DialogDescription>
              توجد عمليات مالية لم تتأكد نتيجتها تحت هذا الكاشير. لن تُحذف ولن تُعاد إرسالها تحت كاشير آخر، ولن يُسمح لكاشير آخر بفتح الجهاز حتى تُحسم.
              استرجعها أنت من نقطة البيع (زر «استرجاع نتيجة البيع»)، أو اطلب من مسؤول مخوّل تسويتها بشكل مستقل من جلسة المنصة. يمكنك قفل الجهاز الآن والعودة بنفس رقمك لاحقاً. لا تعاود تحصيل المبلغ.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pe-5 text-sm" data-testid="list-pos-device-pending">
            {blocked?.items.map((p, i) => <li key={i} data-testid={`text-pending-${p.kind}-${i}`}>{p.label}</li>)}
          </ul>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBlocked(null); void run("lock"); }} data-testid="button-pending-lock">قفل الجهاز مع الاحتفاظ بها</Button>
            <Button onClick={() => setBlocked(null)} data-testid="button-pending-back-pos">العودة لنقطة البيع للاسترجاع</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
