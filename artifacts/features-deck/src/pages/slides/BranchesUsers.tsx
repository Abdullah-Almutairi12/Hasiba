export default function BranchesUsers() {
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
            الوحدة 10 — الامتثال والأمان
          </div>
          <h2 className="font-display font-bold text-[3.2vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
            الفروع، المستخدمون، الإعدادات
          </h2>
          <p className="text-[1.2vw] text-muted leading-[1.6] mb-[3vh]">
            إدارة مركزية متعددة الفروع، مع جلسات مؤمَّنة، حماية CSRF، تشفير كلمات المرور، وسجل تدقيق كامل لكل عملية حساسة وفق ضوابط الهيئة الوطنية للأمن السيبراني (NCA ECC).
          </p>

          <div className="flex flex-col gap-[1.5vh]">
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">عزل البيانات</span> بين الشركات بـ <span className="font-mono text-[0.95vw]">scopedDb()</span>.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">حماية CSRF</span> بـ SameSite=lax + التحقق من الـ Origin.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">سجل تدقيق</span> بجدول <span className="font-mono text-[0.95vw]">audit_logs</span> لكل عملية كتابة.</div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <span className="w-[1.5vw] h-[3px] bg-accent mt-[1vh] shrink-0" />
              <div className="text-[1.05vw] text-muted leading-[1.55]"><span className="font-semibold text-text">صلاحيات هرمية</span> للفروع والمستخدمين.</div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center gap-[2vh]">
          <div className="bg-cream p-[1.8vw]">
            <div className="text-[0.85vw] uppercase tracking-wider text-muted mb-[1vh]">إدارة مركزية</div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-[0.8vh] items-center">
                <div className="w-[4vw] h-[3vh] bg-primary" />
                <div className="text-[0.85vw] text-muted">الرياض</div>
              </div>
              <div className="flex flex-col gap-[0.8vh] items-center">
                <div className="w-[4vw] h-[3vh] bg-primary" />
                <div className="text-[0.85vw] text-muted">جدة</div>
              </div>
              <div className="flex flex-col gap-[0.8vh] items-center">
                <div className="w-[5vw] h-[5vh] bg-accent flex items-center justify-center">
                  <span className="text-[0.85vw] font-bold text-cream">HQ</span>
                </div>
                <div className="text-[0.85vw] font-semibold text-text">المقر</div>
              </div>
              <div className="flex flex-col gap-[0.8vh] items-center">
                <div className="w-[4vw] h-[3vh] bg-primary" />
                <div className="text-[0.85vw] text-muted">الدمام</div>
              </div>
              <div className="flex flex-col gap-[0.8vh] items-center">
                <div className="w-[4vw] h-[3vh] bg-primary" />
                <div className="text-[0.85vw] text-muted">الخبر</div>
              </div>
            </div>
          </div>

          <div className="bg-primary p-[1.8vw] text-cream">
            <div className="text-[0.85vw] uppercase tracking-[0.2em] text-cream/70 mb-[1.5vh]">معايير NCA ECC</div>
            <div className="grid grid-cols-2 gap-[1.5vh] text-[1vw]">
              <div className="flex items-center gap-[0.6vw]"><span className="text-accent">✓</span> جلسات مؤمَّنة</div>
              <div className="flex items-center gap-[0.6vw]"><span className="text-accent">✓</span> تشفير كلمات المرور</div>
              <div className="flex items-center gap-[0.6vw]"><span className="text-accent">✓</span> سجل تدقيق كامل</div>
              <div className="flex items-center gap-[0.6vw]"><span className="text-accent">✓</span> حماية CSRF</div>
              <div className="flex items-center gap-[0.6vw]"><span className="text-accent">✓</span> فصل الأدوار</div>
              <div className="flex items-center gap-[0.6vw]"><span className="text-accent">✓</span> عزل البيانات</div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">15</div>
    </div>
  );
}
