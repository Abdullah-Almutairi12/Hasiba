import { QUICK_START, type Lang } from "@workspace/docs-content";
import { Sparkles, Clock, ArrowRight } from "lucide-react";

const T = {
  title: { ar: "ابدأ خلال 10 دقائق", en: "Get started in 10 minutes" },
  subtitle: {
    ar: "خمس خطوات تأخذك من إنشاء الحساب حتى إصدار أول فاتورة في تطبيقك الفعلي.",
    en: "Five steps that take you from creating an account to issuing your first invoice in your live app.",
  },
  open: { ar: "افتح في التطبيق", en: "Open in app" },
  minutes: { ar: "دقائق", en: "min" },
  totalLabel: {
    ar: "إجمالي الوقت المقدَّر",
    en: "Estimated total time",
  },
};

export default function QuickStart({ lang }: { lang: Lang }) {
  const total = QUICK_START.reduce((s, x) => s + x.minutes, 0);
  return (
    <article className="mx-auto max-w-3xl">
      <header className="mb-8 rounded-xl border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-primary/10 p-3 text-primary">
            <Sparkles className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold tracking-tight">{T.title[lang]}</h1>
            <p className="mt-2 text-muted-foreground">{T.subtitle[lang]}</p>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
              <Clock className="size-3.5" />
              {T.totalLabel[lang]}: {total} {T.minutes[lang]}
            </div>
          </div>
        </div>
      </header>

      <ol className="space-y-4">
        {QUICK_START.map((s) => (
          <li
            key={s.index}
            className="flex gap-4 rounded-xl border bg-card p-5"
            data-testid={`qs-${s.index}`}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
              {s.index}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-lg font-semibold">{s.title[lang]}</h2>
                <span className="font-mono text-xs text-muted-foreground">{s.appPath}</span>
                <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                  <Clock className="size-3" />
                  {s.minutes} {T.minutes[lang]}
                </span>
              </div>
              <p className="mt-2 leading-relaxed text-foreground/90">{s.body[lang]}</p>
              <a
                href={s.appPath}
                target="_top"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                data-testid={`qs-open-${s.index}`}
              >
                {T.open[lang]}
                <ArrowRight className={lang === "ar" ? "size-3.5 rotate-180" : "size-3.5"} />
              </a>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
