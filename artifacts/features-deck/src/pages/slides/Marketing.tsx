import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function Marketing() {
  return (
    <SlideFrame page="27" kicker="الوحدة 21 — النمو والإدارة" title="التسويق" lead="حملات بميزانيات وقمع للعملاء المحتملين من الاهتمام حتى الإغلاق، مع قياس التحويل في كل مرحلة.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="إدارة الحملات">
            ميزانية وقناة وقياس نتيجة لكل حملة.
          </Point>
          <Point n="02" title="قمع العملاء المحتملين">
            مراحل من الاستحواذ إلى الإغلاق مع تصنيف الجاهزية.
          </Point>
          <Point n="03" title="قياس التحويل">
            معدل الانتقال بين المراحل لتحديد نقاط التحسين.
          </Point>
        </div>
        <div>
          <Panel label="مثال توضيحي · قمع شهري">
            <Row k="زيارات" v="12,840" />
            <Row k="اهتمام" v="3,210" />
            <Row k="تأهيل" v="980" />
            <Row k="عملاء" v="214" />
            <Row k="التحويل الإجمالي" v="1.67%" strong />
            <Note>أرقام توضيحية. إرسال البريد للحملات لم يُقبل في تشغيل حي بعد.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
