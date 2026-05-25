export default function Title() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col justify-center"
      style={{ padding: "8vh 8vw" }}
    >
      <div className="absolute top-[8vh] left-[8vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[82vw]">
        <h1 className="font-display font-bold text-[7.5vw] leading-[1.02] tracking-tight text-text m-0">
          حاسبة<span className="text-accent">.AI</span>
        </h1>
        <p className="text-[1.85vw] font-normal text-muted mt-[3vh] mb-[6vh] max-w-[58vw] leading-[1.5]">
          منصّة تخطيط موارد المؤسسات. مصمَّمة من جذورها للأعمال السعودية والعربية. سبعة عشر وحدة متكاملة في نظام واحد.
        </p>

        <div className="w-full h-px bg-line mb-[3.5vh]" />

        <div className="flex gap-[1.8vw]">
          <div className="flex flex-col gap-[1vh]">
            <div className="w-[5vw] h-[5vw] bg-primary" />
            <div className="text-[0.78vw] text-muted tracking-wider" style={{ direction: "ltr", textAlign: "right" }}>#1A2530</div>
          </div>
          <div className="flex flex-col gap-[1vh]">
            <div className="w-[5vw] h-[5vw] bg-warm border border-line" />
            <div className="text-[0.78vw] text-muted tracking-wider" style={{ direction: "ltr", textAlign: "right" }}>#EBE9E4</div>
          </div>
          <div className="flex flex-col gap-[1vh]">
            <div className="w-[5vw] h-[5vw] bg-sage" />
            <div className="text-[0.78vw] text-muted tracking-wider" style={{ direction: "ltr", textAlign: "right" }}>#8F9B8B</div>
          </div>
          <div className="flex flex-col gap-[1vh]">
            <div className="w-[5vw] h-[5vw] bg-accent" />
            <div className="text-[0.78vw] text-muted tracking-wider" style={{ direction: "ltr", textAlign: "right" }}>#C27A65</div>
          </div>
          <div className="flex flex-col gap-[1vh]">
            <div className="w-[5vw] h-[5vw] bg-cream border border-line" />
            <div className="text-[0.78vw] text-muted tracking-wider" style={{ direction: "ltr", textAlign: "right" }}>#F7F5F0</div>
          </div>
        </div>

        <div className="w-full h-px bg-line mt-[3.5vh] mb-[3vh]" />

        <div className="flex gap-[3vw] text-[1.05vw] text-muted">
          <div><span className="font-semibold text-text">17</span> وحدة</div>
          <div className="text-line">·</div>
          <div><span className="font-semibold text-text">8</span> أدوار</div>
          <div className="text-line">·</div>
          <div><span className="font-semibold text-text">5</span> نماذج ذكاء اصطناعي</div>
          <div className="text-line">·</div>
          <div><span className="font-semibold text-text">14</span> حارس صلاحيات</div>
          <div className="text-line">·</div>
          <div><span className="font-semibold text-text">1</span> منصّة عربية</div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
    </div>
  );
}
