export default function Accounting() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col justify-start"
      style={{ padding: "8vh 8vw", paddingTop: "18vh" }}
    >
      <div className="absolute top-[8vh] left-[8vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[84vw]">
        <div className="text-[1vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[2vh]">
          الوحدة 05
        </div>
        <h2 className="font-display font-bold text-[4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2.5vh]">
          المحاسبة والامتثال
        </h2>
        <p className="text-[1.5vw] text-muted max-w-[60vw] leading-[1.6] mb-[6vh]">
          محاسبة كاملة قائمة على القيد المزدوج، جاهزة لمتطلبات هيئة الزكاة والضريبة (ZATCA) من اليوم الأول.
        </p>

        <div className="flex gap-[3vw]">
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">01. قيود مزدوجة</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.15vw] leading-[1.7] text-muted m-0">
              دفتر يومية كامل بمدين ودائن لكل عملية تشغيلية: مبيعات، مشتريات، مصاريف، ومخزون.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">02. التدفق النقدي</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.15vw] leading-[1.7] text-muted m-0">
              رؤية لحظية للسيولة الداخلة والخارجة، وحالة الأرصدة عبر كل البنوك والصناديق.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">03. تكامل ZATCA</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.15vw] leading-[1.7] text-muted m-0">
              حالة الاتصال بمنصّة فاتورة جاهزة من اليوم الأول، مع توليد رمز QR متوافق على كل فاتورة.
            </p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-text">06</div>
    </div>
  );
}
