import { SlideFrame } from "../../components/deck";

const shot = `${import.meta.env.BASE_URL}images/onboarding-after-desktop.jpg`;

export default function Onboarding() {
  return (
    <SlideFrame page="24" kicker="الوحدة 18 — النمو والإدارة" title="الإعداد الأولي: صادق لا مكتمل" lead="المعالج السابق أوحى بأن المتجر جاهز بينما لم يُنشأ أي فرع أو مستودع. صار الآن يحفظ النشاط فقط ويدلّ على ما بقي.">
      <div className="grid grid-cols-[1.25fr_1fr] gap-[3vw] h-full min-h-0">
        <figure className="m-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 border border-line bg-cream overflow-hidden">
            <img src={shot} alt="لقطة فعلية لمعالج الإعداد بعد الإصلاح" className="w-full h-full object-cover object-top" />
          </div>
          <figcaption className="text-[1.3vw] leading-[1.4] text-muted mt-[1vh]">
            لقطة متصفح فعلية بعد الإصلاح، بيانات مصطنعة دون بيانات دخول.
          </figcaption>
        </figure>
        <div className="flex flex-col gap-[1.4vh] min-h-0 overflow-hidden">
          <div className="text-[1.55vw] leading-[1.4] text-text">
            <span className="font-semibold">الحفظ:</span> نوع النشاط فقط، مع رسالة خطأ عربية عند الفشل. لا إنشاء تلقائي لفروع أو ضريبة أو فواتير.
          </div>
          <div className="text-[1.55vw] leading-[1.4] text-text">
            <span className="font-semibold">الفائدة:</span> يعرف المالك ما بقي، بروابط مباشرة إلى الفروع والفريق والإعدادات والمنتجات.
          </div>
          <div className="bg-warm text-text px-[1.4vw] py-[1.2vh]">
            <div className="text-[1.45vw] font-semibold text-accent mb-[0.4vh]">الحالة</div>
            {[
              ["المعالج المصحَّح", "منفّذ، جزئي", true],
              ["إعداد المتجر كاملًا", "غير مكتمل", false],
              ["كتالوج أساسي CSV/XLSX", "جديد فقط؛ بمعاينة وتأكيد", false],
              ["الرقم الضريبي المدخل", "معلن غير متحقق", false],
            ].map(([k, v, strong]) => (
              <div key={String(k)} className="flex justify-between items-baseline gap-[1vw] border-b border-current/15 py-[0.45vh] text-[1.5vw]">
                <span className="opacity-80">{k}</span>
                <span className={strong ? "font-bold text-accent" : "font-semibold"}>{v}</span>
              </div>
            ))}
            <p className="text-[1.35vw] leading-[1.4] opacity-75 mt-[0.8vh] mb-0">استيراد المنتجات الجديدة فقط، لا تحديث ولا مخزون؛ ليس استيراداً عاماً. كشوف البنوك ميزة منفصلة. إعداد المتجر الكامل لم يُقبل بعد.</p>
          </div>
        </div>
      </div>
    </SlideFrame>
  );
}
