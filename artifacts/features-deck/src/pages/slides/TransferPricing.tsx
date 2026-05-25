export default function TransferPricing() {
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
          الوحدة 16 — امتثال
        </div>
        <h2 className="font-display font-bold text-[3.6vw] leading-[1.1] tracking-tight text-text m-0 mb-[2.5vh]">
          تسعير التحويل والزكاة
        </h2>
        <p className="text-[1.4vw] text-muted max-w-[62vw] leading-[1.6] mb-[5.5vh]">
          كشف تلقائي للمعاملات التي قد تستوجب توثيق تسعير التحويل، ومحرّك تقدير سنوي للزكاة مع تنبيهات الامتثال.
        </p>

        <div className="flex gap-[3vw]">
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">01. كشف Transfer Pricing</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.1vw] leading-[1.7] text-muted m-0">
              رصد تلقائي للمعاملات بين الشركات التي قد تستوجب توثيق تسعير التحويل بحسب أنظمة الهيئة.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">02. تقدير الزكاة</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.1vw] leading-[1.7] text-muted m-0">
              محرّك سنوي يحسب الوعاء الزكوي تلقائيًا من بيانات النظام المحاسبية الفعلية.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">03. إنذارات الامتثال</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.1vw] leading-[1.7] text-muted m-0">
              تنبيهات قابلة للمتابعة وإغلاقها بسجل كامل، ومنع تكرار الإنذار لنفس الفترة الضريبية.
            </p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-text">17</div>
    </div>
  );
}
