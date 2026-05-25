export default function Reports() {
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
          الوحدة 05 — المنصّة الأساسية
        </div>
        <h2 className="font-display font-bold text-[3.6vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          التقارير والتحليلات
        </h2>
        <p className="text-[1.25vw] text-muted max-w-[60vw] leading-[1.6] mb-[4vh]">
          مكتبة تقارير قابلة للتصدير إلى Excel وPDF تغطّي كل وحدة في النظام بعمق.
        </p>

        <div className="flex gap-[1.5vw] mb-[3.5vh]">
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[3vw] font-bold text-primary leading-none mb-[0.8vh]">40+</div>
            <div className="text-[0.95vw] font-semibold text-muted uppercase tracking-wider">تقرير جاهز</div>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[3vw] font-bold text-sage leading-none mb-[0.8vh]">Excel</div>
            <div className="text-[0.95vw] font-semibold text-muted uppercase tracking-wider">تصدير غني</div>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[3vw] font-bold text-accent leading-none mb-[0.8vh]">PDF</div>
            <div className="text-[0.95vw] font-semibold text-muted uppercase tracking-wider">جاهز للطباعة</div>
          </div>
          <div className="flex-1 bg-cream p-[1.6vw]">
            <div className="font-display text-[3vw] font-bold text-text leading-none mb-[0.8vh]">Live</div>
            <div className="text-[0.95vw] font-semibold text-muted uppercase tracking-wider">مؤشرات لحظية</div>
          </div>
        </div>

        <div className="flex gap-[1.5vw]">
          <div className="flex-1 bg-warm relative" style={{ height: "22vh" }}>
            <div className="absolute top-[1.5vh] right-[1.5vw] text-[0.85vw] font-semibold text-text uppercase tracking-wider">
              توزّع التقارير بحسب الوحدة
            </div>
            <div className="absolute bottom-0 left-[5%] w-[10%] bg-primary" style={{ height: "70%" }} />
            <div className="absolute bottom-0 left-[20%] w-[10%] bg-sage" style={{ height: "55%" }} />
            <div className="absolute bottom-0 left-[35%] w-[10%] bg-accent" style={{ height: "85%" }} />
            <div className="absolute bottom-0 left-[50%] w-[10%] bg-primary" style={{ height: "45%" }} />
            <div className="absolute bottom-0 left-[65%] w-[10%] bg-sage" style={{ height: "65%" }} />
            <div className="absolute bottom-0 left-[80%] w-[10%] bg-accent" style={{ height: "50%" }} />
          </div>
          <div className="w-[22vw] border border-line p-[1.5vw] flex flex-col justify-between">
            <div className="text-[1vw] font-semibold text-text">فئات التقارير</div>
            <div className="flex flex-col gap-[0.8vh] text-[0.95vw] text-muted">
              <div>· مبيعات بالفرع والمستخدم</div>
              <div>· مخزون وجرد وحركة</div>
              <div>· ربحية بحسب المنتج</div>
              <div>· محاسبة وضرائب</div>
              <div>· عملاء وولاء</div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">08</div>
    </div>
  );
}
