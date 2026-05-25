export default function TableOfContents() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col justify-start"
      style={{ padding: "7vh 7vw", paddingTop: "14vh" }}
    >
      <div className="absolute top-[7vh] left-[7vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="text-[0.95vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[1.5vh]">
        فهرس الوحدات
      </div>
      <h2 className="font-display font-bold text-[3.6vw] leading-[1.1] tracking-tight text-text m-0 mb-[1.5vh]">
        سبعة عشر وحدة في نظام واحد
      </h2>
      <p className="text-[1.25vw] text-muted max-w-[60vw] leading-[1.6] mb-[5vh]">
        فهرس كامل لكل وحدة وكل وظيفة، مجموعة في أربع مجموعات وظيفية.
      </p>

      <div className="flex gap-[2.5vw]">
        <div className="flex-1 flex flex-col gap-[1.6vh]">
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>01</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">لوحة القيادة التنفيذية</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>02</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">نقطة البيع (POS)</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>03</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">المنتجات والمخزون</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>04</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">فواتير الموردين (AI)</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>05</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">المحاسبة والامتثال</span>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-[1.6vh]">
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>06</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">التقارير والتحليلات</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>07</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">العملاء</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>08</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">الفروع والمستخدمون و NCA ECC</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>09</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">التسجيل والإعداد الموجَّه</span>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-[1.6vh]">
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>10</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">التقارير الذكية + كشف الاحتيال</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>11</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">POS Loyalty + ZATCA QR</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>12</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">المشاريع (Kanban)</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>13</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">التسويق والـ Leads</span>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-[1.6vh]">
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>14</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">صفحة البداية (Landing)</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>15</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">المعاملات بين الشركات</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>16</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">تسعير التحويل والزكاة</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>17</span>
            <span className="text-[1.15vw] text-text leading-[1.4]">لوحة تحكم المدير</span>
          </div>
          <div className="flex items-start gap-[1vw]">
            <span className="text-[0.95vw] font-semibold text-accent tracking-wider" style={{ direction: "ltr" }}>+</span>
            <span className="text-[1.15vw] text-muted leading-[1.4]">خمسة نماذج ذكاء اصطناعي</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">02</div>
    </div>
  );
}
