export default function Intercompany() {
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
            الوحدة 13 — الامتثال والأمان
          </div>
          <h2 className="font-display font-bold text-[3.2vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            المعاملات بين الشركات
          </h2>
          <p className="text-[1.2vw] text-muted leading-[1.6] mb-[3vh]">
            عند إصدار فاتورة لعميل مرتبط بشركة شقيقة، تُنشأ الفاتورة المعكوسة تلقائيًا في الشركة المستهدفة داخل المعاملة نفسها.
          </p>
          <div className="flex flex-col gap-[1.5vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">انعكاس تلقائي</span> داخل نفس معاملة قاعدة البيانات.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">ربط مُتقن</span> عبر جدول <span className="font-mono text-[0.95vw]">intercompany_links</span> مع unique constraint.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">حماية من الحلقات</span> اللانهائية بعلامة <span className="font-mono text-[0.95vw]">isIntercompany</span>.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">Void / Resync</span> جاهزة عبر <span className="font-mono text-[0.95vw]" style={{ direction: "ltr" }}>POST /intercompany/links/:id/void</span>.</div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <div className="bg-cream p-[2vw]">
            <div className="text-[0.85vw] uppercase tracking-[0.2em] text-muted mb-[2vh]">سير العمل</div>

            <div className="flex items-stretch gap-[1vw] mb-[1.5vh]">
              <div className="flex-1 bg-primary text-cream p-[1.2vw]">
                <div className="text-[0.8vw] uppercase tracking-wider text-cream/60 mb-[0.5vh]">الشركة A</div>
                <div className="text-[1.1vw] font-semibold">فاتورة بيع</div>
                <div className="text-[0.9vw] text-cream/70 mt-[0.5vh]">إلى عميل مرتبط</div>
              </div>
              <div className="flex items-center text-accent text-[1.3vw]">←</div>
              <div className="flex-1 bg-accent text-cream p-[1.2vw]">
                <div className="text-[0.8vw] uppercase tracking-wider text-cream/80 mb-[0.5vh]">Mirror Engine</div>
                <div className="text-[1.1vw] font-semibold">مزامنة فورية</div>
                <div className="text-[0.9vw] text-cream/90 mt-[0.5vh]">داخل نفس المعاملة</div>
              </div>
              <div className="flex items-center text-accent text-[1.3vw]">←</div>
              <div className="flex-1 bg-primary text-cream p-[1.2vw]">
                <div className="text-[0.8vw] uppercase tracking-wider text-cream/60 mb-[0.5vh]">الشركة B</div>
                <div className="text-[1.1vw] font-semibold">فاتورة شراء</div>
                <div className="text-[0.9vw] text-cream/70 mt-[0.5vh]">معكوسة تلقائيًا</div>
              </div>
            </div>

            <div className="border-t border-line pt-[1.5vh] mt-[1.5vh]">
              <div className="text-[0.85vw] uppercase tracking-wider text-muted mb-[1vh]">حالات الربط</div>
              <div className="flex gap-[1vw]">
                <div className="flex-1 bg-bg border border-line px-[1vw] py-[0.8vh] text-center">
                  <div className="text-[0.85vw] text-muted">matched</div>
                </div>
                <div className="flex-1 bg-bg border border-line px-[1vw] py-[0.8vh] text-center">
                  <div className="text-[0.85vw] text-muted">void</div>
                </div>
                <div className="flex-1 bg-bg border border-line px-[1vw] py-[0.8vh] text-center">
                  <div className="text-[0.85vw] text-muted">resynced</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">18</div>
    </div>
  );
}
