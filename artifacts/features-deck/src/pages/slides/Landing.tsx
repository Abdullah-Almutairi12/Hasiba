export default function Landing() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body"
      style={{ padding: "7vh 7vw", paddingTop: "13vh" }}
    >
      <div className="absolute top-[7vh] left-[7vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="flex gap-[4vw] h-[74vh]">
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-[0.95vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[1.5vh]">
            الوحدة 16 — النمو والإدارة
          </div>
          <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            صفحة البداية
          </h2>
          <p className="text-[1.2vw] text-muted leading-[1.6] mb-[3vh]">
            صفحة <span className="font-mono text-[1.05vw] text-text">/welcome</span> تسويقية عامة تعكس قيمة المنتج وتوجِّه الزائر مباشرة إلى التسجيل أو الدخول.
          </p>
          <div className="flex flex-col gap-[1.5vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">قسم Hero</span> برسالة واضحة ومرئيات قوية.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">معاينة المنتج</span> ولقطات للواجهات الأساسية.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">شبكة مميزات</span> وقسم «كيف يعمل».</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">CTA داكن</span> + روابط <span className="font-mono text-[0.95vw]">/signup</span> و<span className="font-mono text-[0.95vw]">/login</span>.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">تحويل ذكي</span> — المستخدم المسجَّل يُنقل تلقائيًا إلى لوحة القيادة.</div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <div className="border border-line bg-bg" style={{ aspectRatio: "16 / 10" }}>
            <div className="bg-warm px-[1.2vw] py-[1vh] flex gap-[0.5vw] items-center border-b border-line">
              <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-accent" />
              <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-sage" />
              <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-primary" />
              <div className="text-[0.75vw] text-muted mr-auto font-mono" style={{ direction: "ltr" }}>hasba.ai/welcome</div>
            </div>
            <div className="p-[2vw] flex flex-col justify-between" style={{ height: "calc(100% - 4vh)" }}>
              <div>
                <div className="font-display text-[2vw] font-bold text-text leading-tight mb-[1.5vh]">حاسبة<span className="text-accent">.AI</span></div>
                <div className="text-[1vw] text-muted leading-[1.5] max-w-[80%]">منصّة تخطيط موارد المؤسسات للأعمال السعودية.</div>
              </div>
              <div className="flex gap-[1vw]">
                <div className="bg-primary text-cream px-[1.5vw] py-[1vh] text-[0.9vw] font-semibold">ابدأ مجانًا</div>
                <div className="border border-line text-text px-[1.5vw] py-[1vh] text-[0.9vw] font-semibold">تسجيل الدخول</div>
              </div>
              <div className="grid grid-cols-3 gap-[1vw]">
                <div className="bg-cream p-[1vw]">
                  <div className="text-[0.75vw] text-accent font-semibold uppercase tracking-wider mb-[0.5vh]">01</div>
                  <div className="text-[0.85vw] text-text">سريع</div>
                </div>
                <div className="bg-cream p-[1vw]">
                  <div className="text-[0.75vw] text-accent font-semibold uppercase tracking-wider mb-[0.5vh]">02</div>
                  <div className="text-[0.85vw] text-text">عربي</div>
                </div>
                <div className="bg-cream p-[1vw]">
                  <div className="text-[0.75vw] text-accent font-semibold uppercase tracking-wider mb-[0.5vh]">03</div>
                  <div className="text-[0.85vw] text-text">متكامل</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">22</div>
    </div>
  );
}
