export default function AdminPanel() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body"
      style={{ padding: "7vh 7vw", paddingTop: "13vh" }}
    >
      <div className="absolute top-[7vh] left-[7vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[86vw]">
        <div className="text-[0.95vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[1.5vh]">
          الوحدة 19 — النمو والإدارة
        </div>
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          لوحة تحكم المدير
        </h2>
        <p className="text-[1.2vw] text-muted max-w-[64vw] leading-[1.6] mb-[4vh]">
          صفحة <span className="font-mono text-[1.05vw] text-text">/admin</span> مخصَّصة للمديرين فقط، تجمع كل أدوات الإشراف على المنصّة في خمس تبويبات.
        </p>

        <div className="flex gap-[1.2vw] mb-[3.5vh]">
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.3vw] font-bold text-accent leading-none mb-[1.5vh]">01</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.8vh]">نظرة عامة</div>
            <p className="text-[0.9vw] leading-[1.55] text-muted m-0">مؤشرات أداء، صحة النظام، والإعلانات النشطة في لحظة واحدة.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.3vw] font-bold text-accent leading-none mb-[1.5vh]">02</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.8vh]">الدعم الفني</div>
            <p className="text-[0.9vw] leading-[1.55] text-muted m-0">تذاكر CRUD مع ردود، حالات، وأولويات قابلة للتعيين.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.3vw] font-bold text-accent leading-none mb-[1.5vh]">03</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.8vh]">الإعلانات</div>
            <p className="text-[0.9vw] leading-[1.55] text-muted m-0">نشر وانتهاء وحذف للإعلانات على مستوى كل المنصّة.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.3vw] font-bold text-accent leading-none mb-[1.5vh]">04</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.8vh]">الميزات</div>
            <p className="text-[0.9vw] leading-[1.55] text-muted m-0">مفاتيح تشغيل المميزات (Feature Flags) مجمَّعة بحسب الفئة.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.3vw] font-bold text-accent leading-none mb-[1.5vh]">05</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.8vh]">السجلات</div>
            <p className="text-[0.9vw] leading-[1.55] text-muted m-0">أحدث سجلات التدقيق لكل عملية حساسة على النظام.</p>
          </div>
        </div>

        <div className="flex gap-[2vw] text-[1vw] text-muted">
          <div>المسار: <span className="font-mono text-text text-[0.95vw]" style={{ direction: "ltr" }}>/admin</span></div>
          <div className="text-line">·</div>
          <div>الجداول: <span className="font-mono text-text text-[0.95vw]">support_tickets · announcements · feature_flags</span></div>
          <div className="text-line">·</div>
          <div>الصلاحية: <span className="font-semibold text-text">مدير فقط</span></div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">25</div>
    </div>
  );
}
