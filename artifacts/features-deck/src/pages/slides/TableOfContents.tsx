export default function TableOfContents() {
  const col1 = [
    { n: "01", t: "لوحة القيادة التنفيذية" },
    { n: "02", t: "نقطة البيع (POS)" },
    { n: "03", t: "المنتجات والمخزون" },
    { n: "04", t: "المحاسبة والامتثال" },
    { n: "05", t: "التقارير والتحليلات" },
    { n: "06", t: "العملاء" },
  ];
  const col2 = [
    { n: "07", t: "فواتير الموردين (AI)" },
    { n: "08", t: "التقارير الذكية + كشف الاحتيال" },
    { n: "09", t: "نماذج الذكاء الاصطناعي" },
  ];
  const col3 = [
    { n: "10", t: "الفروع والمستخدمون و NCA ECC" },
    { n: "11", t: "صلاحيات الأدوار" },
    { n: "12", t: "POS Loyalty + ZATCA QR" },
    { n: "13", t: "المعاملات بين الشركات" },
    { n: "14", t: "تسعير التحويل والزكاة" },
    { n: "15", t: "عدّاد تسجيل ضريبة القيمة المضافة" },
    { n: "16", t: "إخفاء تلقائي لحقول الضريبة" },
  ];
  const col4 = [
    { n: "17", t: "التسجيل والإعداد الموجَّه" },
    { n: "18", t: "صفحة البداية (Landing)" },
    { n: "19", t: "المشاريع (Kanban)" },
    { n: "20", t: "التسويق والـ Leads" },
    { n: "21", t: "لوحة تحكم المدير" },
  ];

  const renderItem = (item: { n: string; t: string }) => (
    <div key={item.n} className="flex items-start gap-[1vw]">
      <span
        className="text-[0.9vw] font-semibold text-accent tracking-wider"
        style={{ direction: "ltr" }}
      >
        {item.n}
      </span>
      <span className="text-[1.1vw] text-text leading-[1.4]">{item.t}</span>
    </div>
  );

  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col justify-start"
      style={{ padding: "7vh 7vw", paddingTop: "12vh" }}
    >
      <div className="absolute top-[7vh] left-[7vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="text-[0.95vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[1.5vh]">
        فهرس الوحدات
      </div>
      <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[1.5vh]">
        إحدى وعشرون وحدة في نظام واحد
      </h2>
      <p className="text-[1.2vw] text-muted max-w-[60vw] leading-[1.6] mb-[4vh]">
        فهرس كامل لكل وحدة وكل وظيفة، مجموعة في أربع مجموعات وظيفية.
      </p>

      <div className="flex gap-[2.5vw]">
        <div className="flex-1 flex flex-col gap-[1.4vh]">
          <div className="text-[0.85vw] font-semibold text-muted tracking-[0.18em] uppercase mb-[0.5vh]">
            المنصّة الأساسية
          </div>
          {col1.map(renderItem)}
        </div>

        <div className="flex-1 flex flex-col gap-[1.4vh]">
          <div className="text-[0.85vw] font-semibold text-muted tracking-[0.18em] uppercase mb-[0.5vh]">
            الذكاء الاصطناعي
          </div>
          {col2.map(renderItem)}
        </div>

        <div className="flex-1 flex flex-col gap-[1.4vh]">
          <div className="text-[0.85vw] font-semibold text-muted tracking-[0.18em] uppercase mb-[0.5vh]">
            الامتثال والأمان
          </div>
          {col3.map(renderItem)}
        </div>

        <div className="flex-1 flex flex-col gap-[1.4vh]">
          <div className="text-[0.85vw] font-semibold text-muted tracking-[0.18em] uppercase mb-[0.5vh]">
            النمو والإدارة
          </div>
          {col4.map(renderItem)}
          <div className="flex items-start gap-[1vw] mt-[0.5vh]">
            <span
              className="text-[0.9vw] font-semibold text-accent tracking-wider"
              style={{ direction: "ltr" }}
            >
              +
            </span>
            <span className="text-[1.1vw] text-muted leading-[1.4]">
              خمسة نماذج ذكاء اصطناعي
            </span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">
        02
      </div>
    </div>
  );
}
