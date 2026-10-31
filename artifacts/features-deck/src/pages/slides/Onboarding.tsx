import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function Onboarding() {
  return (
    <SlideFrame page="24" kicker="الوحدة 18 — النمو والإدارة" title="التسجيل والإعداد الموجَّه" lead="شاشة /signup لإنشاء الشركة، ومعالج /onboarding من خمس خطوات يمكن حفظه والعودة إليه.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="الشركة ثم الفروع">
            الاسم التجاري والعنوان والهوية الضريبية المعلنة، ثم المواقع والمستودعات.
          </Point>
          <Point n="02" title="المستخدمون والأدوار">
            دعوة المستخدمين وإسناد أدوار مقيّدة بالشركة والفروع.
          </Point>
          <Point n="03" title="الحسابات والمنتجات">
            قالب دليل حسابات قابل للتعديل، ثم رفع المنتجات الأولية.
          </Point>
        </div>
        <div>
          <Panel label="ما يجب توضيحه للشريك" dark={false}>
            <Row k="الرقم الضريبي المدخل" v="معلن غير متحقق" />
            <Row k="التحقق من الهيئة" v="خارج النظام حاليًا" />
            <Row k="مدة إعداد مضمونة" v="لا نحددها" />
            <Row k="الدخول عبر Google وApple" v="غير مفعّل" />
            <Note>الدخول المثبت في العرض بحساب مُعد مسبقًا على بيانات مصطنعة.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
