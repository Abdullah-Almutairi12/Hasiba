import { Link } from "wouter";
import { GLOSSARY, findModule, type Lang } from "@workspace/docs-content";
import { BookOpen } from "lucide-react";

const T = {
  title: { ar: "مسرد المصطلحات", en: "Glossary" },
  subtitle: {
    ar: "تعريفات موجزة للمصطلحات الضريبية والمحاسبية والتقنية المستخدمة في حاسبة.AI.",
    en: "Short definitions of the tax, accounting, and technical terms used across حاسبة.AI.",
  },
  seeAlso: { ar: "اقرأ أيضًا", en: "See also" },
};

export default function Glossary({ lang }: { lang: Lang }) {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="mb-8 flex items-start gap-4 rounded-xl border bg-card p-6">
        <div className="rounded-lg bg-primary/10 p-3 text-primary">
          <BookOpen className="size-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{T.title[lang]}</h1>
          <p className="mt-2 text-muted-foreground">{T.subtitle[lang]}</p>
        </div>
      </header>

      <dl className="space-y-5">
        {GLOSSARY.map((g) => (
          <div
            key={g.id}
            id={g.id}
            className="rounded-lg border bg-card p-5"
            data-testid={`glossary-${g.id}`}
          >
            <dt className="text-lg font-semibold">{g.term[lang]}</dt>
            <dd className="mt-2 leading-relaxed text-foreground/90">{g.definition[lang]}</dd>
            {g.seeAlso && g.seeAlso.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {T.seeAlso[lang]}:{" "}
                {g.seeAlso
                  .map((s) => findModule(s))
                  .filter((m): m is NonNullable<typeof m> => m !== null)
                  .map((m, i, arr) => (
                    <span key={m.slug}>
                      <Link
                        href={`/m/${m.slug}`}
                        className="text-primary hover:underline"
                      >
                        {m.title[lang]}
                      </Link>
                      {i < arr.length - 1 && <span className="text-muted-foreground"> • </span>}
                    </span>
                  ))}
              </p>
            )}
          </div>
        ))}
      </dl>
    </article>
  );
}
