export default function BranchesUsers() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col justify-start"
      style={{ padding: "8vh 8vw", paddingTop: "16vh" }}
    >
      <div className="absolute top-[8vh] left-[8vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[84vw]">
        <div className="text-[1vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[2vh]">
          الوحدة 08
        </div>
        <h2 className="font-display font-bold text-[3.6vw] leading-[1.1] tracking-tight text-text m-0 mb-[2.5vh]">
          الفروع، المستخدمون، والإعدادات (NCA ECC)
        </h2>
        <p className="text-[1.4vw] text-muted max-w-[62vw] leading-[1.6] mb-[5.5vh]">
          إدارة مركزية متعددة الفروع، صلاحيات بثمانية أدوار مهنية، وإعدادات أمان وفق ضوابط الهيئة الوطنية للأمن السيبراني.
        </p>

        <div className="flex gap-[3vw]">
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">01. متعدد الفروع</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.1vw] leading-[1.7] text-muted m-0">
              إدارة مركزية بحدود صلاحيات واضحة لكل فرع، مع تجميع تلقائي للتقارير على مستوى الشركة.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">02. ثمانية أدوار مهنية</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.1vw] leading-[1.7] text-muted m-0">
              صاحب، مدير، محاسب، مبيعات، كاشير، مخزون، تسويق، مدقّق — على غرار Odoo وZoho وSAP.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">03. أمان NCA ECC</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.1vw] leading-[1.7] text-muted m-0">
              جلسات مؤمّنة، حماية ضد CSRF، تشفير كلمات المرور، وسجل تدقيق كامل لكل عملية حساسة.
            </p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-text">09</div>
    </div>
  );
}
