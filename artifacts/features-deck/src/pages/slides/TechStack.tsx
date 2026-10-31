import { SlideFrame } from "../../components/deck";

export default function TechStack() {
  return (
    <SlideFrame page="30" kicker="تقنية النظام" title="مبنيّ على أسس تقنية واضحة" lead="منصّة TypeScript بعقد OpenAPI أولًا، وتوليد آلي للأنواع والـHooks بين الواجهة والخادم.">
      <div className="grid grid-cols-3 gap-[2.5vw] h-full">
        <div className="bg-warm p-[1.6vw]">
          <div className="text-[1.8vw] font-semibold text-text mb-[0.4vh]">الواجهة</div>
          <div dir="ltr" className="text-[1.5vw] text-accent text-right mb-[1.6vh]">Frontend</div>
          <div dir="ltr" className="text-[1.6vw] leading-[1.7] text-muted text-right">
            <div>React 19 + Vite 7</div>
            <div>TanStack Query + Wouter</div>
            <div>Tailwind v4 + shadcn/ui</div>
            <div>i18next · RTL</div>
          </div>
        </div>
        <div className="bg-warm p-[1.6vw]">
          <div className="text-[1.8vw] font-semibold text-text mb-[0.4vh]">الخادم</div>
          <div dir="ltr" className="text-[1.5vw] text-accent text-right mb-[1.6vh]">Backend</div>
          <div dir="ltr" className="text-[1.6vw] leading-[1.7] text-muted text-right">
            <div>Express 5 · Node 24</div>
            <div>TypeScript + Zod</div>
            <div>OpenAPI + Orval</div>
            <div>Sessions · CSRF · Audit</div>
          </div>
        </div>
        <div className="bg-primary text-cream p-[1.6vw]">
          <div className="text-[1.8vw] font-semibold mb-[0.4vh]">البيانات والتشغيل</div>
          <div dir="ltr" className="text-[1.5vw] text-sage text-right mb-[1.6vh]">Data and Ops</div>
          <div dir="ltr" className="text-[1.6vw] leading-[1.7] text-cream/80 text-right">
            <div>PostgreSQL + Drizzle</div>
            <div>Company-scoped queries</div>
            <div>Versioned migrations</div>
            <div>External AI provider</div>
          </div>
        </div>
      </div>
    </SlideFrame>
  );
}
