export default function AIModels() {
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
          نماذج الذكاء الاصطناعي
        </div>
        <h2 className="font-display font-bold text-[4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2.5vh]">
          خمسة نماذج تعمل خلف الكواليس
        </h2>
        <p className="text-[1.4vw] text-muted max-w-[62vw] leading-[1.6] mb-[5.5vh]">
          مسجَّلة في جدول <span className="font-semibold text-text">ai_models</span> ومتاحة عبر <span className="font-semibold text-text">/api/ai/*</span>، مع تدريب تلقائي عند أوّل استخدام.
        </p>

        <div className="flex gap-[1.5vw]">
          <div className="flex-1 border border-line p-[1.6vw]">
            <div className="text-[2vw] font-bold text-accent leading-none mb-[1.5vh]">01</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.8vh]">توقعات المبيعات</div>
            <p className="text-[0.9vw] leading-[1.6] text-muted m-0">انحدار خطي مع تنعيم EWMA على المبيعات اليومية للأيام السبعة القادمة.</p>
          </div>
          <div className="flex-1 border border-line p-[1.6vw]">
            <div className="text-[2vw] font-bold text-accent leading-none mb-[1.5vh]">02</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.8vh]">فقدان العملاء</div>
            <p className="text-[0.9vw] leading-[1.6] text-muted m-0">تحليل RFM: التاريخ، التكرار، والقيمة لتحديد العملاء المعرَّضين للفقد.</p>
          </div>
          <div className="flex-1 border border-line p-[1.6vw]">
            <div className="text-[2vw] font-bold text-accent leading-none mb-[1.5vh]">03</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.8vh]">كشف الاحتيال</div>
            <p className="text-[0.9vw] leading-[1.6] text-muted m-0">درجة z-score على قيمة الطلب وعدد العناصر وساعة المعاملة.</p>
          </div>
          <div className="flex-1 border border-line p-[1.6vw]">
            <div className="text-[2vw] font-bold text-accent leading-none mb-[1.5vh]">04</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.8vh]">توصيات المنتجات</div>
            <p className="text-[0.9vw] leading-[1.6] text-muted m-0">تحليل Basket Lift على عناصر طلبات نقطة البيع للاقتراحات الذكية.</p>
          </div>
          <div className="flex-1 border border-line p-[1.6vw]">
            <div className="text-[2vw] font-bold text-accent leading-none mb-[1.5vh]">05</div>
            <div className="text-[1.05vw] font-semibold text-text mb-[0.8vh]">المساعد الذكي</div>
            <p className="text-[0.9vw] leading-[1.6] text-muted m-0">محادثة طبيعية بـ gpt-5-mini مع سياق أعمالك الحيّ لآخر 30 يومًا.</p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-text">19</div>
    </div>
  );
}
