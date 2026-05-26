import { type ReactNode } from "react";
import { AlertTriangle, Sparkles, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInsightMode } from "@/hooks/use-insight-mode";

export type InsightTone = "warning" | "danger" | "info";

interface InsightAlertProps {
  tone: InsightTone;
  /** Default copy shown when Insight Mode is OFF. */
  alertText: ReactNode;
  /** Opportunity-framed copy shown when Insight Mode is ON. */
  insightText: ReactNode;
  className?: string;
}

/**
 * Task #259 — alert wrapper that swaps amber/red warning copy for a
 * teal opportunity reframe when the user has Insight Mode enabled.
 * The compliance fact stays the same; only the tone shifts so the
 * dashboard reads as "next step you can take" instead of "system
 * warning".
 */
export function InsightAlert({
  tone,
  alertText,
  insightText,
  className,
}: InsightAlertProps) {
  const { enabled } = useInsightMode();

  if (enabled) {
    return (
      <div
        data-testid="insight-alert-insight"
        className={cn(
          "flex items-start gap-2 rounded-md border border-teal-500/40 bg-teal-500/10 p-2 text-xs text-teal-700 dark:text-teal-300",
          className,
        )}
      >
        <Sparkles className="size-4 shrink-0 mt-0.5" />
        <span>{insightText}</span>
      </div>
    );
  }

  const palette =
    tone === "danger"
      ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";

  const Icon = tone === "info" ? TrendingUp : AlertTriangle;

  return (
    <div
      data-testid="insight-alert-warning"
      className={cn(
        "flex items-start gap-2 rounded-md border p-2 text-xs",
        palette,
        className,
      )}
    >
      <Icon className="size-4 shrink-0 mt-0.5" />
      <span>{alertText}</span>
    </div>
  );
}
