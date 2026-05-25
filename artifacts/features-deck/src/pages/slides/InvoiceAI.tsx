export default function InvoiceAI() {
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
          الوحدة 07 — الذكاء الاصطناعي
        </div>
        <h2 className="font-display font-bold text-[3.6vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          فواتير الموردين بالذكاء الاصطناعي
        </h2>
        <p className="text-[1.25vw] text-muted max-w-[64vw] leading-[1.6] mb-[4.5vh]">
          وكيل مسح الفواتير: صوّر بالكاميرا أو ارفع صورة، ودَع الذكاء الاصطناعي يقرأ ويُسجِّل ويُحدِّث المخزون في معاملة قاعدة بيانات واحدة.
        </p>

        <div className="text-[0.85vw] uppercase tracking-[0.15em] text-muted mb-[2vh]">من اللقطة إلى القيد</div>
        <div className="flex gap-[1vw] items-stretch mb-[3.5vh]">
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.3vw] font-bold text-accent leading-none mb-[1vh]">01</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.5vh]">صوّر أو ارفع</div>
            <p className="text-[0.92vw] leading-[1.55] text-muted m-0">كاميرا الجهاز أو صورة من الجهاز (JPEG/PNG/WEBP).</p>
          </div>
          <div className="flex items-center text-accent text-[1.5vw]">←</div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.3vw] font-bold text-accent leading-none mb-[1vh]">02</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.5vh]">OpenAI Vision</div>
            <p className="text-[0.92vw] leading-[1.55] text-muted m-0">gpt-5-mini يقرأ المورد، التواريخ، البنود، الضريبة، الإجمالي.</p>
          </div>
          <div className="flex items-center text-accent text-[1.5vw]">←</div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.3vw] font-bold text-accent leading-none mb-[1vh]">03</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.5vh]">راجِع وعدِّل</div>
            <p className="text-[0.92vw] leading-[1.55] text-muted m-0">واجهة مراجعة للبنود قبل التسجيل النهائي.</p>
          </div>
          <div className="flex items-center text-accent text-[1.5vw]">←</div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[2.3vw] font-bold text-accent leading-none mb-[1vh]">04</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.5vh]">سجِّل تلقائيًا</div>
            <p className="text-[0.92vw] leading-[1.55] text-muted m-0">قيد محاسبي + تحديث مخزون + ربط المنتجات.</p>
          </div>
        </div>

        <div className="bg-primary p-[1.8vw] flex gap-[3vw] items-center">
          <div className="flex-1">
            <div className="text-[0.78vw] uppercase tracking-[0.2em] text-cream/60 mb-[0.5vh]">النموذج</div>
            <div className="font-mono text-[1.1vw] text-cream">gpt-5-mini</div>
          </div>
          <div className="w-px h-[5vh] bg-cream/20" />
          <div className="flex-1">
            <div className="text-[0.78vw] uppercase tracking-[0.2em] text-cream/60 mb-[0.5vh]">النقطة الطرفية</div>
            <div className="font-mono text-[1.1vw] text-cream" style={{ direction: "ltr" }}>/api/invoices/scan</div>
          </div>
          <div className="w-px h-[5vh] bg-cream/20" />
          <div className="flex-1">
            <div className="text-[0.78vw] uppercase tracking-[0.2em] text-cream/60 mb-[0.5vh]">حدّ الطلبات</div>
            <div className="font-mono text-[1.1vw] text-cream">15 / 15 دقيقة</div>
          </div>
          <div className="w-px h-[5vh] bg-cream/20" />
          <div className="flex-1">
            <div className="text-[0.78vw] uppercase tracking-[0.2em] text-cream/60 mb-[0.5vh]">حجم الصورة</div>
            <div className="font-mono text-[1.1vw] text-cream">≤ 20 MB</div>
          </div>
          <div className="w-px h-[5vh] bg-cream/20" />
          <div className="flex-1">
            <div className="text-[0.78vw] uppercase tracking-[0.2em] text-cream/60 mb-[0.5vh]">الصلاحية</div>
            <div className="font-mono text-[1.1vw] text-cream">مدير + محاسب</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">11</div>
    </div>
  );
}
