export default function ZakatEngine() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body"
      style={{ padding: "7vh 7vw", paddingTop: "13vh" }}
    >
      <div className="absolute top-[7vh] left-[7vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="flex gap-[4vw] h-[74vh]">
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-[0.95vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[1.5vh]">
            الوحدة 15 — الامتثال والأمان
          </div>
          <h2 className="font-display font-bold text-[3.2vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            محرّك الزكاة السنوي
          </h2>
          <p className="text-[1.25vw] text-muted leading-[1.6] mb-[3vh]">
            وعاء زكوي يُحسب مباشرة من بياناتك المحاسبية، مع طرح البنود المعفاة وتذكير بموعد التقديم لهيئة الزكاة والضريبة والجمارك.
          </p>

          <div className="flex flex-col gap-[1.8vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">قاعدة الحساب من الميزانية</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">إجمالي حقوق الملكية + الالتزامات طويلة الأجل − الأصول الثابتة والاستثمارات المعفاة.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">بنود معفاة تلقائيًا</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">أصول ثابتة، عقارات استثمارية، استثمارات طويلة الأجل — تُستبعد قبل تطبيق نسبة 2.5%.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">تذكير بموعد التقديم</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">تنبيه قبل 120 يومًا من نهاية السنة المالية يضمن تسليم الإقرار في الموعد ZATCA.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <div className="bg-cream p-[2vw]">
            <div className="flex items-center justify-between mb-[2vh]">
              <div>
                <div className="text-[0.85vw] uppercase tracking-[0.2em] text-muted mb-[0.5vh]">الوعاء الزكوي · 1446هـ</div>
                <div className="font-display text-[2.4vw] font-bold text-text leading-none" style={{ direction: "ltr" }}>SAR 1,842,500</div>
              </div>
              <div className="bg-sage/20 text-sage px-[1vw] py-[0.6vh] text-[0.95vw] font-semibold">
                جاهزة للمراجعة
              </div>
            </div>

            <div className="border-t border-line pt-[1.5vh] mb-[1.5vh]">
              <div className="flex justify-between text-[1vw] mb-[1vh]">
                <span className="text-muted">حقوق الملكية</span>
                <span className="font-semibold text-text" style={{ direction: "ltr" }}>SAR 2,150,000</span>
              </div>
              <div className="flex justify-between text-[1vw] mb-[1vh]">
                <span className="text-muted">+ التزامات طويلة الأجل</span>
                <span className="font-semibold text-text" style={{ direction: "ltr" }}>SAR 480,000</span>
              </div>
              <div className="flex justify-between text-[1vw] mb-[1vh]">
                <span className="text-muted">− أصول ثابتة وعقارات</span>
                <span className="font-semibold text-text" style={{ direction: "ltr" }}>(SAR 787,500)</span>
              </div>
              <div className="flex justify-between text-[1.05vw] border-t border-line pt-[1vh] mt-[1vh]">
                <span className="font-semibold text-text">الزكاة المستحقّة (2.5%)</span>
                <span className="font-bold text-accent" style={{ direction: "ltr" }}>SAR 46,063</span>
              </div>
            </div>

            <div className="bg-amber-50 border-r-[3px] border-amber-400 p-[1.5vw] mb-[2vh]">
              <div className="text-[0.85vw] uppercase tracking-wider text-amber-700 font-semibold mb-[0.5vh]">تذكير بموعد التقديم</div>
              <div className="text-[1.05vw] text-text leading-[1.5]">يتبقى 87 يومًا على آخر موعد لتقديم إقرار الزكاة لهذه السنة المالية.</div>
            </div>

            <button className="w-full bg-primary text-cream py-[1.5vh] text-[1.1vw] font-semibold">
              ابدأ تجهيز الإقرار
            </button>
          </div>

          <div className="mt-[1.5vh] text-[0.9vw] text-muted text-center">
            قفل ضد التكرار: <span className="font-mono" style={{ direction: "ltr" }}>compliance_alerts_zakat_open_uniq</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">20</div>
    </div>
  );
}
