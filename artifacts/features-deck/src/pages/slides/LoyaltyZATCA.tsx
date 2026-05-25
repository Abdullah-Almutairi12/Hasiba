export default function LoyaltyZATCA() {
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
          الوحدة 12 — الامتثال والأمان
        </div>
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          برامج الولاء وعلامة ZATCA
        </h2>
        <p className="text-[1.2vw] text-muted max-w-[62vw] leading-[1.6] mb-[4vh]">
          نقاط ولاء داخل سلّة نقطة البيع تتحوّل إلى خصم فوري، مع توليد رمز QR متوافق مع منصّة فاتورة على كل عملية بيع.
        </p>

        <div className="flex gap-[2.5vw]">
          <div className="flex-1 bg-cream p-[2.2vw] flex flex-col">
            <div className="text-[0.85vw] uppercase tracking-[0.2em] text-accent font-semibold mb-[1.5vh]">برنامج الولاء</div>
            <div className="text-[1.5vw] font-bold text-text mb-[2vh]">نقاط → خصم فوري</div>

            <div className="flex items-center gap-[1.5vw] mb-[2.5vh]">
              <div className="bg-primary text-cream px-[1.5vw] py-[1.2vh] text-center">
                <div className="text-[0.75vw] uppercase tracking-wider text-cream/60">يكسب</div>
                <div className="font-display text-[1.6vw] font-bold">120 نقطة</div>
              </div>
              <div className="text-accent text-[1.5vw]">←</div>
              <div className="bg-accent text-cream px-[1.5vw] py-[1.2vh] text-center">
                <div className="text-[0.75vw] uppercase tracking-wider text-cream/80">خصم تلقائي</div>
                <div className="font-display text-[1.6vw] font-bold" style={{ direction: "ltr" }}>SAR 24</div>
              </div>
            </div>

            <div className="flex flex-col gap-[1vh] text-[1vw] text-muted">
              <div>· تطبيق فوري في سلّة الكاشير.</div>
              <div>· سعر الواجهة يطابق ما يُحفظ في قاعدة البيانات.</div>
              <div>· سجل كامل للنقاط المكتسبة والمصروفة.</div>
            </div>
          </div>

          <div className="flex-1 bg-primary text-cream p-[2.2vw] flex flex-col">
            <div className="text-[0.85vw] uppercase tracking-[0.2em] text-accent font-semibold mb-[1.5vh]">امتثال ZATCA</div>
            <div className="text-[1.5vw] font-bold mb-[2vh]">رمز QR على كل فاتورة</div>

            <div className="flex items-center gap-[2vw] mb-[2vh]">
              <div className="w-[6vw] h-[6vw] bg-cream relative">
                <div className="absolute inset-[8%] grid grid-cols-6 grid-rows-6 gap-[2%]">
                  <div className="bg-primary" /><div className="bg-primary" /><div /><div className="bg-primary" /><div /><div className="bg-primary" />
                  <div className="bg-primary" /><div /><div className="bg-primary" /><div /><div className="bg-primary" /><div className="bg-primary" />
                  <div /><div className="bg-primary" /><div className="bg-primary" /><div className="bg-primary" /><div /><div className="bg-primary" />
                  <div className="bg-primary" /><div /><div className="bg-primary" /><div /><div className="bg-primary" /><div />
                  <div /><div className="bg-primary" /><div /><div className="bg-primary" /><div className="bg-primary" /><div className="bg-primary" />
                  <div className="bg-primary" /><div /><div className="bg-primary" /><div className="bg-primary" /><div /><div className="bg-primary" />
                </div>
              </div>
              <div className="flex flex-col gap-[0.8vh] text-[1vw] text-cream/85">
                <div>· رمز TLV مشفَّر Base64.</div>
                <div>· يحوي: المورد، الرقم الضريبي، التاريخ، الإجمالي، الضريبة.</div>
                <div>· مدعوم على الفواتير الجديدة والقائمة.</div>
              </div>
            </div>

            <div className="bg-cream/10 px-[1.5vw] py-[1vh] text-[0.95vw] font-mono text-cream" style={{ direction: "ltr" }}>
              ZATCA Phase 1 · QR-ready
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">17</div>
    </div>
  );
}
