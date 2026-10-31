import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function Projects() {
  return (
    <SlideFrame page="26" kicker="الوحدة 20 — النمو والإدارة" title="المشاريع" lead="لوحة Kanban وقائمة مهام، مع ميزانية ومؤشر تقدّم يُحتسب من المهام المكتملة.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="Kanban وقائمة">
            عرضان لنفس البيانات بأعمدة قابلة للتخصيص.
          </Point>
          <Point n="02" title="الميزانية والفعلي">
            تتبّع الإنفاق الفعلي مقابل المخطّط لكل مشروع.
          </Point>
          <Point n="03" title="تقدّم تلقائي">
            نسبة الإنجاز تُحسب من المهام المغلقة.
          </Point>
        </div>
        <div>
          <Panel label="مثال توضيحي · إطلاق فرع">
            <Row k="مهام مفتوحة" v="2" />
            <Row k="قيد التنفيذ" v="3" />
            <Row k="مكتملة" v="3" />
            <Row k="الميزانية المصروفة" v="142,500 / 200,000" strong />
            <Note>بيانات توضيحية لشرح الشاشة، وليست مشروع عميل.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
