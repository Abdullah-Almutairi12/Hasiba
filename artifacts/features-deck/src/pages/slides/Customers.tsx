export default function Customers() {
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
            الوحدة 06 — المنصّة الأساسية
          </div>
          <h2 className="font-display font-bold text-[3.6vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            العملاء
          </h2>
          <p className="text-[1.3vw] text-muted leading-[1.6] mb-[3vh]">
            ملف عميل موحَّد يربط البيانات الشخصية، سجل الطلبات، الفواتير، وبرنامج الولاء في مكان واحد.
          </p>
          <div className="flex flex-col gap-[2vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">ملف موحَّد</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">بيانات اتصال، أرصدة، تفضيلات، وملاحظات داخلية.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">سجل طلبات كامل</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">كل المعاملات والفواتير المفتوحة مع تنبيهات للمتأخرات.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">تجزئة وولاء</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">تصنيف ذكي وبرامج نقاط مدمجة مباشرة مع نقطة البيع.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <div className="border border-line">
            <div className="bg-warm px-[1.8vw] py-[1.5vh] flex justify-between items-center">
              <div className="text-[1vw] font-semibold text-text">ملف العميل #4837</div>
              <div className="text-[0.85vw] text-accent font-semibold uppercase tracking-wider">VIP</div>
            </div>
            <div className="p-[1.8vw] flex flex-col gap-[1.8vh]">
              <div className="flex justify-between text-[1.05vw]">
                <span className="text-muted">إجمالي المبيعات</span>
                <span className="font-semibold text-text" style={{ direction: "ltr" }}>SAR 42,180</span>
              </div>
              <div className="flex justify-between text-[1.05vw]">
                <span className="text-muted">عدد الطلبات</span>
                <span className="font-semibold text-text">128</span>
              </div>
              <div className="flex justify-between text-[1.05vw]">
                <span className="text-muted">نقاط الولاء</span>
                <span className="font-semibold text-accent">2,140 نقطة</span>
              </div>
              <div className="flex justify-between text-[1.05vw]">
                <span className="text-muted">آخر زيارة</span>
                <span className="font-semibold text-text">قبل 3 أيام</span>
              </div>
              <div className="w-full h-px bg-line my-[0.5vh]" />
              <div className="flex justify-between text-[1.05vw]">
                <span className="text-muted">قيمة العميل (CLV)</span>
                <span className="font-semibold text-sage" style={{ direction: "ltr" }}>SAR 87,000</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">09</div>
    </div>
  );
}
