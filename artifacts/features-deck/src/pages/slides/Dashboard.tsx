import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function Dashboard() {
  return (
    <SlideFrame page="04" kicker="الوحدة 01 — المنصّة الأساسية" title="لوحة القيادة التنفيذية" lead="مؤشرات المبيعات والمخزون والسيولة والفروع من بيانات النظام نفسه، في شاشة واحدة لصاحب القرار.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="مؤشرات من بيانات فعلية">
            تُحسب من المستندات المحفوظة، لا من أرقام ثابتة في الواجهة.
          </Point>
          <Point n="02" title="مقارنة الفروع">
            عرض أداء كل فرع ضمن الشركات والفروع المسموح للمستخدم برؤيتها.
          </Point>
          <Point n="03" title="رؤى مساعدة">
            ملاحظات تحليلية إرشادية تُراجع قبل أي قرار، دون نسب دقة مضمونة.
          </Point>
        </div>
        <div>
          <Panel label="مثال موثّق · ملخص المبيعات أثناء رحلة القبول">
            <Row k="قبل إصدار أي فاتورة" v="0.00" />
            <Row k="بعد فاتورة الوحدة الأولى" v="114.67" />
            <Row k="بعد فاتورة الباقي" v="344.00" strong />
            <Note>تحدّث الملخص دون إعادة تحميل الصفحة. الرقم مبيعات مفوترة وذمم، وليس تحصيلًا نقديًا.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
