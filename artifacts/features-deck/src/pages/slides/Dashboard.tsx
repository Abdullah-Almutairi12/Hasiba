export default function Dashboard() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col justify-start"
      style={{ padding: "8vh 8vw", paddingTop: "18vh" }}
    >
      <div className="absolute top-[8vh] left-[8vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[84vw]">
        <div className="text-[1vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[2vh]">
          الوحدة 01
        </div>
        <h2 className="font-display font-bold text-[4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2.5vh]">
          لوحة القيادة التنفيذية
        </h2>
        <p className="text-[1.5vw] text-muted max-w-[60vw] leading-[1.6] mb-[6vh]">
          لوحة زجاجية داكنة بأسلوب Glassmorphism تجمع كل ما يهمّ صانع القرار في شاشة واحدة.
        </p>

        <div className="flex gap-[3vw]">
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">01. رؤى الذكاء الاصطناعي</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.15vw] leading-[1.7] text-muted m-0">
              تحليل لحظي لتطوّر المبيعات وفرص النمو، وتلخيص ذكي لأبرز ما يجب أن يعرفه المدير اليوم.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">02. مؤشّر صحة الأعمال</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.15vw] leading-[1.7] text-muted m-0">
              درجة مجمَّعة تلخّص أداء التشغيل اليومي عبر المبيعات والمخزون والسيولة في رقم واحد.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">03. أداء الفروع</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.15vw] leading-[1.7] text-muted m-0">
              مقارنة مباشرة بين الفروع الأفضل والأقل أداءً، مع مخططات مبيعات تحدّث ذاتيًا.
            </p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-text">02</div>
    </div>
  );
}
