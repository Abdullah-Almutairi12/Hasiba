import { Check } from "lucide-react";
import type { DocStep, Lang } from "@workspace/docs-content";

export default function Steps({ steps, lang }: { steps: DocStep[]; lang: Lang }) {
  return (
    <ol className="not-prose my-4 space-y-3" data-testid="steps">
      {steps.map((s, i) => (
        <li
          key={i}
          className="flex gap-3 rounded-lg border bg-card p-3"
          data-testid={`step-${i + 1}`}
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {i + 1}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-relaxed text-foreground">
              {s.action[lang]}
            </p>
            {s.result && (
              <p className="mt-1 flex items-start gap-1.5 text-sm leading-relaxed text-muted-foreground">
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                <span>{s.result[lang]}</span>
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
