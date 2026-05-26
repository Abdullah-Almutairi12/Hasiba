export default function VatThreshold() {
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
            عدّاد التسجيل في ضريبة القيمة المضافة
          </h2>
          <p className="text-[1.25vw] text-muted leading-[1.6] mb-[3vh]">
            لن تفاجأ بحدّ التسجيل. النظام يحسب مبيعاتك المتداحرة لاثني عشر شهرًا ويُنبّهك قبل بلوغ السقف الإلزامي.
          </p>

          <div className="flex flex-col gap-[1.8vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">تنبيه مبكّر عند 80%</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">إشعار كهرماني على لوحة القيادة حين تتجاوز 300,000 ر.س لتستعدّ مبكرًا.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">تنبيه أحمر عند 375,000 ر.س</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">عند بلوغ السقف الإلزامي يحوّل العدّاد للون الأحمر مع دعوة فورية لبدء التسجيل.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">دعم التسجيل الاختياري 187,500 ر.س</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">حالات: مسجَّل، اختياري، غير مسجَّل — يختارها صاحب العمل أو المحاسب وقتما يشاء.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <div className="bg-cream p-[2vw]">
            <div className="flex items-center justify-between mb-[2vh]">
              <div>
                <div className="text-[0.85vw] uppercase tracking-[0.2em] text-muted mb-[0.5vh]">مبيعات آخر 12 شهرًا</div>
                <div className="font-display text-[2.4vw] font-bold text-text leading-none" style={{ direction: "ltr" }}>SAR 312,400</div>
              </div>
              <div className="bg-accent/15 text-accent px-[1vw] py-[0.6vh] text-[0.95vw] font-semibold">
                83% من السقف
              </div>
            </div>

            <div className="relative h-[2.2vh] bg-bg border border-line mb-[1vh] overflow-hidden">
              <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-amber-400 via-amber-300 to-sage" style={{ width: "83%" }} />
              <div className="absolute inset-y-0 right-[20%] w-[2px] bg-text/40" />
              <div className="absolute inset-y-0 right-0 w-[2px] bg-primary" />
            </div>

            <div className="flex justify-between text-[0.85vw] text-muted mb-[3vh]" style={{ direction: "ltr" }}>
              <span>SAR 0</span>
              <span className="font-semibold text-text">80% — 300K</span>
              <span className="font-semibold text-primary">100% — 375K</span>
            </div>

            <div className="bg-amber-50 border-r-[3px] border-amber-400 p-[1.5vw] mb-[2vh]">
              <div className="text-[0.85vw] uppercase tracking-wider text-amber-700 font-semibold mb-[0.5vh]">تنبيه مبكّر</div>
              <div className="text-[1.05vw] text-text leading-[1.5]">اقتربت من سقف التسجيل الإلزامي. ابدأ تجهيز الأوراق الآن.</div>
            </div>

            <button className="w-full bg-primary text-cream py-[1.5vh] text-[1.1vw] font-semibold">
              ابدأ التسجيل في ZATCA
            </button>
          </div>

          <div className="mt-[1.5vh] text-[0.9vw] text-muted text-center">
            عدّاد مستمر: <span className="font-mono" style={{ direction: "ltr" }}>pos_orders + customer_invoices</span> لآخر 12 شهرًا
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
