export default function VatAutoHide() {
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
          الوحدة 16 — الامتثال والأمان
        </div>
        <h2 className="font-display font-bold text-[3.2vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          إخفاء تلقائي لحقول الضريبة
        </h2>
        <p className="text-[1.2vw] text-muted max-w-[64vw] leading-[1.6] mb-[4vh]">
          إن كانت منشأتك صغيرة وغير مسجَّلة في ضريبة القيمة المضافة، يُخفي النظام تلقائيًا حقول الضريبة من الكاشير والفواتير — ثم يعيدها لحظة بلوغك سقف 375,000 ر.س.
        </p>

        <div className="flex gap-[2.5vw]">
          <div className="flex-1 bg-cream p-[2vw] flex flex-col">
            <div className="flex items-center justify-between mb-[2vh]">
              <div className="text-[0.85vw] uppercase tracking-[0.2em] text-muted font-semibold">قبل — غير مسجَّل</div>
              <div className="bg-sage/20 text-sage px-[0.8vw] py-[0.4vh] text-[0.85vw] font-semibold">VAT مخفي</div>
            </div>
            <div className="text-[1.4vw] font-bold text-text mb-[2vh]">فاتورة الكاشير</div>

            <div className="bg-bg border border-line p-[1.2vw] flex flex-col gap-[1vh]">
              <div className="flex justify-between text-[1vw]">
                <span className="text-muted">قهوة سادة × 2</span>
                <span className="font-mono text-text" style={{ direction: "ltr" }}>24.00</span>
              </div>
              <div className="flex justify-between text-[1vw]">
                <span className="text-muted">كرواسون</span>
                <span className="font-mono text-text" style={{ direction: "ltr" }}>12.00</span>
              </div>
              <div className="border-t border-line pt-[1vh] mt-[0.5vh] flex justify-between text-[1.15vw] font-semibold">
                <span className="text-text">الإجمالي</span>
                <span className="font-mono text-primary" style={{ direction: "ltr" }}>SAR 36.00</span>
              </div>
            </div>

            <div className="mt-[2vh] flex flex-col gap-[0.8vh] text-[0.95vw] text-muted">
              <div>· لا سطر للضريبة في الفاتورة.</div>
              <div>· لا حقل رقم ضريبي على العملاء.</div>
              <div>· رسالة بسيطة ومناسبة للمنشأة الصغيرة.</div>
            </div>
          </div>

          <div className="flex-1 bg-primary text-cream p-[2vw] flex flex-col">
            <div className="flex items-center justify-between mb-[2vh]">
              <div className="text-[0.85vw] uppercase tracking-[0.2em] text-accent font-semibold">بعد — مسجَّل تلقائيًا</div>
              <div className="bg-accent text-cream px-[0.8vw] py-[0.4vh] text-[0.85vw] font-semibold">VAT 15%</div>
            </div>
            <div className="text-[1.4vw] font-bold mb-[2vh]">فاتورة الكاشير</div>

            <div className="bg-cream/10 p-[1.2vw] flex flex-col gap-[1vh]">
              <div className="flex justify-between text-[1vw]">
                <span className="text-cream/70">قهوة سادة × 2</span>
                <span className="font-mono" style={{ direction: "ltr" }}>24.00</span>
              </div>
              <div className="flex justify-between text-[1vw]">
                <span className="text-cream/70">كرواسون</span>
                <span className="font-mono" style={{ direction: "ltr" }}>12.00</span>
              </div>
              <div className="flex justify-between text-[0.95vw]">
                <span className="text-cream/70">المجموع قبل الضريبة</span>
                <span className="font-mono text-cream/85" style={{ direction: "ltr" }}>36.00</span>
              </div>
              <div className="flex justify-between text-[0.95vw]">
                <span className="text-accent">ضريبة القيمة المضافة 15%</span>
                <span className="font-mono text-accent" style={{ direction: "ltr" }}>5.40</span>
              </div>
              <div className="border-t border-cream/20 pt-[1vh] mt-[0.5vh] flex justify-between text-[1.15vw] font-semibold">
                <span>الإجمالي</span>
                <span className="font-mono text-accent" style={{ direction: "ltr" }}>SAR 41.40</span>
              </div>
            </div>

            <div className="mt-[2vh] flex flex-col gap-[0.8vh] text-[0.95vw] text-cream/85">
              <div>· يُعاد إظهار حقول الضريبة فور تجاوز 375,000 ر.س.</div>
              <div>· رقم ضريبي للعملاء + رمز QR ZATCA على كل فاتورة.</div>
              <div>· انتقال شفّاف بدون تعطيل العمليات اليومية.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">21</div>
    </div>
  );
}
