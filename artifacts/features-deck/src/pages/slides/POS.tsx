export default function POS() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body"
      style={{ padding: "7vh 7vw", paddingTop: "14vh" }}
    >
      <div className="absolute top-[7vh] left-[7vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[86vw]">
        <div className="text-[0.95vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[1.5vh]">
          الوحدة 02 — المنصّة الأساسية
        </div>
        <h2 className="font-display font-bold text-[3.6vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          نقطة البيع (POS)
        </h2>
        <p className="text-[1.3vw] text-muted max-w-[62vw] leading-[1.6] mb-[5vh]">
          نظام نقطة بيع سريع مصمَّم لإيقاع المتاجر السعودية، يعمل على الكاشير أو الجهاز اللوحي بنفس البيانات.
        </p>

        <div className="text-[0.85vw] uppercase tracking-[0.15em] text-muted mb-[2vh]">دورة البيع الكاملة</div>
        <div className="flex gap-[1.2vw] items-stretch">
          <div className="flex-1 bg-cream p-[1.6vw] relative">
            <div className="font-display text-[2.5vw] font-bold text-accent leading-none mb-[1.5vh]">01</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">افتح الجلسة</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">رصيد افتتاحي، اسم الكاشير، والفرع — في خطوة واحدة.</p>
          </div>
          <div className="flex items-center text-accent text-[1.5vw]">←</div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.5vw] font-bold text-accent leading-none mb-[1.5vh]">02</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">أضف الأصناف</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">باركود أو بحث سريع، مع تحديث آني لمستوى المخزون.</p>
          </div>
          <div className="flex items-center text-accent text-[1.5vw]">←</div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.5vw] font-bold text-accent leading-none mb-[1.5vh]">03</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">طبّق الخصومات</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">خصومات يدوية، كوبونات، أو نقاط ولاء العميل.</p>
          </div>
          <div className="flex items-center text-accent text-[1.5vw]">←</div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.5vw] font-bold text-accent leading-none mb-[1.5vh]">04</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">أغلق وسوِّ</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">تسوية تلقائية للوردية، رمز ZATCA، وقيد محاسبي فوري.</p>
          </div>
        </div>

        <div className="mt-[5vh] flex gap-[3vw] text-[1.05vw] text-muted">
          <div><span className="font-semibold text-text">جلسات يومية</span> برصيد افتتاحي وختامي</div>
          <div className="text-line">·</div>
          <div><span className="font-semibold text-text">طباعة فاتورة</span> بنقرة واحدة</div>
          <div className="text-line">·</div>
          <div><span className="font-semibold text-text">ربط مباشر</span> بالمخزون والمحاسبة</div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">05</div>
    </div>
  );
}
