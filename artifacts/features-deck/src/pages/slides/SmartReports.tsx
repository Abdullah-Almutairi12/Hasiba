export default function SmartReports() {
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
            الوحدة 08 — الذكاء الاصطناعي
          </div>
          <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            التقارير الذكية وكشف الاحتيال
          </h2>
          <p className="text-[1.25vw] text-muted leading-[1.6] mb-[3vh]">
            مساعد طبيعي بالعربية، توقعات مستقبلية، قيمة العميل مدى الحياة، ومحرّك يرصد المعاملات الخارجة عن النمط.
          </p>
          <div className="flex flex-col gap-[2vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">مساعد بالعربية</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">اسأل بياناتك بلغة طبيعية، يجيب بسياق أعمالك الحيّ.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">توقعات وCLV</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">مبيعات الأسبوع القادم وقيمة العميل عبر دورة حياته.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">كشف الاحتيال</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">درجة z-score متعددة الأبعاد ترصد المعاملات الشاذّة.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <div className="border border-line">
            <div className="bg-warm px-[1.8vw] py-[1.5vh] flex justify-between items-center">
              <div className="text-[1vw] font-semibold text-text">معاملات مشبوهة — اليوم</div>
              <div className="text-[0.85vw] text-accent font-semibold uppercase tracking-wider">3 تنبيهات</div>
            </div>
            <div className="flex justify-between px-[1.8vw] py-[1vh] bg-cream text-[0.85vw] uppercase tracking-wider text-muted">
              <span>الطلب</span>
              <span>الفرع</span>
              <span>الدرجة</span>
            </div>
            <div className="flex justify-between px-[1.8vw] py-[1.5vh] text-[1vw] border-t border-line">
              <span className="font-semibold text-text" style={{ direction: "ltr" }}>POS-3214</span>
              <span className="text-muted">الرياض</span>
              <span className="text-accent font-semibold">+4.2σ</span>
            </div>
            <div className="flex justify-between px-[1.8vw] py-[1.5vh] text-[1vw] border-t border-line">
              <span className="font-semibold text-text" style={{ direction: "ltr" }}>POS-3289</span>
              <span className="text-muted">جدة</span>
              <span className="text-accent font-semibold">+3.8σ</span>
            </div>
            <div className="flex justify-between px-[1.8vw] py-[1.5vh] text-[1vw] border-t border-line">
              <span className="font-semibold text-text" style={{ direction: "ltr" }}>POS-3301</span>
              <span className="text-muted">الدمام</span>
              <span className="text-accent font-semibold">+3.1σ</span>
            </div>
            <div className="flex justify-between px-[1.8vw] py-[1.2vh] bg-cream text-[0.9vw] border-t border-line">
              <span className="text-muted">قاعدة الكشف</span>
              <span className="font-mono text-text" style={{ direction: "ltr" }}>z &gt; 3.0 · multi-dim</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">12</div>
    </div>
  );
}
