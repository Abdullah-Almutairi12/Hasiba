export default function AdminPanel() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col justify-start"
      style={{ padding: "8vh 8vw", paddingTop: "16vh" }}
    >
      <div className="absolute top-[8vh] left-[8vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[84vw]">
        <div className="text-[1vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[2vh]">
          الوحدة 17
        </div>
        <h2 className="font-display font-bold text-[4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2.5vh]">
          لوحة تحكم المدير
        </h2>
        <p className="text-[1.4vw] text-muted max-w-[62vw] leading-[1.6] mb-[5.5vh]">
          صفحة <span className="text-text font-semibold">/admin</span> مخصَّصة للمديرين فقط، تجمع كل أدوات الإشراف على المنصّة في مكان واحد.
        </p>

        <div className="flex gap-[1.5vw]">
          <div className="flex-1 bg-cream p-[1.8vw]">
            <div className="text-[2vw] font-bold text-accent leading-none mb-[1.5vh]">01</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">نظرة عامة</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">مؤشرات الأداء وصحة النظام والإعلانات النشطة.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.8vw]">
            <div className="text-[2vw] font-bold text-accent leading-none mb-[1.5vh]">02</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">الدعم الفني</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">تذاكر مع ردود وحالات وأولويات.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.8vw]">
            <div className="text-[2vw] font-bold text-accent leading-none mb-[1.5vh]">03</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">الإعلانات</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">نشر وانتهاء وحذف للإعلانات على مستوى المنصّة.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.8vw]">
            <div className="text-[2vw] font-bold text-accent leading-none mb-[1.5vh]">04</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">الميزات</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">مفاتيح تشغيل المميزات مجمَّعة بحسب الفئة.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.8vw]">
            <div className="text-[2vw] font-bold text-accent leading-none mb-[1.5vh]">05</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">السجلات</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">أحدث سجلات التدقيق لكل عملية حساسة.</p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-text">18</div>
    </div>
  );
}
