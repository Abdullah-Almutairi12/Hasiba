export default function Closing() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-primary text-cream font-body flex flex-col justify-center items-center"
      style={{ padding: "8vh 8vw", textAlign: "center" }}
    >
      <div className="absolute top-[8vh] left-[8vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-cream/80">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[72vw]">
        <h2 className="font-display font-bold text-[6.5vw] leading-[1.02] tracking-tight m-0 mb-[3vh] text-cream">
          شكرًا.
        </h2>
        <p className="text-[1.7vw] font-normal text-cream/80 mb-[5vh] leading-[1.55]">
          حاسبة<span className="text-accent">.AI</span> — نظام تخطيط موارد المؤسسات، مصمَّم من جذوره لعالم الأعمال السعودي والعربي.
        </p>

        <div className="w-[10vw] h-px bg-cream/30 mx-auto mb-[4vh]" />

        <div className="flex justify-center gap-[2vw] text-[1.1vw] text-cream/75 mb-[4vh]">
          <div><span className="font-semibold text-cream">17</span> وحدة</div>
          <div className="text-cream/30">·</div>
          <div><span className="font-semibold text-cream">8</span> أدوار</div>
          <div className="text-cream/30">·</div>
          <div><span className="font-semibold text-cream">5</span> نماذج AI</div>
          <div className="text-cream/30">·</div>
          <div><span className="font-semibold text-cream">14</span> حارس</div>
          <div className="text-cream/30">·</div>
          <div>RTL أساسي</div>
        </div>

        <div className="flex justify-center gap-[3vw] text-[1vw] text-cream/60 font-mono" style={{ direction: "ltr" }}>
          <div>hasba.ai</div>
          <div>·</div>
          <div>Arabic-first ERP</div>
          <div>·</div>
          <div>ZATCA · NCA ECC</div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-cream/60">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-cream">27</div>
    </div>
  );
}
