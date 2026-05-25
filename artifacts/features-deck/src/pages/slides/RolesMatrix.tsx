export default function RolesMatrix() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body"
      style={{ padding: "7vh 7vw", paddingTop: "13vh" }}
    >
      <div className="absolute top-[7vh] left-[7vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[86vw]">
        <div className="text-[0.95vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[1.5vh]">
          الوحدة 11 — الامتثال والأمان
        </div>
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          ثمانية أدوار، أربعة عشر حارسًا
        </h2>
        <p className="text-[1.2vw] text-muted max-w-[64vw] leading-[1.6] mb-[3.5vh]">
          نموذج صلاحيات على غرار Odoo وZoho وSAP. يطبَّق على مستوى المسار وعلى مستوى الجدول معًا.
        </p>

        <div className="text-[0.82vw] uppercase tracking-[0.15em] text-muted mb-[1.5vh]">الأدوار الثمانية</div>
        <div className="flex gap-[0.8vw] flex-wrap mb-[3.5vh]">
          <div className="border border-primary px-[1.2vw] py-[0.8vh] text-[1vw] text-text font-semibold">صاحب · owner</div>
          <div className="border border-primary px-[1.2vw] py-[0.8vh] text-[1vw] text-text font-semibold">مدير · manager</div>
          <div className="border border-sage px-[1.2vw] py-[0.8vh] text-[1vw] text-text font-semibold">محاسب · accountant</div>
          <div className="border border-accent px-[1.2vw] py-[0.8vh] text-[1vw] text-text font-semibold">مبيعات · sales</div>
          <div className="border border-accent px-[1.2vw] py-[0.8vh] text-[1vw] text-text font-semibold">كاشير · cashier</div>
          <div className="border border-sage px-[1.2vw] py-[0.8vh] text-[1vw] text-text font-semibold">مخزون · inventory</div>
          <div className="border border-accent px-[1.2vw] py-[0.8vh] text-[1vw] text-text font-semibold">تسويق · marketing</div>
          <div className="border border-muted px-[1.2vw] py-[0.8vh] text-[1vw] text-text font-semibold">مدقّق · auditor</div>
        </div>

        <div className="text-[0.82vw] uppercase tracking-[0.15em] text-muted mb-[1.5vh]">أبرز الحرّاس على الخادم</div>
        <div className="flex gap-[1.2vw]">
          <div className="flex-1 border border-line p-[1.5vw]">
            <div className="font-mono text-[1.05vw] text-primary font-semibold mb-[0.8vh]" style={{ direction: "ltr", textAlign: "right" }}>adminGuard</div>
            <div className="w-[1.5vw] h-[3px] bg-accent mb-[1.2vh]" />
            <div className="text-[0.9vw] text-muted leading-[1.55] mb-[0.8vh]">owner، manager</div>
            <div className="text-[0.9vw] text-text">إدارة الفروع، المشاريع، المستخدمين، لوحة الإدارة.</div>
          </div>
          <div className="flex-1 border border-line p-[1.5vw]">
            <div className="font-mono text-[1.05vw] text-primary font-semibold mb-[0.8vh]" style={{ direction: "ltr", textAlign: "right" }}>financeGuard</div>
            <div className="w-[1.5vw] h-[3px] bg-accent mb-[1.2vh]" />
            <div className="text-[0.9vw] text-muted leading-[1.55] mb-[0.8vh]">+ accountant</div>
            <div className="text-[0.9vw] text-text">كل عمليات المحاسبة وفواتير الموردين والقيود.</div>
          </div>
          <div className="flex-1 border border-line p-[1.5vw]">
            <div className="font-mono text-[1.05vw] text-primary font-semibold mb-[0.8vh]" style={{ direction: "ltr", textAlign: "right" }}>posGuard</div>
            <div className="w-[1.5vw] h-[3px] bg-accent mb-[1.2vh]" />
            <div className="text-[0.9vw] text-muted leading-[1.55] mb-[0.8vh]">+ sales، cashier</div>
            <div className="text-[0.9vw] text-text">جلسات نقطة البيع وإنشاء الطلبات وطباعة الفواتير.</div>
          </div>
          <div className="flex-1 border border-line p-[1.5vw]">
            <div className="font-mono text-[1.05vw] text-primary font-semibold mb-[0.8vh]" style={{ direction: "ltr", textAlign: "right" }}>auditReadGuard</div>
            <div className="w-[1.5vw] h-[3px] bg-accent mb-[1.2vh]" />
            <div className="text-[0.9vw] text-muted leading-[1.55] mb-[0.8vh]">owner، manager، auditor</div>
            <div className="text-[0.9vw] text-text">قراءة سجلات التدقيق والمراجعة الأمنية.</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">16</div>
    </div>
  );
}
