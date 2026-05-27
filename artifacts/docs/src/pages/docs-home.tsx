import { Link } from "wouter";
import { BookOpen, Sparkles, ArrowRight, HelpCircle, BookMarked } from "lucide-react";
import type { DocCategory, Lang } from "@workspace/docs-content";

const T = {
  title: { ar: "دليل المستخدم", en: "User Manual" },
  subtitle: {
    ar: "كل ما تحتاجه لاستخدام حاسبة.AI ERP — مرتّب حسب الوحدات وبصور تُحدَّث تلقائيًا مع كل إصدار.",
    en: "Everything you need to use حاسبة.AI ERP — organized by module with screenshots that auto-refresh on every release.",
  },
  start: { ar: "ابدأ من هنا", en: "Start here" },
  intro: {
    ar: "إن كانت هذه أوّل مرة، ابدأ من «ابدأ خلال 10 دقائق». ثم اختر الوحدة التي تهمّك من البطاقات أو القائمة الجانبية.",
    en: "If this is your first time, start with the 10-minute quick start. Then pick a module from the cards or the sidebar.",
  },
  quickStart: { ar: "ابدأ خلال 10 دقائق", en: "Get started in 10 minutes" },
  quickStartDesc: {
    ar: "من إنشاء الحساب حتى أول فاتورة، خمس خطوات فقط.",
    en: "From signup to your first invoice — only five steps.",
  },
  faq: { ar: "الأسئلة الشائعة", en: "FAQ" },
  faqDesc: {
    ar: "إجابات سريعة على أكثر الأسئلة تكرارًا.",
    en: "Quick answers to the most common questions.",
  },
  glossary: { ar: "مسرد المصطلحات", en: "Glossary" },
  glossaryDesc: {
    ar: "تعريف موجز لكل مصطلح ضريبي أو محاسبي مستخدم.",
    en: "A short definition for every tax or accounting term we use.",
  },
};

export default function DocsHome({ lang, categories }: { lang: Lang; categories: DocCategory[] }) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-10 flex items-start gap-4 rounded-xl border bg-card p-6">
        <div className="rounded-lg bg-primary/10 p-3 text-primary">
          <BookOpen className="size-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{T.title[lang]}</h1>
          <p className="mt-2 text-muted-foreground">{T.subtitle[lang]}</p>
        </div>
      </div>

      <div className="mb-8 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Sparkles className="size-4 text-primary" />
          {T.start[lang]}
        </div>
        <p className="mt-1 text-muted-foreground">{T.intro[lang]}</p>
      </div>

      <section className="mb-10 grid gap-3 sm:grid-cols-3">
        {[
          { href: "/quick-start", Icon: Sparkles, t: T.quickStart[lang], d: T.quickStartDesc[lang], primary: true, tid: "card-quick-start" },
          { href: "/glossary", Icon: BookMarked, t: T.glossary[lang], d: T.glossaryDesc[lang], primary: false, tid: "card-glossary" },
          { href: "/faq", Icon: HelpCircle, t: T.faq[lang], d: T.faqDesc[lang], primary: false, tid: "card-faq" },
        ].map(({ href, Icon, t, d, primary, tid }) => (
          <Link
            key={href}
            href={href}
            className={
              primary
                ? "group flex flex-col gap-2 rounded-xl border-2 border-primary bg-primary/5 p-4 transition hover:bg-primary/10"
                : "group flex flex-col gap-2 rounded-xl border bg-card p-4 transition hover:border-primary hover:shadow-sm"
            }
            data-testid={tid}
          >
            <div className="flex items-center gap-2">
              <Icon className="size-5 text-primary" />
              <h3 className="font-semibold group-hover:text-primary">{t}</h3>
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{d}</p>
            <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-primary">
              {lang === "ar" ? "ابدأ" : "Open"}
              <ArrowRight className={lang === "ar" ? "size-3 rotate-180" : "size-3"} />
            </span>
          </Link>
        ))}
      </section>

      {categories.map((cat) => (
        <section key={cat.slug} className="mb-10">
          <h2 className="mb-4 text-xl font-semibold">{cat.title[lang]}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {cat.modules.map((m) => (
              <Link
                key={m.slug}
                href={`/m/${m.slug}`}
                className="group rounded-lg border bg-card p-4 transition hover:border-primary hover:shadow-sm"
                data-testid={`card-${m.slug}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {String(m.position).padStart(2, "0")}
                  </span>
                  <h3 className="font-medium group-hover:text-primary">{m.title[lang]}</h3>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                  {m.summary[lang]}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
