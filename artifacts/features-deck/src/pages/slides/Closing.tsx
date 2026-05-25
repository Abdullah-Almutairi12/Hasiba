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

      <div className="max-w-[70vw]">
        <h2 className="font-display font-bold text-[6vw] leading-[1.05] tracking-tight m-0 mb-[4vh] text-cream">
          شكرًا.
        </h2>
        <p className="text-[1.8vw] font-normal text-cream/75 mb-[6vh] leading-[1.55]">
          حاسبة<span className="text-accent">.AI</span> — نظام تخطيط موارد المؤسسات، مصمَّم من جذوره لعالم الأعمال السعودي والعربي.
        </p>

        <div className="w-[10vw] h-px bg-cream/30 mx-auto mb-[4vh]" />

        <div className="flex justify-center gap-[3vw] text-[1.1vw] text-cream/70" style={{ direction: "ltr" }}>
          <div>hasba.ai</div>
          <div>·</div>
          <div>17 modules</div>
          <div>·</div>
          <div>Arabic-first</div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-cream/60">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-cream">20</div>
    </div>
  );
}
