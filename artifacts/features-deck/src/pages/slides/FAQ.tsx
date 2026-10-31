import { SlideFrame } from "../../components/deck";

export default function FAQ() {
  return (
    <SlideFrame page="31" kicker="الأسئلة الشائعة" title="أسئلة الشركاء بإجابات دقيقة">
      <div className="grid grid-cols-2 gap-x-[3.5vw] gap-y-[2.4vh]">
        <div>
          <div className="flex gap-[0.8vw] items-baseline mb-[0.6vh]">
            <span dir="ltr" className="text-[1.5vw] font-semibold text-accent">01</span>
            <span className="text-[1.7vw] font-semibold text-text">هل النظام معتمد من ZATCA؟</span>
          </div>
          <p className="text-[1.5vw] leading-[1.45] text-muted m-0">لا. لا ندّعي اعتمادًا أو ربطًا إنتاجيًا مع منصة فاتورة؛ TAX_POLICY_NOT_READY قائم.</p>
        </div>
        <div>
          <div className="flex gap-[0.8vw] items-baseline mb-[0.6vh]">
            <span dir="ltr" className="text-[1.5vw] font-semibold text-accent">02</span>
            <span className="text-[1.7vw] font-semibold text-text">هل يسجّل المنشأة في الضريبة تلقائيًا؟</span>
          </div>
          <p className="text-[1.5vw] leading-[1.45] text-muted m-0">لا. يتابع الحد للتنبيه فقط، والتسجيل قرار المنشأة لدى الهيئة.</p>
        </div>
        <div>
          <div className="flex gap-[0.8vw] items-baseline mb-[0.6vh]">
            <span dir="ltr" className="text-[1.5vw] font-semibold text-accent">03</span>
            <span className="text-[1.7vw] font-semibold text-text">هل تدعمون الفروع والشركات المرتبطة؟</span>
          </div>
          <p className="text-[1.5vw] leading-[1.45] text-muted m-0">نعم. عزل بيانات لكل شركة، وفروع ترث الهوية، ومعاملات بين الشركات.</p>
        </div>
        <div>
          <div className="flex gap-[0.8vw] items-baseline mb-[0.6vh]">
            <span dir="ltr" className="text-[1.5vw] font-semibold text-accent">04</span>
            <span className="text-[1.7vw] font-semibold text-text">هل الذكاء الاصطناعي يسجّل وحده؟</span>
          </div>
          <p className="text-[1.5vw] leading-[1.45] text-muted m-0">لا. يقترح بيانات فاتورة المورد، والتسجيل بعد مراجعة المستخدم.</p>
        </div>
        <div>
          <div className="flex gap-[0.8vw] items-baseline mb-[0.6vh]">
            <span dir="ltr" className="text-[1.5vw] font-semibold text-accent">05</span>
            <span className="text-[1.7vw] font-semibold text-text">من يرى بياناتي؟</span>
          </div>
          <p className="text-[1.5vw] leading-[1.45] text-muted m-0">أدوار مقيّدة بالشركة والفروع، ولا منح ضمني للرواتب أو الصرف.</p>
        </div>
        <div>
          <div className="flex gap-[0.8vw] items-baseline mb-[0.6vh]">
            <span dir="ltr" className="text-[1.5vw] font-semibold text-accent">06</span>
            <span className="text-[1.7vw] font-semibold text-text">هل يمكن تجربته اليوم؟</span>
          </div>
          <p className="text-[1.5vw] leading-[1.45] text-muted m-0">نعم، على بيئة عرض ببيانات مصطنعة. الدفع والبريد والأجهزة لم تُقبل بعد.</p>
        </div>
      </div>
    </SlideFrame>
  );
}
