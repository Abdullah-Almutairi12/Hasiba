import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function ZakatEngine() {
  return (
    <SlideFrame page="20" kicker="الوحدة 15 — الامتثال والأمان" title="محرّك الزكاة السنوي" lead="تقدير للوعاء الزكوي من بيانات الميزانية مع طرح البنود المستبعدة، وتذكير بموعد الإقرار.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="قاعدة الحساب">
            حقوق الملكية + الالتزامات طويلة الأجل − الأصول الثابتة والاستثمارات المستبعدة.
          </Point>
          <Point n="02" title="تطبيق النسبة">
            تُطبَّق 2.5% على الوعاء بعد الاستبعادات كتقدير أولي.
          </Point>
          <Point n="03" title="تذكير بالموعد">
            تنبيه قبل نهاية السنة المالية للبدء بتجهيز الإقرار مبكرًا.
          </Point>
        </div>
        <div>
          <Panel label="مثال توضيحي · ليس بيانات عميل">
            <Row k="حقوق الملكية" v="2,150,000" />
            <Row k="+ التزامات طويلة الأجل" v="480,000" />
            <Row k="− أصول ثابتة وعقارات" v="(787,500)" />
            <Row k="الوعاء الزكوي" v="1,842,500" />
            <Row k="الزكاة التقديرية 2.5%" v="46,062.50" strong />
            <Note>الرقم تقديري ويخضع لمراجعة المحاسب. لا تقديم آلي للإقرار.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
