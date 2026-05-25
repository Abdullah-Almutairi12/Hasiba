export default function LoyaltyZATCA() {
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
          الوحدة 11
        </div>
        <h2 className="font-display font-bold text-[3.6vw] leading-[1.1] tracking-tight text-text m-0 mb-[2.5vh]">
          برامج الولاء وعلامة ZATCA
        </h2>
        <p className="text-[1.4vw] text-muted max-w-[62vw] leading-[1.6] mb-[5.5vh]">
          نقاط ولاء داخل سلّة نقطة البيع تتحوّل إلى خصم فوري، مع توليد رمز QR متوافق مع منصّة فاتورة على كل عملية بيع.
        </p>

        <div className="flex gap-[3vw]">
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">01. نقاط ولاء</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.1vw] leading-[1.7] text-muted m-0">
              العميل يجمع نقاطًا تتحوّل تلقائيًا إلى خصم في السلّة عند إتمام عملية الشراء.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">02. رمز ZATCA</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.1vw] leading-[1.7] text-muted m-0">
              توليد رمز QR متوافق مع منصّة فاتورة على كل فاتورة بيع، مع تخزين البيانات الضريبية لاحقًا.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">03. تطابق الإجمالي</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.1vw] leading-[1.7] text-muted m-0">
              السعر الظاهر للعميل في الواجهة يطابق تمامًا ما يُسجَّل في قاعدة البيانات بعد كل الخصومات.
            </p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-text">12</div>
    </div>
  );
}
