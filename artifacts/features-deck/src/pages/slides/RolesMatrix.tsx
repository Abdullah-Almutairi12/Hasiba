import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function RolesMatrix() {
  return (
    <SlideFrame page="16" kicker="الوحدة 11 — الامتثال والأمان" title="الأدوار والمسؤوليات المقيّدة" lead="كل صلاحية تُمنح ضمن شركة وفروع محددة، ولا تُستنتج صلاحية مالية حساسة من دور عام.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="نطاق صريح">
            الإسناد يحدد الشركة والفروع؛ لا يرى المستخدم ولا يعدّل خارج نطاقه.
          </Point>
          <Point n="02" title="لا منح ضمني">
            الرواتب وصلاحيات الصرف لا تأتي تلقائيًا مع أي دور؛ تُمنح صراحة فقط.
          </Point>
          <Point n="03" title="موافقات تحترم السحب">
            سحب الصلاحية أو تغيّر أهلية المعتمد يُحترم حتى أثناء موافقة جارية.
          </Point>
        </div>
        <div>
          <Panel label="أمثلة الأدوار المتاحة">
            <Row k="صاحب المنشأة · مدير" v="إدارة ضمن النطاق" />
            <Row k="محاسب" v="العمليات المالية" />
            <Row k="مبيعات · كاشير" v="البيع ونقطة البيع" />
            <Row k="مخزون · تسويق" v="وحداتها فقط" />
            <Row k="مدقّق" v="قراءة السجلات" />
            <Note>اختُبرت حالات السحب والموافقات خلف أقفال PostgreSQL؛ لا نعمّم ذلك على كل صلاحيات النظام.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
