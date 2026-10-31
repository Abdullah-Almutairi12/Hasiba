import type { ReactNode } from "react";

export function StatusStrip() {
  return (
    <div className="flex items-center gap-[1.2vw] bg-warm px-[1.4vw] py-[0.9vh] text-[1.5vw] leading-[1.35] text-text">
      <span className="font-semibold text-accent whitespace-nowrap">الحالة · 31 أكتوبر 2026</span>
      <span className="text-muted">
        قبول موثّق: رحلة أمر البيع والهوية الضريبية · معلّق: أجهزة حية، دفع، بريد، قبول ضريبي إنتاجي
      </span>
    </div>
  );
}

export function SlideFrame({
  page,
  kicker,
  title,
  lead,
  children,
}: {
  page: string;
  kicker: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col"
      style={{ padding: "5.5vh 6vw 4.5vh" }}
    >
      <div className="flex justify-between items-baseline mb-[1.8vh]">
        <div className="text-[1.5vw] font-semibold text-accent">{kicker}</div>
        <div dir="ltr" className="text-[1.5vw] font-semibold tracking-[0.12em] text-text">
          FEATURES OVERVIEW / 2026
        </div>
      </div>
      <h2 className="font-display font-bold text-[3.3vw] leading-[1.15] tracking-tight text-text m-0">{title}</h2>
      {lead ? (
        <p className="text-[1.75vw] text-muted leading-[1.5] mt-[1.2vh] mb-0 max-w-[82vw]">{lead}</p>
      ) : null}
      <div className="flex-1 min-h-0 mt-[3vh]">{children}</div>
      <div className="mt-[1.6vh]">
        <StatusStrip />
      </div>
      <div className="flex justify-between items-baseline mt-[1.2vh] text-[1.5vw] text-muted">
        <span>حاسبة.AI — منصّة تخطيط موارد المؤسسات</span>
        <span dir="ltr" className="font-semibold text-text">{page}</span>
      </div>
    </div>
  );
}

export function SectionFrame({
  num,
  page,
  title,
  text,
}: {
  num: string;
  page: string;
  title: string;
  text: string;
}) {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-cream text-text font-body flex flex-col"
      style={{ padding: "7vh 8vw 5vh" }}
    >
      <div dir="ltr" className="text-[1.5vw] font-semibold tracking-[0.12em] text-text text-left">
        FEATURES OVERVIEW / 2026
      </div>
      <div className="flex-1 flex flex-col justify-center">
        <div className="flex items-baseline gap-[1.5vw] mb-[2.5vh]">
          <span dir="ltr" className="font-display text-[9vw] font-bold leading-none text-accent">{num}</span>
          <span dir="ltr" className="text-[2vw] text-muted">/ 04</span>
        </div>
        <h2 className="font-display font-bold text-[5.2vw] leading-[1.08] tracking-tight text-text m-0 mb-[3vh]">{title}</h2>
        <div className="w-[10vw] h-[3px] bg-accent mb-[3vh]" />
        <p className="text-[2vw] text-muted max-w-[66vw] leading-[1.55] m-0">{text}</p>
      </div>
      <StatusStrip />
      <div className="flex justify-between items-baseline mt-[1.2vh] text-[1.5vw] text-muted">
        <span>حاسبة.AI — منصّة تخطيط موارد المؤسسات</span>
        <span dir="ltr" className="font-semibold text-text">{page}</span>
      </div>
    </div>
  );
}

export function Point({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-[0.8vw] mb-[0.8vh]">
        <span dir="ltr" className="text-[1.5vw] font-semibold text-accent">{n}</span>
        <span className="text-[1.8vw] font-semibold text-text">{title}</span>
      </div>
      <div className="w-[2vw] h-[3px] bg-accent mb-[1vh]" />
      <p className="text-[1.6vw] leading-[1.55] text-muted m-0">{children}</p>
    </div>
  );
}

export function Panel({ label, children, dark = true }: { label: string; children: ReactNode; dark?: boolean }) {
  return (
    <div className={dark ? "bg-primary text-cream p-[1.6vw] h-full" : "bg-warm text-text p-[1.6vw] h-full"}>
      <div className={dark ? "text-[1.5vw] font-semibold text-sage mb-[1.4vh]" : "text-[1.5vw] font-semibold text-accent mb-[1.4vh]"}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function Row({ k, v, strong = false }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-[1vw] border-b border-current/15 py-[0.9vh] text-[1.6vw]">
      <span className="opacity-80">{k}</span>
      <span dir="ltr" className={strong ? "font-bold text-accent" : "font-semibold"}>{v}</span>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[1.5vw] leading-[1.5] opacity-75 mt-[1.4vh] mb-0">{children}</p>;
}
