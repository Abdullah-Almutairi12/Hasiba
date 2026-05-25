export default function InvoiceAI() {
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
          الوحدة 04 — ذكاء اصطناعي
        </div>
        <h2 className="font-display font-bold text-[3.8vw] leading-[1.1] tracking-tight text-text m-0 mb-[2.5vh]">
          فواتير الموردين بالذكاء الاصطناعي
        </h2>
        <p className="text-[1.4vw] text-muted max-w-[62vw] leading-[1.6] mb-[5vh]">
          وكيل مسح الفواتير: صوّر الفاتورة بكاميرا الجهاز أو ارفع صورتها، ودَع الذكاء الاصطناعي يتولى الباقي — من القراءة إلى القيد المحاسبي.
        </p>

        <div className="flex gap-[2.5vw]">
          <div className="flex-1 bg-cream p-[2vw]">
            <div className="text-[1.3vw] font-semibold text-text mb-[1.5vh]">01. استخراج بصري</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.05vw] leading-[1.7] text-muted m-0">
              OpenAI Vision (gpt-5-mini) يقرأ اسم المورّد، رقم الفاتورة، التواريخ، البنود، الضريبة، والإجمالي.
            </p>
          </div>
          <div className="flex-1 bg-cream p-[2vw]">
            <div className="text-[1.3vw] font-semibold text-text mb-[1.5vh]">02. مطابقة ذكية</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.05vw] leading-[1.7] text-muted m-0">
              كل بند يُربط بمنتج موجود، أو يُنشأ تلقائيًا ضمن فئة «غير مصنّف» مع تحديث رصيد المخزون.
            </p>
          </div>
          <div className="flex-1 bg-cream p-[2vw]">
            <div className="text-[1.3vw] font-semibold text-text mb-[1.5vh]">03. قيد محاسبي فوري</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.05vw] leading-[1.7] text-muted m-0">
              مدين مخزون + مدين ضريبة مدخلات / دائن موردين، داخل معاملة قاعدة بيانات واحدة آمنة.
            </p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-text">05</div>
    </div>
  );
}
