import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function SmartReports() {
  return (
    <SlideFrame page="12" kicker="الوحدة 08 — الذكاء الاصطناعي" title="التقارير الذكية وإشارات الشذوذ" lead="مساعد يجيب بالعربية عن بيانات المنشأة، وتوقعات، وإشارات للمعاملات الخارجة عن النمط المعتاد للمراجعة.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="مساعد بالعربية">
            أسئلة بلغة طبيعية تُجاب من بيانات الشركة المسموح بها للمستخدم.
          </Point>
          <Point n="02" title="توقعات وقيمة العميل">
            تقديرات إحصائية للمبيعات القادمة وقيمة العميل، للاسترشاد.
          </Point>
          <Point n="03" title="إشارات شذوذ">
            تُبرز معاملات تبتعد عن النمط إحصائيًا؛ الإشارة ليست حكمًا بالاحتيال.
          </Point>
        </div>
        <div>
          <Panel label="كيف تُعامَل الإشارة">
            <Row k="1. رصد إحصائي" v="z-score متعدد الأبعاد" />
            <Row k="2. عرض على المراجع" v="بسياق المعاملة" />
            <Row k="3. قرار بشري" v="إغلاق أو تحقيق" />
            <Note>لا نعرض نسب كشف أو خسائر متجنَّبة؛ لم تُقَس على بيانات تشغيل حقيقية.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
