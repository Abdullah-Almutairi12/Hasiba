import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function Inventory() {
  return (
    <SlideFrame page="06" kicker="الوحدة 03 — المنصّة الأساسية" title="المنتجات والمخزون" lead="منتجات وفئات ومستودعات وفروع، مع حركة مخزنية موثّقة وتكلفة بطبقات FIFO مرتبطة بالأستاذ العام.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="منتجات وفئات">
            فئات هرمية وباركود وأسعار متعددة لكل منتج.
          </Point>
          <Point n="02" title="حركة موثّقة">
            كل إدخال وصرف مسجّل بمصدره، ولا يُكرَّر صرف التسليم عند إعادة المحاولة.
          </Point>
          <Point n="03" title="تنبيهات الحد الأدنى">
            تنبيه عند انخفاض الصنف عن الحد المحدد لكل منتج وفرع.
          </Point>
        </div>
        <div>
          <Panel label="مصالحة مستقلة · قاعدة بيانات اختبار مصطنعة">
            <Row k="المتبقي بعد تسليم 3 وحدات" v="17 وحدة" />
            <Row k="تكلفة الوحدة FIFO" v="50.00" />
            <Row k="قيمة الطبقات" v="850.00" />
            <Row k="رصيد المخزون في الأستاذ" v="850.00" strong />
            <Row k="تكلفة المبيعات" v="150.00" />
            <Note>حركتان فقط: افتتاحية وتسليم واحد. تطابق الطبقات والأستاذ دون فروق.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
