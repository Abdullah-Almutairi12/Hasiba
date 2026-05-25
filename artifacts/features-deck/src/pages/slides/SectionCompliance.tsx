export default function SectionCompliance() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-primary text-cream font-body flex flex-col justify-center"
      style={{ padding: "8vh 8vw" }}
    >
      <div className="absolute top-[8vh] left-[8vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-cream/80">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[80vw]">
        <div className="flex items-baseline gap-[1.5vw] mb-[3vh]">
          <span className="font-display text-[10vw] font-bold leading-none text-accent" style={{ direction: "ltr" }}>03</span>
          <span className="text-[2vw] text-cream/70" style={{ direction: "ltr" }}>/ 04</span>
        </div>
        <h2 className="font-display font-bold text-[5.5vw] leading-[1.05] tracking-tight text-cream m-0 mb-[3vh]">
          الامتثال والأمان
        </h2>
        <div className="w-[10vw] h-[3px] bg-accent mb-[3vh]" />
        <p className="text-[1.5vw] text-cream/85 max-w-[55vw] leading-[1.55] m-0">
          خمس وحدات تحفظ بيانات الشركة وامتثالها: متعدد الفروع، ثمانية أدوار، ZATCA، المعاملات بين الشركات، وتسعير التحويل والزكاة.
        </p>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-cream/70">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-cream">14</div>
    </div>
  );
}
