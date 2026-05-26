import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { useEffect, useState, useMemo } from "react";
import { DOC_CATEGORIES, allModules, findModule, type Lang } from "@workspace/docs-content";
import DocsLayout from "@/components/docs-layout";
import ModulePage from "@/pages/module-page";
import DocsHome from "@/pages/docs-home";

const STORAGE_KEY = "hasba-docs.lang";

function readLangFromUrl(): Lang | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("lang");
  if (q === "ar" || q === "en") return q;
  // Also accept it inside the hash (the ERP /help iframe uses
  // "/docs/?embed=1#/?lang=ar" so the hash carries the language).
  const hash = window.location.hash || "";
  const idx = hash.indexOf("?");
  if (idx >= 0) {
    const hq = new URLSearchParams(hash.slice(idx + 1)).get("lang");
    if (hq === "ar" || hq === "en") return hq;
  }
  return null;
}

function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "ar";
    const fromUrl = readLangFromUrl();
    if (fromUrl) return fromUrl;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "en" ? "en" : "ar";
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    window.localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);
  // Re-sync when the parent (ERP /help) changes language without a
  // full iframe reload (e.g. after hash navigation).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const v = readLangFromUrl();
      if (v && v !== lang) setLangState(v);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [lang]);
  return [lang, setLangState];
}

export default function App() {
  const [lang, setLang] = useLang();
  const modules = useMemo(() => allModules(), []);
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <DocsLayout
        lang={lang}
        setLang={setLang}
        categories={DOC_CATEGORIES}
        modules={modules}
      >
        <Switch>
          <Route path="/" component={() => <DocsHome lang={lang} categories={DOC_CATEGORIES} />} />
          <Route path="/m/:slug">
            {(params) => {
              const m = findModule(params.slug);
              if (!m) return <Redirect to="/" />;
              return <ModulePage lang={lang} module={m} />;
            }}
          </Route>
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </DocsLayout>
    </WouterRouter>
  );
}
