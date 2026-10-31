import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function VatThreshold() {
  return (
    <SlideFrame page="21" kicker="الوحدة 16 — الامتثال والأمان" title="الهوية الضريبية: الحالية والمستقبلية" lead="هوية الشركة الضريبية تُحفظ بنسخ مؤرخة. النظام لا يسجّل المنشأة في الضريبة تلقائيًا عند بلوغ أي حد.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="نسخ بتواريخ سريان">
            نسخة سارية اليوم ونسخة مستقبلية تُجدول مسبقًا، دون تعديل التاريخ الماضي.
          </Point>
          <Point n="02" title="تاريخ السريان ليس تاريخ التسجيل">
            تاريخ تسجيل الهيئة يبقى فارغًا حتى يُوثَّق، وحالة الإقرار غير متحقق منها.
          </Point>
          <Point n="03" title="متابعة الحد إرشادية">
            مؤشر المبيعات مقابل حد التسجيل للتنبيه فقط؛ التسجيل قرار المنشأة وإجراؤها.
          </Point>
        </div>
        <div>
          <Panel label="رحلة الهوية · شركة اختبار مصطنعة">
            <Row k="النسخة 1 · سارية" v="2026-10-31" />
            <Row k="النسخة 2 · مستقبلية لغير المسجّل" v="2099-01-01" />
            <Row k="vatRegistrationDate" v="null" />
            <Row k="حالة الإقرار" v="declared_unverified" />
            <Row k="نشر السياسة" v="محجوب" strong />
            <Note>يبقى TAX_POLICY_NOT_READY. لم يحاول المتصفح نشر السياسة.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
