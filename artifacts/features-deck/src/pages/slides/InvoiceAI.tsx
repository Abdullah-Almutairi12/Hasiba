import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function InvoiceAI() {
  return (
    <SlideFrame page="11" kicker="الوحدة 07 — الذكاء الاصطناعي" title="فواتير الموردين بالذكاء الاصطناعي" lead="ارفع صورة فاتورة المورد، فيقترح النظام المورد والبنود والضريبة والإجمالي. لا يُسجَّل شيء قبل مراجعة بشرية.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="رفع الصورة">
            صورة من الكاميرا أو الجهاز بصيغ JPEG وPNG وWEBP.
          </Point>
          <Point n="02" title="استخراج مقترح">
            قراءة آلية عبر مزوّد ذكاء اصطناعي خارجي؛ النتائج اقتراحات لا قيود نهائية.
          </Point>
          <Point n="03" title="مراجعة ثم تسجيل">
            يعدّل المستخدم البنود ثم يعتمد التسجيل والقيد وتحديث المخزون.
          </Point>
        </div>
        <div>
          <Panel label="حدود يجب معرفتها" dark={false}>
            <Row k="الصلاحية" v="بحسب المسؤوليات الممنوحة" />
            <Row k="الاعتماد على مزوّد خارجي" v="نعم" />
            <Row k="دقة مضمونة أو توفير وقت مقاس" v="لا ندّعي" />
            <Row k="ضمن رحلة القبول الموثّقة" v="لا" />
            <Note>الميزة قائمة في النظام، لكنها لم تُقَس على فواتير شريك حقيقية. يُنصح بتجربة على عيّنة قبل الاعتماد.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
