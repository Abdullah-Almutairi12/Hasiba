import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function Customers() {
  return (
    <SlideFrame page="09" kicker="الوحدة 06 — المنصّة الأساسية" title="العملاء والذمم" lead="ملف عميل يجمع بيانات الاتصال والطلبات والفواتير والذمم والولاء، مع فصل واضح بين ما فُوتر وما حُصّل.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="ملف موحَّد">
            بيانات اتصال وأرصدة وملاحظات داخلية لكل عميل.
          </Point>
          <Point n="02" title="فواتير وذمم">
            الفواتير المفتوحة وأعمارها تظهر في ملف العميل وتقارير الذمم.
          </Point>
          <Point n="03" title="ولاء مرتبط بالبيع">
            نقاط تُكتسب وتُستبدل داخل نقطة البيع بسجل كامل.
          </Point>
        </div>
        <div>
          <Panel label="العميل في رحلة القبول · أمر SO-2026-00001">
            <Row k="عدد الفواتير" v="2" />
            <Row k="الفاتورة الأولى" v="114.67" />
            <Row k="الفاتورة الثانية" v="229.33" />
            <Row k="الذمم المدينة" v="344.00" strong />
            <Row k="المحصّل" v="0.00" />
            <Note>الذمم 344 لأن الفاتورتين غير مدفوعتين؛ هذا ليس تحصيلًا. لا إرسال بريد ولا دفع خارجي.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
