export default function TechStack() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body"
      style={{ padding: "7vh 7vw", paddingTop: "13vh" }}
    >
      <div className="absolute top-[7vh] left-[7vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[86vw]">
        <div className="text-[0.95vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[1.5vh]">
          تقنية النظام
        </div>
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          مبنيّ على أسس تقنية متينة
        </h2>
        <p className="text-[1.2vw] text-muted max-w-[64vw] leading-[1.6] mb-[4.5vh]">
          منصّة TypeScript متكاملة، تتبع العقد أولًا (Contract-First) عبر OpenAPI، مع توليد آلي للأنواع وHooks بين الواجهة والخادم.
        </p>

        <div className="flex gap-[1.5vw]">
          <div className="flex-1 border border-line p-[1.8vw]">
            <div className="text-[0.85vw] uppercase tracking-[0.2em] text-accent font-semibold mb-[1.5vh]">الواجهة</div>
            <div className="text-[1.4vw] font-bold text-text mb-[2vh]">Frontend</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <div className="flex flex-col gap-[1.2vh] text-[1vw] text-muted">
              <div><span className="font-mono text-text">React 19</span> + Vite 7</div>
              <div><span className="font-mono text-text">TanStack Query</span> + Wouter</div>
              <div><span className="font-mono text-text">Tailwind v4</span> + shadcn/ui</div>
              <div><span className="font-mono text-text">Recharts</span> + Framer Motion</div>
              <div><span className="font-mono text-text">i18next</span> · RTL أساسي</div>
              <div>IBM Plex Sans Arabic</div>
            </div>
          </div>

          <div className="flex-1 border border-line p-[1.8vw]">
            <div className="text-[0.85vw] uppercase tracking-[0.2em] text-accent font-semibold mb-[1.5vh]">الخادم</div>
            <div className="text-[1.4vw] font-bold text-text mb-[2vh]">Backend</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <div className="flex flex-col gap-[1.2vh] text-[1vw] text-muted">
              <div><span className="font-mono text-text">Express 5</span> على Node 24</div>
              <div><span className="font-mono text-text">TypeScript 5.9</span></div>
              <div><span className="font-mono text-text">Zod v4</span> للتحقق</div>
              <div><span className="font-mono text-text">OpenAPI</span> + Orval codegen</div>
              <div><span className="font-mono text-text">OpenAI Vision</span> · gpt-5-mini</div>
              <div>جلسات + CSRF + Audit Log</div>
            </div>
          </div>

          <div className="flex-1 border border-line p-[1.8vw]">
            <div className="text-[0.85vw] uppercase tracking-[0.2em] text-accent font-semibold mb-[1.5vh]">البيانات والتشغيل</div>
            <div className="text-[1.4vw] font-bold text-text mb-[2vh]">Data &amp; Ops</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <div className="flex flex-col gap-[1.2vh] text-[1vw] text-muted">
              <div><span className="font-mono text-text">PostgreSQL</span></div>
              <div><span className="font-mono text-text">Drizzle ORM</span> + Migrations</div>
              <div><span className="font-mono text-text">scopedDb</span> · عزل متعدد الشركات</div>
              <div><span className="font-mono text-text">connect-pg-simple</span> جلسات</div>
              <div><span className="font-mono text-text">Replit App Storage</span></div>
              <div>esbuild · ESM bundle</div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">26</div>
    </div>
  );
}
