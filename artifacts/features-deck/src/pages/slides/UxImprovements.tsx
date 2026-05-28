export default function UxImprovements() {
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
            تحسينات تجربة الاستخدام — مايو 2026
          </div>
          <h2 className="font-display font-bold text-[3.2vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            إعدادات أنظف، أزرار تعمل، واتجاه يتبع اللغة
          </h2>
          <p className="text-[1.25vw] text-muted leading-[1.6] mb-[3vh]">
            ثلاث تحسينات صغيرة لكنها تُلمَس كل يوم: تنظيم صفحة الإعدادات،
            ربط الأزرار التي كانت بلا وظيفة، وتثبيت الاتجاه البصري حسب لغة الواجهة.
          </p>

          <div className="flex flex-col gap-[1.8vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">شريط جانبي مُصنَّف للإعدادات</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">
                  ١٥ تبويبًا في أربع مجموعات (المنشأة، المالية والامتثال، العمليات، النظام) بدل صفّ أفقي متراكب.
                </div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">أزرار مُفعَّلة عبر الواجهة</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">
                  تعديل الفرع، تقارير الفرع، تصدير التقرير، جدولة التقارير، تصدير ZATCA، وتحليل التفاصيل — جميعها تنتقل لوجهتها الصحيحة.
                </div>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div>
                <div className="text-[1.15vw] font-semibold text-text">اتجاه يتبع اللغة تلقائيًا</div>
                <div className="text-[1.05vw] text-muted leading-[1.55]">
                  في العربية يظهر شريط التبويبات على اليمين، وفي الإنجليزية على اليسار — مع توافق ARIA لأسهم لوحة المفاتيح.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <div className="bg-cream p-[2vw]">
            <div className="flex items-center justify-between mb-[2vh]">
              <div>
                <div className="text-[0.85vw] uppercase tracking-[0.2em] text-muted mb-[0.5vh]">قبل / بعد</div>
                <div className="font-display text-[1.8vw] font-bold text-text leading-tight">صفحة الإعدادات</div>
              </div>
              <div className="bg-accent/15 text-accent px-[1vw] py-[0.6vh] text-[0.95vw] font-semibold">
                ١٥ تبويبًا
              </div>
            </div>

            <div className="grid grid-cols-2 gap-[1vw] mb-[2vh]">
              <div className="bg-bg border border-line p-[1vw]">
                <div className="text-[0.8vw] uppercase tracking-wider text-muted mb-[0.8vh]">قبل</div>
                <div className="flex flex-wrap gap-[0.4vh] mb-[0.6vh]">
                  {Array.from({ length: 15 }).map((_, i) => (
                    <div key={i} className="h-[1.2vh] w-[2.2vw] bg-text/15" />
                  ))}
                </div>
                <div className="text-[0.85vw] text-muted leading-[1.5]">صف أفقي يلتفّ على الشاشات الصغيرة ويتراكب.</div>
              </div>
              <div className="bg-bg border border-line p-[1vw]">
                <div className="text-[0.8vw] uppercase tracking-wider text-accent font-semibold mb-[0.8vh]">بعد</div>
                <div className="flex flex-col gap-[0.4vh] mb-[0.6vh]">
                  <div className="h-[1vh] w-[60%] bg-text/30" />
                  <div className="h-[1vh] w-[50%] bg-text/15" />
                  <div className="h-[1vh] w-[55%] bg-text/15" />
                  <div className="h-[1vh] w-[40%] bg-text/30" />
                  <div className="h-[1vh] w-[50%] bg-text/15" />
                </div>
                <div className="text-[0.85vw] text-muted leading-[1.5]">شريط جانبي عمودي مُصنَّف، يتحوّل لشريط أفقي ثابت على الجوال.</div>
              </div>
            </div>

            <div className="bg-sage/15 border-r-[3px] border-sage p-[1.2vw] mb-[1.5vh]">
              <div className="text-[0.85vw] uppercase tracking-wider text-sage font-semibold mb-[0.5vh]">ربط الأزرار</div>
              <div className="text-[1.05vw] text-text leading-[1.5]">٦ أزرار رئيسية مُفعَّلة عبر صفحات الفروع ولوحة القيادة والتقارير.</div>
            </div>

            <div className="bg-amber-50 border-r-[3px] border-amber-400 p-[1.2vw]">
              <div className="text-[0.85vw] uppercase tracking-wider text-amber-700 font-semibold mb-[0.5vh]">إتاحة الوصول</div>
              <div className="text-[1.05vw] text-text leading-[1.5]">إصلاح تداخل عناصر النقر (Link + Button) ليتوافق مع معايير HTML.</div>
            </div>
          </div>

          <div className="mt-[1.5vh] text-[0.9vw] text-muted text-center">
            ملفات: <span className="font-mono" style={{ direction: "ltr" }}>settings.tsx · branches.tsx · dashboard.tsx · reports.tsx</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">29</div>
    </div>
  );
}
