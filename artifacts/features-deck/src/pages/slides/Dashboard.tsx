export default function Dashboard() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body"
      style={{ padding: "7vh 7vw", paddingTop: "14vh" }}
    >
      <div className="absolute top-[7vh] left-[7vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="flex gap-[4vw] h-[72vh]">
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-[0.95vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[1.5vh]">
            الوحدة 01 — المنصّة الأساسية
          </div>
          <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            لوحة القيادة التنفيذية
          </h2>
          <p className="text-[1.25vw] text-muted leading-[1.6] mb-[3vh]">
            لوحة زجاجية داكنة بأسلوب Glassmorphism تجمع كل ما يهمّ صانع القرار في شاشة واحدة.
          </p>

          <div className="flex flex-col gap-[2vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">رؤى الذكاء الاصطناعي</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">تحليل لحظي للمبيعات وفرص النمو وأهم التغيّرات اليومية.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">مؤشّر صحة الأعمال</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">درجة مجمَّعة تلخّص أداء التشغيل عبر المبيعات والمخزون والسيولة.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">أداء الفروع</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">مقارنة مباشرة بين الأفضل والأقل أداءً مع مخططات تحدّث ذاتيًا.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-[2vh] justify-center">
          <div className="bg-warm relative" style={{ height: "32vh" }}>
            <div className="absolute top-[2vh] right-[1.5vw] text-[0.9vw] font-semibold text-text tracking-wider uppercase">
              المبيعات / آخر 7 أيام
            </div>
            <div className="absolute bottom-0 left-[6%] w-[10%] bg-sage" style={{ height: "35%" }} />
            <div className="absolute bottom-0 left-[20%] w-[10%] bg-sage" style={{ height: "55%" }} />
            <div className="absolute bottom-0 left-[34%] w-[10%] bg-accent" style={{ height: "72%" }} />
            <div className="absolute bottom-0 left-[48%] w-[10%] bg-primary" style={{ height: "48%" }} />
            <div className="absolute bottom-0 left-[62%] w-[10%] bg-sage" style={{ height: "60%" }} />
            <div className="absolute bottom-0 left-[76%] w-[10%] bg-accent" style={{ height: "85%" }} />
            <div className="absolute bottom-0 left-[90%] w-[7%] bg-primary" style={{ height: "62%" }} />
          </div>
          <div className="flex gap-[1.5vw]">
            <div className="flex-1 bg-cream p-[1.5vw]">
              <div className="text-[0.85vw] uppercase tracking-wider text-muted mb-[1vh]">صحة الأعمال</div>
              <div className="font-display text-[3.2vw] font-bold text-primary leading-none">87<span className="text-[1.4vw] text-muted">/100</span></div>
            </div>
            <div className="flex-1 bg-cream p-[1.5vw]">
              <div className="text-[0.85vw] uppercase tracking-wider text-muted mb-[1vh]">نمو أسبوعي</div>
              <div className="font-display text-[3.2vw] font-bold text-accent leading-none">+24%</div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">04</div>
    </div>
  );
}
