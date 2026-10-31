import { SlideFrame } from "../../components/deck";

export default function TableOfContents() {
  return (
    <SlideFrame page="02" kicker="فهرس الوحدات" title="اثنتان وعشرون وحدة في أربع مجموعات" lead="الوحدات موجودة في النظام؛ حالة قبول كل منها موضّحة في شريحتها وفي شريحة الحالة (29).">
      <div className="grid grid-cols-4 gap-[2.4vw] text-[1.5vw] text-muted leading-[1.35]">
        <div>
          <div className="text-[1.6vw] font-semibold text-text border-b-2 border-primary pb-[0.8vh] mb-[1vh]">المنصّة الأساسية</div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">01</span><span>لوحة القيادة</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">02</span><span>نقطة البيع</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">03</span><span>المنتجات والمخزون</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">04</span><span>المحاسبة وأمر البيع</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">05</span><span>التقارير</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">06</span><span>العملاء والذمم</span></div>
        </div>
        <div>
          <div className="text-[1.6vw] font-semibold text-text border-b-2 border-primary pb-[0.8vh] mb-[1vh]">الذكاء الاصطناعي</div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">07</span><span>فواتير الموردين</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">08</span><span>التقارير الذكية</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">09</span><span>النماذج التحليلية</span></div>
        </div>
        <div>
          <div className="text-[1.6vw] font-semibold text-text border-b-2 border-primary pb-[0.8vh] mb-[1vh]">الامتثال والأمان</div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">10</span><span>الشركات والفروع</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">11</span><span>الأدوار المقيّدة</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">12</span><span>الولاء والفاتورة</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">13</span><span>بين الشركات</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">14</span><span>تسعير التحويل</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">15</span><span>الزكاة</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">16</span><span>الهوية الضريبية</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">17</span><span>وراثة الفروع</span></div>
        </div>
        <div>
          <div className="text-[1.6vw] font-semibold text-text border-b-2 border-primary pb-[0.8vh] mb-[1vh]">النمو والإدارة</div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">18</span><span>الإعداد الموجَّه</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">19</span><span>صفحة البداية</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">20</span><span>المشاريع</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">21</span><span>التسويق</span></div>
          <div className="flex gap-[0.8vw] items-baseline py-[0.5vh]"><span dir="ltr" className="text-accent font-semibold">22</span><span>لوحة المدير</span></div>
        </div>
      </div>
    </SlideFrame>
  );
}
