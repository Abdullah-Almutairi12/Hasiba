import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function LoyaltyZATCA() {
  return (
    <SlideFrame page="17" kicker="الوحدة 12 — الامتثال والأمان" title="برامج الولاء وبيانات الفاتورة الضريبية" lead="نقاط ولاء تتحول إلى خصم داخل سلّة الكاشير. عناصر الفاتورة الضريبية الإلكترونية ما زالت قيد الإكمال.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="نقاط تتحول إلى خصم">
            تطبيق فوري في السلّة، والسعر المعروض يطابق المحفوظ.
          </Point>
          <Point n="02" title="سجل نقاط كامل">
            كل نقطة مكتسبة أو مستبدلة لها أثر قابل للمراجعة.
          </Point>
          <Point n="03" title="بيانات الضريبة على الفاتورة">
            الرقم الضريبي والإجمالي والضريبة تُحفظ من الهوية السارية وقت الإصدار.
          </Point>
        </div>
        <div>
          <Panel label="الفوترة الإلكترونية · الحالة الحالية" dark={false}>
            <Row k="سياسة الضريبة" v="TAX_POLICY_NOT_READY" strong />
            <Row k="QR وXML والتوقيع" v="غير مكتمل" />
            <Row k="الربط والإبلاغ مع الهيئة" v="غير مقبول" />
            <Row k="اعتماد إنتاجي من ZATCA" v="لا ندّعي" />
            <Note>لا نعرض النظام كمعتمد أو متكامل مع منصة فاتورة حتى يُستكمل القبول الإنتاجي.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
