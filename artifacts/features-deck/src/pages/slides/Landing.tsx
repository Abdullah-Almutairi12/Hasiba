import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function Landing() {
  return (
    <SlideFrame page="25" kicker="الوحدة 19 — النمو والإدارة" title="صفحة البداية" lead="صفحة /welcome العامة تعرّف بالمنتج وتوجّه الزائر إلى إنشاء حساب أو تسجيل الدخول.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="رسالة واضحة">
            قسم رئيسي ومعاينة للواجهات وشبكة مميزات وقسم كيف يعمل.
          </Point>
          <Point n="02" title="توجيه مباشر">
            روابط /signup و/login، والمستخدم المسجّل يُنقل إلى لوحة القيادة.
          </Point>
          <Point n="03" title="نص دقيق">
            يجب أن يطابق نص الصفحة حالة القبول الحالية قبل أي حملة عامة.
          </Point>
        </div>
        <div>
          <Panel label="hasba.ai/welcome" dark={false}>
            <div className="font-display font-bold text-[3.4vw] leading-none text-text mt-[1vh]">حاسبة<span className="text-accent">.AI</span></div>
            <p className="text-[1.6vw] text-muted leading-[1.5] mt-[1.6vh] mb-[2.4vh]">نظام ERP عربي للأعمال السعودية.</p>
            <div className="flex gap-[1vw]">
              <span className="bg-primary text-cream text-[1.6vw] px-[1.4vw] py-[0.8vh]">إنشاء حساب</span>
              <span className="border border-primary text-text text-[1.6vw] px-[1.4vw] py-[0.8vh]">تسجيل الدخول</span>
            </div>
            <Note>لا تسعير ولا دفع إلكتروني مقبول بعد؛ الاشتراك والدفع يُتفق عليهما خارج الصفحة.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
