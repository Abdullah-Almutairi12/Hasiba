import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function POS() {
  return (
    <SlideFrame page="05" kicker="الوحدة 02 — المنصّة الأساسية" title="نقطة البيع (POS)" lead="جلسات كاشير مرتبطة بالمخزون والمحاسبة. الشاشة والبيانات قائمة؛ الأجهزة الطرفية لم تُقبل في تشغيل حي بعد.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="جلسة وردية">
            فتح الجلسة برصيد افتتاحي وإغلاقها بتسوية ختامية للكاشير والفرع.
          </Point>
          <Point n="02" title="سلّة وخصومات">
            إضافة الأصناف بالبحث أو الباركود، وخصومات يدوية ونقاط ولاء.
          </Point>
          <Point n="03" title="أثر محاسبي ومخزني">
            تُنشأ الحركة المخزنية والقيد من البيع نفسه داخل النظام.
          </Point>
        </div>
        <div>
          <Panel label="ما لم يُقبل بعد في تشغيل حي" dark={false}>
            <Row k="طابعات الإيصالات والطباعة الورقية" v="معلّق" />
            <Row k="قارئات الباركود وأجهزة الكاشير" v="معلّق" />
            <Row k="أجهزة الدفع والمدفوعات الخارجية" v="معلّق" />
            <Row k="رمز الفاتورة الضريبية الإنتاجي" v="معلّق" />
            <Note>هذه البنود تحتاج اختبارًا على أجهزة الشريك قبل أي التزام تشغيلي.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
