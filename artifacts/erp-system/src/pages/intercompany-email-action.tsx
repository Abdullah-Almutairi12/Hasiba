import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

type PreviewState =
  | { kind: "loading" }
  | {
      kind: "ready";
      action: "resync" | "ignore";
      imbalanceId: number;
      sourceRef: string;
      targetRef: string;
      difference: string;
      basis: string;
      status: string;
      linkStatus: string;
      expiresAt: string;
    }
  | { kind: "error"; code: string; message: string }
  | { kind: "done"; action: "resync" | "ignore"; imbalanceId: number };

function parseToken(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") ?? "";
}

export default function IntercompanyEmailActionPage() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const token = parseToken();

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setState({ kind: "error", code: "INVALID", message: "رابط غير صالح" });
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/intercompany/email-action/preview?token=${encodeURIComponent(token)}`,
          { credentials: "omit" },
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setState({
            kind: "error",
            code: body.error ?? "INVALID",
            message: body.message ?? "تعذر فتح الرابط",
          });
          return;
        }
        setState({
          kind: "ready",
          action: body.action,
          imbalanceId: body.imbalanceId,
          sourceRef: body.sourceRef,
          targetRef: body.targetRef,
          difference: body.difference,
          basis: body.basis,
          status: body.status,
          linkStatus: body.linkStatus,
          expiresAt: body.expiresAt,
        });
      } catch {
        if (!cancelled) {
          setState({
            kind: "error",
            code: "NETWORK",
            message: "تعذر الاتصال بالخادم",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function confirm() {
    if (state.kind !== "ready" || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/intercompany/email-action/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setState({
          kind: "error",
          code: body.error ?? "INVALID",
          message: body.message ?? "تعذر تنفيذ الإجراء",
        });
        return;
      }
      setState({ kind: "done", action: body.action, imbalanceId: body.imbalanceId });
    } catch {
      setState({
        kind: "error",
        code: "NETWORK",
        message: "تعذر الاتصال بالخادم",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-muted/30 p-4"
    >
      <Card className="w-full max-w-lg" data-testid="card-email-action">
        <CardHeader>
          <CardTitle>
            {state.kind === "done"
              ? "تم تنفيذ الإجراء"
              : state.kind === "error"
                ? "تعذر فتح الرابط"
                : "تأكيد إجراء على اختلال بين الشركات"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.kind === "loading" && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>جاري التحقق من الرابط…</span>
            </div>
          )}

          {state.kind === "error" && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5 mt-0.5" />
                <div>
                  <div className="font-semibold">{state.message}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    رمز الخطأ: {state.code}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setLocation("/intercompany")}
                data-testid="button-back-to-queue"
              >
                الذهاب إلى قائمة المراجعة
              </Button>
            </div>
          )}

          {state.kind === "ready" && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">الإجراء: </span>
                  <span className="font-semibold">
                    {state.action === "resync"
                      ? "إعادة مزامنة المرآة"
                      : "تجاهل الفرق"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">المصدر: </span>
                  <span>{state.sourceRef}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">المقابل: </span>
                  <span>{state.targetRef}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">الفرق: </span>
                  <span className="font-mono">{state.difference}</span>
                  <span className="text-muted-foreground"> ({state.basis})</span>
                </div>
                <div className="text-xs text-muted-foreground pt-1">
                  ينتهي الرابط في{" "}
                  {new Date(state.expiresAt).toLocaleString("ar-SA")}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                هذا الرابط للاستخدام مرة واحدة. عند التأكيد سيتم تنفيذ الإجراء
                وتسجيله في سجل التدقيق مع الإشارة إلى أنه جاء من البريد
                الإلكتروني الصباحي.
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setLocation("/intercompany")}
                  disabled={submitting}
                  data-testid="button-cancel-email-action"
                >
                  إلغاء
                </Button>
                <Button
                  onClick={confirm}
                  disabled={submitting}
                  data-testid="button-confirm-email-action"
                  variant={state.action === "ignore" ? "secondary" : "default"}
                >
                  {submitting && (
                    <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  )}
                  {state.action === "resync" ? "إعادة المزامنة" : "تأكيد التجاهل"}
                </Button>
              </div>
            </div>
          )}

          {state.kind === "done" && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-emerald-600 dark:text-emerald-400">
                {state.action === "resync" ? (
                  <CheckCircle2 className="h-5 w-5 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold">
                    {state.action === "resync"
                      ? "تمت إعادة المزامنة بنجاح"
                      : "تم تجاهل الاختلال"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    رقم الاختلال: {state.imbalanceId}
                  </div>
                </div>
              </div>
              <Button
                onClick={() => {
                  window.location.href = "/intercompany#imbalances";
                }}
                data-testid="button-go-to-queue"
              >
                فتح قائمة المراجعة
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
