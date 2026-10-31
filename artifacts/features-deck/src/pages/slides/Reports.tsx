import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function Reports() {
  return (
    <SlideFrame page="08" kicker="الوحدة 05 — المنصّة الأساسية" title="التقارير والتحليلات" lead="تقارير للمبيعات والمخزون والمحاسبة والعملاء، مع تصدير Excel. نفرّق بوضوح بين المبيعات والتحصيل.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="تقارير حسب الوحدة">
            مبيعات بالفرع والمستخدم، مخزون وحركة، ربحية، محاسبة وضرائب، وعملاء.
          </Point>
          <Point n="02" title="تصدير XLSX مثبت">
            مسار التصدير الأصلي أعاد ملف منتجات فعليًا بالعربية واتجاه RTL.
          </Point>
          <Point n="03" title="قراءة صحيحة للأرقام">
            المبيعات الإجمالية ليست التحصيل ولا صافي الإيراد؛ كل رقم يُعرض بمعناه.
          </Point>
        </div>
        <div>
          <Panel label="دليل التصدير · 31 أكتوبر 2026">
            <Row k="استجابة مسار التصدير" v="HTTP 200" />
            <Row k="حجم ملف المنتجات" v="6,933 bytes" />
            <Row k="النص العربي واتجاه RTL" v="سليم" />
            <Row k="الكمية المقروءة باستقلال" v="17" strong />
            <Note>المثبت هو مسار HTTP المصرّح به. لم نُثبت زر تنزيل XLSX من المتصفح في الصفحات المفحوصة.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
