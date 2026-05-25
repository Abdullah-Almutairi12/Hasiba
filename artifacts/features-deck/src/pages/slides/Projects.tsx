export default function Projects() {
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
            الوحدة 17 — النمو والإدارة
          </div>
          <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            المشاريع
          </h2>
          <p className="text-[1.2vw] text-muted leading-[1.6] mb-[3vh]">
            لوحة Kanban وقائمة مهام، مع ميزانية ومؤشر تقدّم محسوب تلقائيًا لكل مشروع.
          </p>
          <div className="flex flex-col gap-[1.5vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">لوحة Kanban</span> بأعمدة قابلة للتخصيص.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">ميزانية مفصَّلة</span> مع تتبّع الإنفاق الفعلي مقابل المخطّط.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">مؤشّر التقدّم</span> يُحتسب تلقائيًا من المهام المكتملة.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">قائمة مهام</span> بديلة بنفس البيانات لعرض مكثَّف.</div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <div className="bg-cream p-[1.5vw]">
            <div className="flex justify-between items-center mb-[1.5vh]">
              <div className="text-[1vw] font-semibold text-text">مشروع: إطلاق فرع الخبر</div>
              <div className="text-[0.85vw] font-semibold text-accent">68% مكتمل</div>
            </div>
            <div className="w-full h-[0.8vh] bg-warm relative mb-[2vh]">
              <div className="absolute right-0 top-0 h-full bg-accent" style={{ width: "68%" }} />
            </div>

            <div className="flex gap-[1vw]">
              <div className="flex-1">
                <div className="text-[0.8vw] uppercase tracking-wider text-muted mb-[1vh] font-semibold">مفتوحة</div>
                <div className="flex flex-col gap-[0.8vh]">
                  <div className="bg-bg border border-line p-[0.8vw] text-[0.85vw] text-text">عقد الإيجار</div>
                  <div className="bg-bg border border-line p-[0.8vw] text-[0.85vw] text-text">تأثيث المعرض</div>
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[0.8vw] uppercase tracking-wider text-muted mb-[1vh] font-semibold">قيد التنفيذ</div>
                <div className="flex flex-col gap-[0.8vh]">
                  <div className="bg-bg border-r-[3px] border-accent border border-line p-[0.8vw] text-[0.85vw] text-text">تركيب الأنظمة</div>
                  <div className="bg-bg border-r-[3px] border-accent border border-line p-[0.8vw] text-[0.85vw] text-text">توظيف الكاشير</div>
                  <div className="bg-bg border-r-[3px] border-accent border border-line p-[0.8vw] text-[0.85vw] text-text">حملة الافتتاح</div>
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[0.8vw] uppercase tracking-wider text-muted mb-[1vh] font-semibold">مكتملة</div>
                <div className="flex flex-col gap-[0.8vh]">
                  <div className="bg-bg border-r-[3px] border-sage border border-line p-[0.8vw] text-[0.85vw] text-muted line-through">دراسة الجدوى</div>
                  <div className="bg-bg border-r-[3px] border-sage border border-line p-[0.8vw] text-[0.85vw] text-muted line-through">رخصة البلدية</div>
                  <div className="bg-bg border-r-[3px] border-sage border border-line p-[0.8vw] text-[0.85vw] text-muted line-through">تصميم الهوية</div>
                </div>
              </div>
            </div>

            <div className="flex justify-between mt-[2vh] pt-[1.5vh] border-t border-line text-[0.9vw]">
              <span className="text-muted">الميزانية</span>
              <span className="font-semibold text-text" style={{ direction: "ltr" }}>SAR 142,500 / 200,000</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">23</div>
    </div>
  );
}
