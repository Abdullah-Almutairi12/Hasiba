import { SlideFrame } from "../../components/deck";

export default function UxImprovements() {
  return (
    <SlideFrame page="29" kicker="حالة التنفيذ — 31 أكتوبر 2026" title="ما ثبت، وما هو قائم، وما بقي" lead="قبول موثّق لشريحة محددة، وليس شهادة جاهزية تجارية لكل ERP أو قبولًا ضريبيًا إنتاجيًا.">
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-3 gap-[2.2vw] flex-1 min-h-0">
          <div className="bg-primary text-cream p-[1.5vw]">
            <div className="text-[1.8vw] font-semibold mb-[1.2vh]">مثبت ببيانات مصطنعة</div>
            <p className="text-[1.6vw] leading-[1.5] text-cream/85 m-0">أمر البيع من المسودة 344 حتى فاتورتي 114.67 و229.33، واسترجاع الرد المفقود دون تكرار، ومصالحة المخزون والقيود.</p>
            <p className="text-[1.6vw] leading-[1.5] text-cream/85 mt-[1.2vh] mb-0">الهوية الضريبية الحالية والمستقبلية، ووراثة الفرعين، وحجب الكاتب القديم.</p>
          </div>
          <div className="bg-warm p-[1.5vw]">
            <div className="text-[1.8vw] font-semibold text-text mb-[1.2vh]">قائم دون قبول شامل</div>
            <p className="text-[1.6vw] leading-[1.5] text-muted m-0">نقطة البيع، المشاريع، التسويق، أدوات الذكاء الاصطناعي، المعاملات بين الشركات، الزكاة، ولوحة المدير.</p>
            <p className="text-[1.6vw] leading-[1.5] text-muted mt-[1.2vh] mb-0">موجودة ومغطاة جزئيًا باختبارات، دون ادعاء قبول كل وحدة.</p>
          </div>
          <div className="bg-cream border-2 border-accent p-[1.5vw]">
            <div className="text-[1.8vw] font-semibold text-accent mb-[1.2vh]">معلّق</div>
            <p className="text-[1.6vw] leading-[1.5] text-text m-0">أجهزة حية وطباعة ورقية، دفع خارجي، بريد، ودخول Google وApple.</p>
            <p className="text-[1.6vw] leading-[1.5] text-text mt-[1.2vh] mb-0">القبول الضريبي: TAX_POLICY_NOT_READY، وQR وXML والتوقيع والإبلاغ والاعتماد الإنتاجي.</p>
          </div>
        </div>
        <p className="text-[1.5vw] leading-[1.45] text-muted mt-[1.6vh] mb-0">
          جاهزية: تشغيل 11:37–11:56 بتوقيت الرياض · 15/15 بوابة · API 1123 ناجحًا و0 فاشل · الواجهة 349 ناجحًا · 5 اختبارات أرشفة ضمن الإجمالي. لا نشر للإنتاج، والدمج الجديد معلّق.
        </p>
      </div>
    </SlideFrame>
  );
}
