import { FAQ, type Lang } from "@workspace/docs-content";
import { HelpCircle } from "lucide-react";
import Faq from "@/components/faq";

const T = {
  title: { ar: "الأسئلة الشائعة", en: "Frequently Asked Questions" },
  subtitle: {
    ar: "إجابات سريعة على الأسئلة الأكثر تكرارًا. لكل وحدة قسم FAQ مصغّر داخل صفحتها.",
    en: "Quick answers to the most common questions. Each module also has its own mini-FAQ on its page.",
  },
};

export default function FaqPage({ lang }: { lang: Lang }) {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="mb-8 flex items-start gap-4 rounded-xl border bg-card p-6">
        <div className="rounded-lg bg-primary/10 p-3 text-primary">
          <HelpCircle className="size-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{T.title[lang]}</h1>
          <p className="mt-2 text-muted-foreground">{T.subtitle[lang]}</p>
        </div>
      </header>

      <Faq items={FAQ} lang={lang} />
    </article>
  );
}
