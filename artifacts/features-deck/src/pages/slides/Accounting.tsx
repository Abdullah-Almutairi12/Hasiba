export default function Accounting() {
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
          الوحدة 04 — المنصّة الأساسية
        </div>
        <h2 className="font-display font-bold text-[3.6vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          المحاسبة والامتثال
        </h2>
        <p className="text-[1.3vw] text-muted max-w-[62vw] leading-[1.6] mb-[5vh]">
          محاسبة قائمة على القيد المزدوج، جاهزة لمتطلبات هيئة الزكاة والضريبة (ZATCA) من اليوم الأول.
        </p>

        <div className="flex gap-[2.5vw] mb-[4vh]">
          <div className="flex-1">
            <div className="text-[1.3vw] font-semibold text-text mb-[1.5vh]">01. قيود مزدوجة</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.05vw] leading-[1.7] text-muted m-0">
              دفتر يومية كامل لكل عملية: مبيعات، مشتريات، مصاريف، ومخزون — مع جدول <span className="font-semibold text-text">journal_entries</span> مفهرس بالكامل.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.3vw] font-semibold text-text mb-[1.5vh]">02. التدفق النقدي</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.05vw] leading-[1.7] text-muted m-0">
              رؤية لحظية للسيولة الداخلة والخارجة وحالة الأرصدة عبر كل البنوك والصناديق.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.3vw] font-semibold text-text mb-[1.5vh]">03. تكامل ZATCA</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.05vw] leading-[1.7] text-muted m-0">
              توليد رمز QR متوافق مع منصّة فاتورة على كل عملية بيع وعلى الفواتير القائمة.
            </p>
          </div>
        </div>

        <div className="bg-primary p-[2vw]" style={{ direction: "ltr" }}>
          <div className="text-[0.8vw] uppercase tracking-[0.15em] text-cream/60 mb-[1.5vh]">مثال قيد يومية</div>
          <div className="font-mono text-[1.05vw] text-cream leading-[1.8]">
            <span className="text-sage">Dr</span> 1101 المخزون &nbsp;&nbsp; <span className="text-accent">100.00</span> &nbsp;&nbsp;&nbsp; <span className="text-cream/40">/</span>
            &nbsp;&nbsp; <span className="text-sage">Dr</span> 1402 ضريبة المدخلات &nbsp;&nbsp; <span className="text-accent">15.00</span>
            &nbsp;&nbsp;&nbsp; <span className="text-cream/40">/</span> &nbsp;&nbsp; <span className="text-sage">Cr</span> 2102 الموردين &nbsp;&nbsp; <span className="text-accent">115.00</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">07</div>
    </div>
  );
}
