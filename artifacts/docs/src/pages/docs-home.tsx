import { Link } from "wouter";
import { BookOpen, Sparkles } from "lucide-react";
import type { DocCategory, Lang } from "@workspace/docs-content";

const T = {
  title: { ar: "دليل المستخدم", en: "User Manual" },
  subtitle: {
    ar: "كل ما تحتاجه لاستخدام حاسبة.AI ERP — مرتّب حسب الوحدات وبصور تُحدَّث تلقائيًا مع كل إصدار.",
    en: "Everything you need to use حاسبة.AI ERP — organized by module with screenshots that auto-refresh on every release.",
  },
  start: { ar: "ابدأ من هنا", en: "Start here" },
  intro: {
    ar: "اختر وحدة من القائمة الجانبية أو من البطاقات أدناه. كل صفحة تحتوي على خطوات مرتّبة، صور من داخل التطبيق، وملاحظات الأدوار المسموح لها.",
    en: "Pick a module from the sidebar or the cards below. Each page has ordered steps, in-app screenshots, and the roles that can access it.",
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
