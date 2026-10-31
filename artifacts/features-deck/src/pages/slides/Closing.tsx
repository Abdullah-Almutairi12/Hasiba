import { StatusStrip } from "../../components/deck";

export default function Closing() {
  return (
    <div dir="rtl" className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col" style={{ padding: "7vh 8vw 5vh" }}>
      <div dir="ltr" className="text-[1.5vw] font-semibold tracking-[0.12em] text-text text-left">FEATURES OVERVIEW / 2026</div>
      <div className="flex-1 flex flex-col justify-center">
        <h2 className="font-display font-bold text-[8vw] leading-[1] tracking-tight text-text m-0">شكرًا.</h2>
        <p className="text-[2.1vw] text-muted mt-[3vh] mb-[4vh] max-w-[66vw] leading-[1.5]">
          حاسبة<span className="text-accent">.AI</span> — نظام ERP عربي للمنشآت السعودية، نعرض ما ثبت اليوم ونسمّي ما بقي بوضوح.
        </p>
        <div className="w-full h-px bg-line mb-[3vh]" />
        <div className="text-[1.8vw] font-semibold text-text mb-[1.4vh]">الخطوات التالية المقترحة</div>
        <div className="flex flex-wrap gap-x-[2.4vw] gap-y-[1vh] text-[1.7vw] text-muted">
          <div>قبول ضريبي إنتاجي</div>
          <div className="text-line">·</div>
          <div>اختبار أجهزة الشريك</div>
          <div className="text-line">·</div>
          <div>ربط الدفع والبريد</div>
          <div className="text-line">·</div>
          <div>تجربة على بيانات الشريك</div>
        </div>
      </div>
      <StatusStrip />
      <div className="flex justify-between items-baseline mt-[1.2vh] text-[1.5vw] text-muted">
        <span>حاسبة.AI — منصّة تخطيط موارد المؤسسات</span>
        <span dir="ltr" className="font-semibold text-text">32</span>
      </div>
    </div>
  );
}
