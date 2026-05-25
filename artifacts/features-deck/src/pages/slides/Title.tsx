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

      <div className="max-w-[80vw]">
        <h1 className="font-display font-bold text-[7.5vw] leading-[1.05] tracking-tight text-text m-0">
          حاسبة<span className="text-accent">.AI</span>
        </h1>
        <p className="text-[1.9vw] font-normal text-muted mt-[3vh] mb-[7vh] max-w-[55vw] leading-[1.5]">
          منصّة تخطيط موارد المؤسسات. مصمَّمة من جذورها للأعمال السعودية والعربية. سبعة عشر وحدة متكاملة في نظام واحد.
        </p>

        <div className="w-full h-px bg-line mb-[4vh]" />

        <div className="flex gap-[2vw]">
          <div className="flex flex-col gap-[1vh]">
            <div className="w-[5.5vw] h-[5.5vw] bg-primary" />
            <div className="text-[0.8vw] text-muted tracking-wider" style={{ direction: "ltr", textAlign: "right" }}>#1A2530</div>
          </div>
          <div className="flex flex-col gap-[1vh]">
            <div className="w-[5.5vw] h-[5.5vw] bg-warm border border-line" />
            <div className="text-[0.8vw] text-muted tracking-wider" style={{ direction: "ltr", textAlign: "right" }}>#EBE9E4</div>
          </div>
          <div className="flex flex-col gap-[1vh]">
            <div className="w-[5.5vw] h-[5.5vw] bg-sage" />
            <div className="text-[0.8vw] text-muted tracking-wider" style={{ direction: "ltr", textAlign: "right" }}>#8F9B8B</div>
          </div>
          <div className="flex flex-col gap-[1vh]">
            <div className="w-[5.5vw] h-[5.5vw] bg-accent" />
            <div className="text-[0.8vw] text-muted tracking-wider" style={{ direction: "ltr", textAlign: "right" }}>#C27A65</div>
          </div>
          <div className="flex flex-col gap-[1vh]">
            <div className="w-[5.5vw] h-[5.5vw] bg-cream border border-line" />
            <div className="text-[0.8vw] text-muted tracking-wider" style={{ direction: "ltr", textAlign: "right" }}>#F7F5F0</div>
          </div>
        </div>

        <div className="w-full h-px bg-line mt-[4vh]" />
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
    </div>
  );
}
