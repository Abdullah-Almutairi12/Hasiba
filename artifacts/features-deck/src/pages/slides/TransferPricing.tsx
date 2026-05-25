export default function TransferPricing() {
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
          الوحدة 14 — الامتثال والأمان
        </div>
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          تسعير التحويل والزكاة
        </h2>
        <p className="text-[1.2vw] text-muted max-w-[64vw] leading-[1.6] mb-[4vh]">
          كشف تلقائي للمعاملات بين الشركات التي قد تستوجب توثيق تسعير التحويل، ومحرّك سنوي يحسب الوعاء الزكوي مع تنبيهات الامتثال.
        </p>

        <div className="flex gap-[2vw] mb-[3vh]">
          <div className="flex-1 border border-line p-[2vw]">
            <div className="flex items-center justify-between mb-[2vh]">
              <div className="text-[1.4vw] font-bold text-text">تسعير التحويل (TP)</div>
              <div className="text-[0.85vw] font-semibold text-accent uppercase tracking-wider">Phase 3</div>
            </div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1vw] leading-[1.65] text-muted m-0 mb-[2vh]">
              رصد تلقائي للمعاملات بين الشركات التي قد تستوجب توثيق تسعير التحويل بحسب أنظمة الهيئة، عبر <span className="font-mono text-[0.9vw]">compliance hooks</span> داخل دالة الانعكاس.
            </p>
            <div className="bg-cream px-[1.2vw] py-[1vh] text-[0.95vw] flex justify-between">
              <span className="text-muted">آخر تنبيه</span>
              <span className="font-semibold text-text">مفتوح · يستحق توثيقًا</span>
            </div>
          </div>

          <div className="flex-1 border border-line p-[2vw]">
            <div className="flex items-center justify-between mb-[2vh]">
              <div className="text-[1.4vw] font-bold text-text">محرّك الزكاة</div>
              <div className="text-[0.85vw] font-semibold text-sage uppercase tracking-wider">Annual</div>
            </div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1vw] leading-[1.65] text-muted m-0 mb-[2vh]">
              محرّك سنوي يحسب الوعاء الزكوي مباشرة من بيانات النظام المحاسبية، مع تخزين النتيجة في <span className="font-mono text-[0.9vw]">compliance_alerts</span> وقفل ضد التكرار لنفس الفترة.
            </p>
            <div className="bg-cream px-[1.2vw] py-[1vh] text-[0.95vw] flex justify-between">
              <span className="text-muted">حالة الفترة</span>
              <span className="font-semibold text-text">1446هـ · جاهزة للمراجعة</span>
            </div>
          </div>
        </div>

        <div className="bg-primary text-cream p-[1.5vw] flex items-center gap-[2vw]">
          <div className="text-[0.85vw] uppercase tracking-[0.2em] text-cream/60">تنبيهات الامتثال</div>
          <div className="w-px h-[4vh] bg-cream/20" />
          <div className="text-[1vw] text-cream/90 flex-1">
            قابلة للمتابعة والإغلاق بسجل كامل · فهرس فريد جزئي (<span className="font-mono text-[0.85vw] text-accent">compliance_alerts_zakat_open_uniq</span>) يمنع تكرار التنبيه على نفس الفترة.
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">19</div>
    </div>
  );
}
