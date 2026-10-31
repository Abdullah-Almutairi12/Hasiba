import { SlideFrame } from "../../components/deck";

export default function AIModels() {
  return (
    <SlideFrame page="13" kicker="الوحدة 09 — الذكاء الاصطناعي" title="النماذج التحليلية المسجّلة" lead="خمسة نماذج مسجّلة في النظام ومتاحة عبر واجهات /api/ai. مخرجاتها إرشادية، ولا نعلن عنها كفاءة أو دقة مضمونة.">
      <div className="h-full flex flex-col">
        <div className="grid grid-cols-[4vw_1fr_1.2fr_1fr] gap-[1.5vw] text-[1.5vw] font-semibold text-muted border-b-2 border-primary pb-[1vh]">
          <span>#</span>
          <span>النموذج</span>
          <span>الأسلوب</span>
          <span>طبيعة المخرج</span>
        </div>
        <div className="grid grid-cols-[4vw_1fr_1.2fr_1fr] gap-[1.5vw] text-[1.6vw] border-b border-line py-[1.1vh]">
          <span dir="ltr" className="text-accent font-semibold text-right">01</span>
          <span className="font-semibold">توقعات المبيعات</span>
          <span className="text-muted">انحدار خطي مع تنعيم EWMA</span>
          <span className="text-muted">تقدير للاسترشاد</span>
        </div>
        <div className="grid grid-cols-[4vw_1fr_1.2fr_1fr] gap-[1.5vw] text-[1.6vw] border-b border-line py-[1.1vh]">
          <span dir="ltr" className="text-accent font-semibold text-right">02</span>
          <span className="font-semibold">عملاء معرّضون للانقطاع</span>
          <span className="text-muted">تحليل RFM</span>
          <span className="text-muted">قائمة للمتابعة</span>
        </div>
        <div className="grid grid-cols-[4vw_1fr_1.2fr_1fr] gap-[1.5vw] text-[1.6vw] border-b border-line py-[1.1vh]">
          <span dir="ltr" className="text-accent font-semibold text-right">03</span>
          <span className="font-semibold">إشارات الشذوذ</span>
          <span className="text-muted">z-score متعدد الأبعاد</span>
          <span className="text-muted">إشارة للمراجعة</span>
        </div>
        <div className="grid grid-cols-[4vw_1fr_1.2fr_1fr] gap-[1.5vw] text-[1.6vw] border-b border-line py-[1.1vh]">
          <span dir="ltr" className="text-accent font-semibold text-right">04</span>
          <span className="font-semibold">توصيات المنتجات</span>
          <span className="text-muted">تحليل سلال الشراء</span>
          <span className="text-muted">اقتراح بيعي</span>
        </div>
        <div className="grid grid-cols-[4vw_1fr_1.2fr_1fr] gap-[1.5vw] text-[1.6vw] border-b border-line py-[1.1vh]">
          <span dir="ltr" className="text-accent font-semibold text-right">05</span>
          <span className="font-semibold">المساعد الذكي</span>
          <span className="text-muted">مزوّد لغوي خارجي مع سياق الشركة</span>
          <span className="text-muted">إجابة تُراجع</span>
        </div>
        <p className="text-[1.5vw] text-muted leading-[1.5] mt-[1.6vh] mb-0">
          لم تُقَس هذه النماذج على بيانات شريك، ولم تدخل ضمن رحلة القبول الموثّقة لهذا الاجتماع.
        </p>
      </div>
    </SlideFrame>
  );
}
