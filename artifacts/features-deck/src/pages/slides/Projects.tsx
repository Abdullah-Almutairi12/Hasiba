export default function Projects() {
  return (
    <div
      dir="rtl"
      className="w-screen h-screen overflow-hidden relative bg-bg text-text font-body flex flex-col justify-start"
      style={{ padding: "8vh 8vw", paddingTop: "18vh" }}
    >
      <div className="absolute top-[8vh] left-[8vw] text-[1vw] font-semibold tracking-[0.18em] uppercase text-text">
        FEATURES OVERVIEW / 2026
      </div>

      <div className="max-w-[84vw]">
        <div className="text-[1vw] font-semibold text-accent tracking-[0.18em] uppercase mb-[2vh]">
          الوحدة 12
        </div>
        <h2 className="font-display font-bold text-[4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2.5vh]">
          المشاريع
        </h2>
        <p className="text-[1.5vw] text-muted max-w-[60vw] leading-[1.6] mb-[6vh]">
          لوحة Kanban وقائمة مهام، مع ميزانية ومؤشر تقدّم محسوب تلقائيًا لكل مشروع.
        </p>

        <div className="flex gap-[3vw]">
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">01. لوحة Kanban</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.15vw] leading-[1.7] text-muted m-0">
              تنظيم بصري للمهام بحسب الحالة: مفتوحة، قيد التنفيذ، مراجعة، ومكتملة.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">02. ميزانيات</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.15vw] leading-[1.7] text-muted m-0">
              تتبّع الإنفاق الفعلي مقابل المخطّط، مع تنبيهات عند تجاوز الحدود المعتمدة.
            </p>
          </div>
          <div className="flex-1">
            <div className="text-[1.4vw] font-semibold text-text mb-[1.5vh]">03. تقدّم المشروع</div>
            <div className="w-[2vw] h-[3px] bg-accent mb-[2vh]" />
            <p className="text-[1.15vw] leading-[1.7] text-muted m-0">
              مؤشّر نسبة الإنجاز يُحتسب تلقائيًا من المهام المكتملة مقابل الإجمالي.
            </p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[8vh] right-[8vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[8vh] left-[8vw] text-[1vw] font-semibold text-text">13</div>
    </div>
  );
}
