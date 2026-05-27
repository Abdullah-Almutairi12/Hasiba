import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocFaq, Lang } from "@workspace/docs-content";

export default function Faq({ items, lang }: { items: DocFaq[]; lang: Lang }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="not-prose my-4 divide-y rounded-lg border bg-card" data-testid="faq">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={i}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full items-center justify-between gap-3 p-4 text-start text-sm font-medium hover:bg-accent/40"
              data-testid={`faq-q-${i}`}
            >
              <span>{it.q[lang]}</span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            {isOpen && (
              <div
                className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground"
                data-testid={`faq-a-${i}`}
              >
                {it.a[lang]}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
