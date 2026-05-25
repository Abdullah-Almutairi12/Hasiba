import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface LastSend {
  outboxId: number;
  status: string;
  recipient: string | null;
  error: string | null;
  createdAt: string | null;
  sentAt: string | null;
  attempts?: number | null;
  maxAttempts?: number | null;
  nextRetryAt?: string | null;
  exhausted?: boolean | null;
}

export function SendStatusBadge({
  doc,
  testIdPrefix = "badge-send-status",
}: {
  doc: { id: number; lastSend?: LastSend | null };
  testIdPrefix?: string;
}) {
  const ls = doc.lastSend;
  if (!ls) return null;
  const tone: { className: string; dot: string; label: string } = (() => {
    if (ls.status === "failed" && ls.exhausted) {
      return {
        className: "bg-rose-100 text-rose-900 border-rose-400",
        dot: "bg-rose-700",
        label: "تم استنفاد المحاولات",
      };
    }
    switch (ls.status) {
      case "sent":
        return {
          className: "bg-emerald-50 text-emerald-800 border-emerald-300",
          dot: "bg-emerald-500",
          label: "تم التسليم",
        };
      case "queued":
        return {
          className: "bg-amber-50 text-amber-800 border-amber-300",
          dot: "bg-amber-500 animate-pulse",
          label: "في الانتظار",
        };
      case "failed":
        return {
          className: "bg-red-50 text-red-800 border-red-300",
          dot: "bg-red-500",
          label:
            ls.attempts && ls.maxAttempts
              ? `فشل — محاولة ${ls.attempts}/${ls.maxAttempts}`
              : "فشل",
        };
      default:
        return {
          className: "bg-slate-50 text-slate-700 border-slate-300",
          dot: "bg-slate-400",
          label: ls.status || "—",
        };
    }
  })();
  const when = ls.sentAt ?? ls.createdAt;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`gap-1 font-normal ${tone.className}`}
            data-testid={`${testIdPrefix}-${doc.id}`}
            data-status={ls.status}
          >
            <span className={`size-1.5 rounded-full ${tone.dot}`} />
            {tone.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-right">
          <div className="space-y-1 text-xs">
            {ls.recipient && (
              <div>
                <span className="text-muted-foreground">المستلم: </span>
                <span className="font-mono">{ls.recipient}</span>
              </div>
            )}
            {when && (
              <div>
                <span className="text-muted-foreground">آخر محاولة: </span>
                {new Date(when).toLocaleString("ar-SA")}
              </div>
            )}
            {ls.error && (
              <div className="text-red-700 dark:text-red-300 break-words">
                {ls.error}
              </div>
            )}
            {!ls.error && ls.status === "queued" && (
              <div className="text-amber-700 dark:text-amber-300">
                لم يتم التأكيد بعد — البريد في قائمة الانتظار.
              </div>
            )}
            {ls.status === "failed" && !ls.exhausted && ls.nextRetryAt && (
              <div className="text-amber-700 dark:text-amber-300">
                إعادة المحاولة التلقائية: {new Date(ls.nextRetryAt).toLocaleString("ar-SA")}
              </div>
            )}
            {ls.status === "failed" && ls.exhausted && (
              <div className="text-rose-800 dark:text-rose-200">
                تم استنفاد جميع المحاولات التلقائية ({ls.attempts ?? 0}/{ls.maxAttempts ?? 0}).
                يلزم إعادة إرسال يدوية من سجل الإرسال.
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
