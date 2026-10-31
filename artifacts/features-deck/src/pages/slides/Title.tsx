import { StatusStrip } from "../../components/deck";

export default function Title() {
  return (
    <div dir="rtl" className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col" style={{ padding: "7vh 8vw 5vh" }}>
      <div dir="ltr" className="text-[1.5vw] font-semibold tracking-[0.12em] text-text text-left">FEATURES OVERVIEW / 2026</div>
      <div className="flex-1 flex flex-col justify-center">
        <h1 className="font-display font-bold text-[7.5vw] leading-[1.02] tracking-tight text-text m-0">
          حاسبة<span className="text-accent">.AI</span>
        </h1>
        <p className="text-[2.1vw] text-muted mt-[2.5vh] mb-[4vh] max-w-[66vw] leading-[1.5]">
          نظام ERP عربي للمنشآت السعودية: مبيعات ومخزون ومحاسبة وفروع وصلاحيات في منصّة واحدة. نظرة للشركاء بحالة تنفيذ مؤرخة.
        </p>
        <div className="w-full h-px bg-line mb-[3vh]" />
        <div className="flex gap-[1.8vw] mb-[3vh]">
          <div className="w-[4vw] h-[4vw] bg-primary" />
          <div className="w-[4vw] h-[4vw] bg-warm border border-line" />
          <div className="w-[4vw] h-[4vw] bg-sage" />
          <div className="w-[4vw] h-[4vw] bg-accent" />
          <div className="w-[4vw] h-[4vw] bg-cream border border-line" />
        </div>
        <div className="flex flex-wrap gap-x-[2.4vw] gap-y-[1vh] text-[1.7vw] text-muted">
          <div><span className="font-semibold text-text">رحلة أمر بيع</span> موثّقة حتى الفاتورتين</div>
          <div className="text-line">·</div>
          <div><span className="font-semibold text-text">هوية ضريبية</span> بنسخ مؤرخة</div>
          <div className="text-line">·</div>
          <div><span className="font-semibold text-text">أدوار</span> مقيّدة بالشركة والفرع</div>
        </div>
      </div>
      <StatusStrip />
      <div className="flex justify-between items-baseline mt-[1.2vh] text-[1.5vw] text-muted">
        <span>حاسبة.AI — منصّة تخطيط موارد المؤسسات</span>
        <span>اجتماع الشركاء · 31 أكتوبر 2026 · الرياض</span>
      </div>
    </div>
  );
}
