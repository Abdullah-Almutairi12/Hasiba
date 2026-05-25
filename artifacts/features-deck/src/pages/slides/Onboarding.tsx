export default function Onboarding() {
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
          الوحدة 15 — النمو والإدارة
        </div>
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          التسجيل والإعداد الموجَّه
        </h2>
        <p className="text-[1.2vw] text-muted max-w-[64vw] leading-[1.6] mb-[4vh]">
          تجربة بدء سلسة من إنشاء الحساب إلى أوّل فاتورة. شاشة <span className="font-mono text-[1.05vw] text-text">/signup</span> لإنشاء الشركة، ومعالج <span className="font-mono text-[1.05vw] text-text">/onboarding</span> من خمس خطوات.
        </p>

        <div className="text-[0.82vw] uppercase tracking-[0.15em] text-muted mb-[1.8vh]">خطوات المعالج</div>
        <div className="flex gap-[1.2vw]">
          <div className="flex-1 bg-cream p-[1.6vw] relative">
            <div className="font-display text-[2.5vw] font-bold text-accent leading-none mb-[1.5vh]">01</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">إنشاء الشركة</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">الاسم التجاري، الرقم الضريبي، الشعار، والعنوان.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.5vw] font-bold text-accent leading-none mb-[1.5vh]">02</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">إضافة الفروع</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">المواقع، المستودعات، وأرقام التواصل لكل فرع.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.5vw] font-bold text-accent leading-none mb-[1.5vh]">03</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">دعوة المستخدمين</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">إسناد دور لكل مستخدم من ثمان فئات معتمدة.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.5vw] font-bold text-accent leading-none mb-[1.5vh]">04</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">خطة الحسابات</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">قالب جاهز قابل للتعديل بحسب طبيعة النشاط.</p>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.5vw] font-bold text-accent leading-none mb-[1.5vh]">05</div>
            <div className="text-[1.1vw] font-semibold text-text mb-[0.8vh]">جاهز للانطلاق</div>
            <p className="text-[0.95vw] leading-[1.6] text-muted m-0">رفع المنتجات الأولية والبدء بالبيع فورًا.</p>
          </div>
        </div>

        <div className="mt-[4vh] flex items-center gap-[2vw] text-[1.05vw] text-muted">
          <span>المدة المتوقعة:</span>
          <span className="font-semibold text-text">≤ 10 دقائق</span>
          <span className="text-line">·</span>
          <span>بدون مساعدة فنية</span>
          <span className="text-line">·</span>
          <span>قابل للحفظ والمتابعة لاحقًا</span>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">21</div>
    </div>
  );
}
