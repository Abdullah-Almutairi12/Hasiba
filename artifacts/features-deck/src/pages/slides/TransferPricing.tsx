import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function TransferPricing() {
  return (
    <SlideFrame page="19" kicker="الوحدة 14 — الامتثال والأمان" title="تسعير التحويل والزكاة" lead="أدوات تنبيه مساعدة: رصد معاملات بين الشركات قد تحتاج توثيقًا، وحساب تقديري للوعاء الزكوي.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="تنبيهات تسعير التحويل">
            رصد معاملات الشركات الشقيقة التي قد تحتاج توثيقًا وفق الأنظمة.
          </Point>
          <Point n="02" title="تقدير الوعاء الزكوي">
            حساب سنوي من البيانات المحاسبية، يحفظ النتيجة كتنبيه للمراجعة.
          </Point>
          <Point n="03" title="منع التكرار">
            تنبيه واحد مفتوح لكل فترة، يُتابَع ويُغلق بسجل.
          </Point>
        </div>
        <div>
          <Panel label="حدود الاستخدام" dark={false}>
            <Row k="طبيعة المخرج" v="تنبيه للمراجعة" />
            <Row k="بديل عن المستشار أو الإقرار" v="لا" />
            <Row k="إرسال للهيئة" v="غير مدعوم" />
            <Note>المسؤولية النهائية عن التوثيق والإقرار تبقى على المنشأة ومستشارها.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
