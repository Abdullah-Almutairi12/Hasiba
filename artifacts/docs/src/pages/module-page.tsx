import { useState } from "react";
import { Link } from "wouter";
import { ChevronRight, ImageOff, FileDown, Lightbulb, Shield } from "lucide-react";
import type { DocModule, Lang } from "@workspace/docs-content";

const T = {
  back: { ar: "كل الوحدات", en: "All modules" },
  screenshot: { ar: "لقطة الشاشة", en: "Screenshot" },
  noScreenshot: {
    ar: "لم تُلتقط بعد. ستتحدّث تلقائيًا بعد أول نشر للتطبيق.",
    en: "Not captured yet. Will auto-refresh after the next deployment.",
  },
  tips: { ar: "نصائح", en: "Tips" },
  roles: { ar: "الأدوار المسموح لها", en: "Allowed roles" },
  pdf: { ar: "تنزيل هذه الوحدة PDF", en: "Download this module as PDF" },
};

export default function ModulePage({ lang, module: m }: { lang: Lang; module: DocModule }) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const shotSrc = `${base}/screenshots/${lang}/${m.slug}.png`;
  const [imgOk, setImgOk] = useState(true);

  return (
    <article className="mx-auto max-w-3xl">
      <nav className="no-print mb-6 flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">{T.back[lang]}</Link>
        <ChevronRight className={lang === "ar" ? "size-3.5 rotate-180" : "size-3.5"} />
        <span className="text-foreground">{m.title[lang]}</span>
      </nav>

      <header className="mb-6">
        <div className="mb-2 flex items-baseline gap-2 text-xs tabular-nums text-muted-foreground">
          <span>#{String(m.position).padStart(2, "0")}</span>
          {m.appPath && <span className="font-mono">{m.appPath}</span>}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{m.title[lang]}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{m.summary[lang]}</p>
      </header>

      <div className="mb-8 rounded-lg border bg-card p-4 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Shield className="size-4 text-primary" />
          {T.roles[lang]}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.roles.map((r) => (
            <span key={r} className="rounded-md bg-secondary px-2 py-0.5 text-xs font-mono text-secondary-foreground">
              {r}
            </span>
          ))}
        </div>
      </div>

      <figure className="mb-8 overflow-hidden rounded-xl border bg-muted/30">
        {imgOk ? (
          <img
            src={shotSrc}
            alt={m.title[lang]}
            loading="lazy"
            onError={() => setImgOk(false)}
            className="block w-full"
            data-testid={`screenshot-${m.slug}`}
          />
        ) : (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <ImageOff className="size-8" />
            <p>{T.noScreenshot[lang]}</p>
          </div>
        )}
        <figcaption className="border-t bg-card px-4 py-2 text-xs text-muted-foreground">
          {T.screenshot[lang]}: <span className="font-mono">{m.appPath ?? "—"}</span>
        </figcaption>
      </figure>

      <div className="prose prose-slate max-w-none dark:prose-invert">
        {m.sections.map((s, i) => (
          <section key={i} className="mb-6">
            <h2 className="text-xl font-semibold">{s.heading[lang]}</h2>
            <p className="whitespace-pre-line leading-relaxed text-foreground/90">
              {s.body[lang]}
            </p>
          </section>
        ))}

        {m.tips && m.tips.length > 0 && (
          <section className="not-prose rounded-lg border border-amber-300/50 bg-amber-50 p-4 dark:border-amber-700/40 dark:bg-amber-950/30">
            <div className="mb-2 flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
              <Lightbulb className="size-4" />
              {T.tips[lang]}
            </div>
            <ul className="list-disc space-y-1.5 ps-5 text-sm text-amber-900/90 dark:text-amber-100/90">
              {m.tips.map((t, i) => (
                <li key={i}>{t[lang]}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="no-print mt-8 border-t pt-4">
        <a
          href={`/api/docs/export?lang=${lang}&module=${m.slug}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent"
          data-testid={`button-pdf-${m.slug}`}
        >
          <FileDown className="size-4" />
          {T.pdf[lang]}
        </a>
      </div>
    </article>
  );
}
