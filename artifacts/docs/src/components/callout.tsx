import type { ReactNode } from "react";
import { Info, AlertTriangle, Lightbulb, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "note" | "tip" | "warning" | "best-practice";

const STYLES: Record<Kind, { wrap: string; head: string; Icon: typeof Info; label: { ar: string; en: string } }> = {
  note: {
    wrap: "border-sky-300/50 bg-sky-50 dark:border-sky-700/40 dark:bg-sky-950/30",
    head: "text-sky-900 dark:text-sky-200",
    Icon: Info,
    label: { ar: "ملاحظة", en: "Note" },
  },
  tip: {
    wrap: "border-amber-300/50 bg-amber-50 dark:border-amber-700/40 dark:bg-amber-950/30",
    head: "text-amber-900 dark:text-amber-200",
    Icon: Lightbulb,
    label: { ar: "نصيحة", en: "Tip" },
  },
  warning: {
    wrap: "border-red-300/50 bg-red-50 dark:border-red-700/40 dark:bg-red-950/30",
    head: "text-red-900 dark:text-red-200",
    Icon: AlertTriangle,
    label: { ar: "تحذير", en: "Warning" },
  },
  "best-practice": {
    wrap: "border-emerald-300/50 bg-emerald-50 dark:border-emerald-700/40 dark:bg-emerald-950/30",
    head: "text-emerald-900 dark:text-emerald-200",
    Icon: Sparkles,
    label: { ar: "أفضل ممارسة", en: "Best practice" },
  },
};

export default function Callout({
  kind,
  lang,
  children,
}: {
  kind: Kind;
  lang: "ar" | "en";
  children: ReactNode;
}) {
  const s = STYLES[kind];
  const Icon = s.Icon;
  return (
    <div
      className={cn(
        "not-prose my-4 rounded-lg border p-4 text-sm leading-relaxed",
        s.wrap,
      )}
      data-testid={`callout-${kind}`}
    >
      <div className={cn("mb-1.5 flex items-center gap-2 font-medium", s.head)}>
        <Icon className="size-4" />
        {s.label[lang]}
      </div>
      <div className={cn(s.head, "opacity-90")}>{children}</div>
    </div>
  );
}
