import { SlideFrame, Point, Panel, Row, Note } from "../../components/deck";

export default function BranchesUsers() {
  return (
    <SlideFrame page="15" kicker="الوحدة 10 — الامتثال والأمان" title="الشركات والفروع والمستخدمون" lead="إدارة مركزية لعدة شركات وفروع، مع عزل بيانات كل شركة وضوابط أمنية مطبّقة في الخادم.">
      <div className="grid grid-cols-2 gap-[3.5vw] h-full">
        <div className="flex flex-col gap-[2.6vh]">
          <Point n="01" title="عزل بين الشركات">
            كل استعلام مقيّد بالشركة النشطة، فلا تتسرّب بيانات شركة إلى أخرى.
          </Point>
          <Point n="02" title="جلسات وحماية الطلبات">
            جلسات خادم، تشفير كلمات المرور، وحماية CSRF بالتحقق من المصدر.
          </Point>
          <Point n="03" title="سجل تدقيق">
            تسجيل عمليات الكتابة الحساسة للمراجعة لاحقًا.
          </Point>
        </div>
        <div>
          <Panel label="ضوابط مطبّقة · دون ادعاء شهادة" dark={false}>
            <Row k="عزل بيانات الشركات" v="مطبّق" />
            <Row k="فروع ترث هوية الشركة الضريبية" v="مثبت" />
            <Row k="سجل تدقيق للعمليات الحساسة" v="مطبّق" />
            <Row k="شهادة أو تقييم من NCA" v="لا ندّعي" />
            <Note>الضوابط مستوحاة من الممارسات المعروفة، لكنها لم تخضع لتقييم رسمي من الهيئة الوطنية للأمن السيبراني.</Note>
          </Panel>
        </div>
      </div>
    </SlideFrame>
  );
}
