export default function Inventory() {
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
            الوحدة 03 — المنصّة الأساسية
          </div>
          <h2 className="font-display font-bold text-[3.6vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            المنتجات والمخزون
          </h2>
          <p className="text-[1.3vw] text-muted leading-[1.6] mb-[3vh]">
            إدارة المنتجات والفئات ومستويات المخزون عبر كل فرع ومستودع، مع تنبيهات تلقائية للأصناف الحرجة.
          </p>

          <div className="flex flex-col gap-[2vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">منتجات وفئات هرمية</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">هيكل فئات متشعّب، باركود، وأسعار متعددة لكل منتج.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">حركة مخزون موثَّقة</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">سجل كامل لكل عملية إدخال وإخراج، مع تتبّع المصدر.</div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">تنبيهات النفاذ</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">إشعارات تلقائية قبل نفاد الأصناف عند تجاوز الحد الأدنى.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-[2vh] justify-center">
          <div className="bg-cream p-[2vw]">
            <div className="text-[0.85vw] uppercase tracking-wider text-muted mb-[1.5vh]">تتبّع لحظي</div>
            <div className="font-display text-[3.2vw] font-bold text-primary leading-none mb-[0.5vh]">Real-time</div>
            <div className="text-[1vw] text-muted">تحديث آني لمستويات المخزون عبر كل القنوات.</div>
          </div>
          <div className="bg-cream p-[2vw]">
            <div className="text-[0.85vw] uppercase tracking-wider text-muted mb-[1.5vh]">تنبيهات تلقائية</div>
            <div className="font-display text-[3.2vw] font-bold text-accent leading-none mb-[0.5vh]">≤ حد أدنى</div>
            <div className="text-[1vw] text-muted">قاعدة قابلة للتخصيص لكل منتج وفرع.</div>
          </div>
          <div className="bg-cream p-[2vw]">
            <div className="text-[0.85vw] uppercase tracking-wider text-muted mb-[1.5vh]">مستودعات وفروع</div>
            <div className="font-display text-[3.2vw] font-bold text-sage leading-none mb-[0.5vh]">متعدّد</div>
            <div className="text-[1vw] text-muted">دعم كامل لتعدّد المستودعات والفروع.</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">06</div>
    </div>
  );
}
