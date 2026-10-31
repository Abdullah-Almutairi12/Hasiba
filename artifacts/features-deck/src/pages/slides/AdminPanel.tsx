import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function AdminPanel() {
  return (
    <SlideFrame page="28" kicker="الوحدة 22 — النمو والإدارة" title="لوحة تحكم المدير" lead="صفحة /admin للمديرين فقط، تجمع أدوات الإشراف على المنصّة في خمس تبويبات.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="نظرة عامة ودعم">
            مؤشرات وصحة النظام، وتذاكر دعم بحالات وأولويات.
          </Point>
          <Point n="02" title="إعلانات وميزات">
            نشر الإعلانات وإنهاؤها، ومفاتيح تشغيل الميزات حسب الفئة.
          </Point>
          <Point n="03" title="السجلات">
            أحدث سجلات التدقيق للعمليات الحساسة.
          </Point>
        </div>
        <div>
          <Panel label="تفاصيل الوصول" dark={false}>
            <Row k="المسار" v="/admin" />
            <Row k="الصلاحية" v="مدير فقط" />
            <Row k="الجداول" v="support_tickets · announcements · feature_flags" />
            <Note>تشغيل الميزات وإيقافها لا يعني قبولها؛ حالة القبول موثّقة في شريحة الحالة.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
