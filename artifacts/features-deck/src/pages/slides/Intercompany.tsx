import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function Intercompany() {
  return (
    <SlideFrame page="18" kicker="الوحدة 13 — الامتثال والأمان" title="المعاملات بين الشركات" lead="عند فوترة عميل مرتبط بشركة شقيقة، يُنشئ النظام فاتورة الشراء المقابلة في الشركة الأخرى ضمن المعاملة نفسها.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="انعكاس داخل معاملة واحدة">
            البيع والشراء المقابل يُحفظان معًا أو لا يُحفظان.
          </Point>
          <Point n="02" title="ربط فريد">
            كل ربط مسجّل مرة واحدة، مع منع الحلقات المتكررة.
          </Point>
          <Point n="03" title="إلغاء وإعادة مزامنة">
            حالات الربط: مطابق، ملغى، أعيدت مزامنته.
          </Point>
        </div>
        <div>
          <Panel label="سير العمل">
            <Row k="الشركة A" v="فاتورة بيع" />
            <Row k="محرّك الانعكاس" v="المعاملة نفسها" />
            <Row k="الشركة B" v="فاتورة شراء" />
            <Note>الميزة قائمة في النظام ومغطاة باختبارات خادم، لكنها خارج رحلة المتصفح الموثّقة لهذا الاجتماع.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
