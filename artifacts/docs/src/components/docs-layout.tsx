import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Search, BookOpen, Languages, FileDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocCategory, DocModule, Lang } from "@workspace/docs-content";

interface Props {
  lang: Lang;
  setLang: (l: Lang) => void;
  categories: DocCategory[];
  modules: DocModule[];
  children: ReactNode;
}

const T = {
  appName: { ar: "دليل المستخدم — حاسبة.AI", en: "User Manual — حاسبة.AI" },
  search: { ar: "ابحث في الدليل…", en: "Search the manual…" },
  noResults: { ar: "لا توجد نتائج", en: "No results" },
  exportPdf: { ar: "تنزيل PDF كامل", en: "Download full PDF" },
  openApp: { ar: "فتح التطبيق", en: "Open the app" },
};

export default function DocsLayout({ lang, setLang, categories, modules, children }: Props) {
  const [location] = useLocation();
  const [query, setQuery] = useState("");
  const isEmbed =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("embed") === "1";

  // In embed mode the header is hidden, so we still expose a small
  // floating toggle so iframe users aren't stranded in the wrong
  // language if the parent didn't pass `?lang=` yet.
  const floatingToggle = isEmbed ? (
    <button
      type="button"
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      className="no-print fixed bottom-4 z-50 inline-flex h-8 items-center gap-1 rounded-full border bg-card px-3 text-xs shadow-md hover:bg-accent"
      style={lang === "ar" ? { left: "1rem" } : { right: "1rem" }}
      data-testid="button-lang-toggle-embed"
    >
      <Languages className="size-3.5" />
      {lang === "ar" ? "EN" : "AR"}
    </button>
  ) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return modules.filter((m) =>
      [
        m.title.ar,
        m.title.en,
        m.summary.ar,
        m.summary.en,
        ...m.sections.flatMap((s) => [s.heading.ar, s.heading.en, s.body.ar, s.body.en]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [query, modules]);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  // ERP app lives at "/" on the same proxy.
  const appHref = "/";
  const pdfHref = `/api/docs/export?lang=${lang}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {!isEmbed && (
        <header className="no-print sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <BookOpen className="size-5 text-primary" />
              <span className="hidden sm:inline">{T.appName[lang]}</span>
            </Link>
            <div className="flex-1" />
            <div className="relative w-full max-w-md">
              <Search className={cn("absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground", lang === "ar" ? "right-3" : "left-3")} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={T.search[lang]}
                className={cn(
                  "h-9 w-full rounded-md border bg-card text-sm outline-none transition focus:ring-2 focus:ring-primary/40",
                  lang === "ar" ? "pr-9 pl-3 text-right" : "pl-9 pr-3 text-left",
                )}
              />
            </div>
            <button
              type="button"
              onClick={() => setLang(lang === "ar" ? "en" : "ar")}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent"
              data-testid="button-lang-toggle"
            >
              <Languages className="size-4" />
              {lang === "ar" ? "EN" : "AR"}
            </button>
            <a
              href={pdfHref}
              className="hidden h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent md:inline-flex"
              data-testid="link-pdf"
            >
              <FileDown className="size-4" />
              PDF
            </a>
            <a
              href={appHref}
              className="hidden h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 md:inline-flex"
            >
              <ExternalLink className="size-4" />
              {T.openApp[lang]}
            </a>
          </div>
        </header>
      )}

      <div className="mx-auto flex max-w-7xl">
        {!isEmbed && (
          <aside className="no-print sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-l bg-sidebar p-4 md:block">
            {filtered ? (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  {filtered.length} {lang === "ar" ? "نتيجة" : "results"}
                </p>
                {filtered.length === 0 && (
                  <p className="text-sm text-muted-foreground">{T.noResults[lang]}</p>
                )}
                <ul className="space-y-1">
                  {filtered.map((m) => (
                    <li key={m.slug}>
                      <Link
                        href={`/m/${m.slug}`}
                        className={cn(
                          "block rounded px-2 py-1.5 text-sm hover:bg-sidebar-accent",
                          location === `/m/${m.slug}` && "bg-sidebar-accent font-medium",
                        )}
                      >
                        {m.title[lang]}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              categories.map((cat) => (
                <div key={cat.slug} className="mb-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat.title[lang]}
                  </h3>
                  <ul className="space-y-1">
                    {cat.modules.map((m) => (
                      <li key={m.slug}>
                        <Link
                          href={`/m/${m.slug}`}
                          className={cn(
                            "block rounded px-2 py-1.5 text-sm hover:bg-sidebar-accent",
                            location === `/m/${m.slug}` && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                          )}
                          data-testid={`nav-${m.slug}`}
                        >
                          <span className="text-muted-foreground tabular-nums me-1.5">
                            {String(m.position).padStart(2, "0")}.
                          </span>
                          {m.title[lang]}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </aside>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
          {children}
        </main>
      </div>
      {floatingToggle}
    </div>
  );
}
