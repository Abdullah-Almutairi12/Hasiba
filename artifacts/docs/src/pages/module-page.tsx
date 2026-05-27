import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ChevronRight,
  ImageOff,
  FileDown,
  Shield,
  ListChecks,
  Layers,
  AlertTriangle,
  Compass,
  CalendarClock,
} from "lucide-react";
import type { DocModule, Lang } from "@workspace/docs-content";
import { DOCS_VERSION, findModule } from "@workspace/docs-content";
import Callout from "@/components/callout";
import Steps from "@/components/steps";
import Faq from "@/components/faq";

const T = {
  back: { ar: "كل الوحدات", en: "All modules" },
  screenshot: { ar: "لقطة الشاشة", en: "Screenshot" },
  noScreenshot: {
    ar: "لم تُلتقط بعد. ستتحدّث تلقائيًا بعد أول نشر للتطبيق.",
    en: "Not captured yet. Will auto-refresh after the next deployment.",
  },
  roles: { ar: "الأدوار المسموح لها", en: "Allowed roles" },
  pdf: { ar: "تنزيل هذه الوحدة PDF", en: "Download this module as PDF" },
  prerequisites: { ar: "قبل أن تبدأ", en: "Before you begin" },
  steps: { ar: "الخطوات", en: "Steps" },
  scenarios: { ar: "سيناريوهات شائعة", en: "Common scenarios" },
  troubleshooting: { ar: "استكشاف الأخطاء", en: "Troubleshooting" },
  related: { ar: "وحدات ذات صلة", en: "Related modules" },
  lastUpdated: { ar: "آخر تحديث", en: "Last updated" },
};

function ScreenshotImg({ slug, lang, title }: { slug: string; lang: Lang; title: string }) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const png = `${base}/screenshots/${lang}/${slug}.png`;
  const svg = `${base}/screenshots/${lang}/${slug}.svg`;
  const [src, setSrc] = useState(png);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSrc(png);
    setFailed(false);
  }, [png]);
  if (failed) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <ImageOff className="size-8" />
        <p>{T.noScreenshot[lang]}</p>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={title}
      loading="lazy"
      onError={() => {
        if (src === png) setSrc(svg);
        else setFailed(true);
      }}
      className="block w-full"
      data-testid={`screenshot-${slug}`}
    />
  );
}

export default function ModulePage({ lang, module: m }: { lang: Lang; module: DocModule }) {
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
            <span
              key={r}
              className="rounded-md bg-secondary px-2 py-0.5 text-xs font-mono text-secondary-foreground"
            >
              {r}
            </span>
          ))}
        </div>
      </div>

      <figure className="mb-8 overflow-hidden rounded-xl border bg-muted/30">
        <ScreenshotImg slug={m.slug} lang={lang} title={m.title[lang]} />
        <figcaption className="border-t bg-card px-4 py-2 text-xs text-muted-foreground">
          {T.screenshot[lang]}: <span className="font-mono">{m.appPath ?? "—"}</span>
        </figcaption>
      </figure>

      <div className="prose prose-slate max-w-none dark:prose-invert">
        {m.prerequisites && m.prerequisites.length > 0 && (
          <section className="not-prose mb-6 rounded-lg border bg-card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
              <ListChecks className="size-4 text-primary" />
              {T.prerequisites[lang]}
            </h2>
            <ul className="list-disc space-y-1 ps-5 text-sm text-foreground/90">
              {m.prerequisites.map((p, i) => (
                <li key={i}>{p[lang]}</li>
              ))}
            </ul>
          </section>
        )}

        {m.steps && m.steps.length > 0 && (
          <section className="mb-6">
            <h2 className="text-xl font-semibold">{T.steps[lang]}</h2>
            <Steps steps={m.steps} lang={lang} />
          </section>
        )}

        {m.sections?.map((s, i) => (
          <section key={i} className="mb-6">
            <h2 className="text-xl font-semibold">{s.heading[lang]}</h2>
            <p className="whitespace-pre-line leading-relaxed text-foreground/90">
              {s.body[lang]}
            </p>
          </section>
        ))}

        {m.callouts?.map((c, i) => (
          <Callout key={i} kind={c.kind} lang={lang}>
            {c.body[lang]}
          </Callout>
        ))}

        {m.tips && m.tips.length > 0 && (
          <Callout kind="tip" lang={lang}>
            <ul className="list-disc space-y-1 ps-5">
              {m.tips.map((t, i) => (
                <li key={i}>{t[lang]}</li>
              ))}
            </ul>
          </Callout>
        )}

        {m.scenarios && m.scenarios.length > 0 && (
          <section className="not-prose mb-6">
            <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold">
              <Layers className="size-5 text-primary" />
              {T.scenarios[lang]}
            </h2>
            <div className="space-y-3">
              {m.scenarios.map((s, i) => (
                <div key={i} className="rounded-lg border bg-card p-4">
                  <h3 className="text-base font-semibold">{s.title[lang]}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">
                    {s.body[lang]}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {m.troubleshooting && m.troubleshooting.length > 0 && (
          <section className="not-prose mb-6">
            <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold">
              <AlertTriangle className="size-5 text-amber-600" />
              {T.troubleshooting[lang]}
            </h2>
            <Faq items={m.troubleshooting} lang={lang} />
          </section>
        )}

        {m.related && m.related.length > 0 && (
          <section className="not-prose mb-6 rounded-lg border bg-card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
              <Compass className="size-4 text-primary" />
              {T.related[lang]}
            </h2>
            <div className="flex flex-wrap gap-2">
              {m.related
                .map((s) => findModule(s))
                .filter((x): x is NonNullable<typeof x> => x !== null)
                .map((rm) => (
                  <Link
                    key={rm.slug}
                    href={`/m/${rm.slug}`}
                    className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
                    data-testid={`related-${rm.slug}`}
                  >
                    {rm.title[lang]}
                  </Link>
                ))}
            </div>
          </section>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <a
          href={`/api/docs/export?lang=${lang}&module=${m.slug}`}
          className="no-print inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent"
          data-testid={`button-pdf-${m.slug}`}
        >
          <FileDown className="size-4" />
          {T.pdf[lang]}
        </a>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" />
          {T.lastUpdated[lang]}: <span className="font-mono">{m.lastUpdated}</span>
          <span className="mx-1">•</span>
          {lang === "ar" ? "إصدار الدليل" : "Docs version"}:{" "}
          <span className="font-mono">{DOCS_VERSION}</span>
        </div>
      </div>
    </article>
  );
}
