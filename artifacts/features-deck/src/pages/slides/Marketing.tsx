export default function Marketing() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body"
      style={{ padding: "7vh 7vw", paddingTop: "13vh" }}
    >
      <div className="absolute top-[7vh] left-[7vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="flex gap-[4vw] h-[74vh]">
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-[0.95vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[1.5vh]">
            الوحدة 20 — النمو والإدارة
          </div>
          <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            التسويق
          </h2>
          <p className="text-[1.2vw] text-muted leading-[1.6] mb-[3vh]">
            إدارة الحملات وقمع العملاء المحتملين (Leads) مع تتبّع معدّلات التحويل في كل مرحلة.
          </p>
          <div className="flex flex-col gap-[1.5vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">إدارة الحملات</span> بميزانية وقياس عائد لكل قناة.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">قمع Leads</span> من الاستحواذ إلى الإغلاق.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">تصنيف الجاهزية</span> للشراء لتركيز جهود المبيعات.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">قياس التحويل</span> في كل مرحلة لتحديد نقاط التحسين.</div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <div className="bg-cream p-[2vw]">
            <div className="text-[0.85vw] uppercase tracking-[0.2em] text-muted mb-[2vh]">قمع التحويل · هذا الشهر</div>

            <div className="flex flex-col gap-[1.2vh] items-stretch">
              <div className="bg-primary text-cream py-[1.5vh] flex justify-between items-center px-[1.5vw]" style={{ width: "100%" }}>
                <span className="text-[1vw] font-semibold">زيارات</span>
                <span className="font-display text-[1.6vw] font-bold">12,840</span>
              </div>
              <div className="bg-primary text-cream py-[1.5vh] flex justify-between items-center px-[1.5vw] mx-auto" style={{ width: "82%" }}>
                <span className="text-[1vw] font-semibold">اهتمام</span>
                <span className="font-display text-[1.6vw] font-bold">3,210</span>
              </div>
              <div className="bg-sage text-cream py-[1.5vh] flex justify-between items-center px-[1.5vw] mx-auto" style={{ width: "62%" }}>
                <span className="text-[1vw] font-semibold">تأهيل</span>
                <span className="font-display text-[1.6vw] font-bold">980</span>
              </div>
              <div className="bg-accent text-cream py-[1.5vh] flex justify-between items-center px-[1.5vw] mx-auto" style={{ width: "38%" }}>
                <span className="text-[1vw] font-semibold">عميل</span>
                <span className="font-display text-[1.6vw] font-bold">214</span>
              </div>
            </div>

            <div className="flex justify-between mt-[2vh] pt-[1.5vh] border-t border-line text-[0.95vw]">
              <span className="text-muted">معدّل التحويل الإجمالي</span>
              <span className="font-semibold text-accent">1.67%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">24</div>
    </div>
  );
}
