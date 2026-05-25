export default function AIModels() {
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
          الوحدة 09 — الذكاء الاصطناعي
        </div>
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          خمسة نماذج تعمل خلف الكواليس
        </h2>
        <p className="text-[1.2vw] text-muted max-w-[62vw] leading-[1.6] mb-[4vh]">
          مسجَّلة في جدول <span className="font-mono text-text text-[1.1vw]">ai_models</span> ومتاحة عبر <span className="font-mono text-text text-[1.1vw]" style={{ direction: "ltr" }}>/api/ai/*</span>، مع تدريب تلقائي عند أوّل استخدام.
        </p>

        <div className="border border-line">
          <div className="flex bg-primary text-cream px-[1.8vw] py-[1.2vh] text-[0.9vw] font-semibold uppercase tracking-wider">
            <div className="w-[5%]">#</div>
            <div className="w-[27%]">النموذج</div>
            <div className="w-[33%]">الخوارزمية</div>
            <div className="w-[35%]" style={{ direction: "ltr", textAlign: "right" }}>النقطة الطرفية</div>
          </div>

          <div className="flex px-[1.8vw] py-[2vh] text-[1.05vw] border-t border-line items-center">
            <div className="w-[5%] font-semibold text-accent" style={{ direction: "ltr" }}>01</div>
            <div className="w-[27%] font-semibold text-text">توقعات المبيعات</div>
            <div className="w-[33%] text-muted">انحدار خطي + تنعيم EWMA</div>
            <div className="w-[35%] font-mono text-text text-[0.95vw]" style={{ direction: "ltr", textAlign: "right" }}>/ai/predict/sales-forecast</div>
          </div>

          <div className="flex px-[1.8vw] py-[2vh] text-[1.05vw] border-t border-line items-center bg-cream">
            <div className="w-[5%] font-semibold text-accent" style={{ direction: "ltr" }}>02</div>
            <div className="w-[27%] font-semibold text-text">فقدان العملاء</div>
            <div className="w-[33%] text-muted">RFM — التاريخ، التكرار، القيمة</div>
            <div className="w-[35%] font-mono text-text text-[0.95vw]" style={{ direction: "ltr", textAlign: "right" }}>/ai/predict/at-risk-customers</div>
          </div>

          <div className="flex px-[1.8vw] py-[2vh] text-[1.05vw] border-t border-line items-center">
            <div className="w-[5%] font-semibold text-accent" style={{ direction: "ltr" }}>03</div>
            <div className="w-[27%] font-semibold text-text">كشف الاحتيال</div>
            <div className="w-[33%] text-muted">z-score متعدد الأبعاد</div>
            <div className="w-[35%] font-mono text-text text-[0.95vw]" style={{ direction: "ltr", textAlign: "right" }}>/ai/predict/fraud-anomalies</div>
          </div>

          <div className="flex px-[1.8vw] py-[2vh] text-[1.05vw] border-t border-line items-center bg-cream">
            <div className="w-[5%] font-semibold text-accent" style={{ direction: "ltr" }}>04</div>
            <div className="w-[27%] font-semibold text-text">توصيات المنتجات</div>
            <div className="w-[33%] text-muted">Basket Lift Analysis</div>
            <div className="w-[35%] font-mono text-text text-[0.95vw]" style={{ direction: "ltr", textAlign: "right" }}>/ai/predict/recommendations</div>
          </div>

          <div className="flex px-[1.8vw] py-[2vh] text-[1.05vw] border-t border-line items-center">
            <div className="w-[5%] font-semibold text-accent" style={{ direction: "ltr" }}>05</div>
            <div className="w-[27%] font-semibold text-text">المساعد الذكي</div>
            <div className="w-[33%] text-muted">gpt-5-mini + سياق أعمال حيّ</div>
            <div className="w-[35%] font-mono text-text text-[0.95vw]" style={{ direction: "ltr", textAlign: "right" }}>/ai/assistant/ask</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">13</div>
    </div>
  );
}
