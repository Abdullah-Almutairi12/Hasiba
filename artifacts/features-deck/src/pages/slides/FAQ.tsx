export default function FAQ() {
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
          الأسئلة الشائعة — الصفحة 1
        </div>
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text m-0 mb-[2vh]">
          أكثر ما يسأل عنه العملاء
        </h2>
        <p className="text-[1.2vw] text-muted max-w-[64vw] leading-[1.6] mb-[4.5vh]">
          إجابات مختصرة عن الأسئلة المتكرّرة قبل الاشتراك، تغطّي الامتثال والنشر والبيانات والدعم.
        </p>

        <div className="grid grid-cols-2 gap-x-[2vw] gap-y-[2.5vh]">
          <div className="border border-line p-[1.6vw]">
            <div className="flex items-start gap-[0.8vw] mb-[1.2vh]">
              <div className="text-[1.2vw] font-bold text-accent leading-none mt-[0.3vh]">01</div>
              <div className="text-[1.15vw] font-bold text-text leading-[1.35]">
                هل النظام معتمد من هيئة الزكاة والضريبة (ZATCA)؟
              </div>
            </div>
            <div className="text-[0.95vw] text-muted leading-[1.65]">
              نعم. نُصدر فواتير ضريبية إلكترونية متوافقة مع المرحلة الثانية، تتضمّن رمز QR وفق المواصفة، مع تكامل مباشر مع بوّابة فاتورة.
            </div>
          </div>

          <div className="border border-line p-[1.6vw]">
            <div className="flex items-start gap-[0.8vw] mb-[1.2vh]">
              <div className="text-[1.2vw] font-bold text-accent leading-none mt-[0.3vh]">02</div>
              <div className="text-[1.15vw] font-bold text-text leading-[1.35]">
                كم تستغرق عمليّة التهيئة الأولى؟
              </div>
            </div>
            <div className="text-[0.95vw] text-muted leading-[1.65]">
              معالج التهيئة الموجّه من 5 خطوات يكتمل عادة في أقل من 30 دقيقة: بيانات الشركة، الفروع، المخزون، المستخدمون، والربط الضريبي.
            </div>
          </div>

          <div className="border border-line p-[1.6vw]">
            <div className="flex items-start gap-[0.8vw] mb-[1.2vh]">
              <div className="text-[1.2vw] font-bold text-accent leading-none mt-[0.3vh]">03</div>
              <div className="text-[1.15vw] font-bold text-text leading-[1.35]">
                هل تدعمون الفروع المتعدّدة والشركات المرتبطة؟
              </div>
            </div>
            <div className="text-[0.95vw] text-muted leading-[1.65]">
              نعم. عزل بيانات لكل شركة عبر <span className="font-mono text-text">scopedDb</span>، مع وحدة المعاملات بين الشركات التي تُنشئ القيد المرآة آليًا في الشركة المقابلة.
            </div>
          </div>

          <div className="border border-line p-[1.6vw]">
            <div className="flex items-start gap-[0.8vw] mb-[1.2vh]">
              <div className="text-[1.2vw] font-bold text-accent leading-none mt-[0.3vh]">04</div>
              <div className="text-[1.15vw] font-bold text-text leading-[1.35]">
                كيف تعمل ميزة استخراج فواتير الموردين بالذكاء الاصطناعي؟
              </div>
            </div>
            <div className="text-[0.95vw] text-muted leading-[1.65]">
              صوّر الفاتورة بالجوال أو ارفعها كصورة، فيستخرج نموذج <span className="font-mono text-text">gpt-5-mini</span> رؤية: اسم المورّد، البنود، الضريبة والإجمالي خلال ثوانٍ.
            </div>
          </div>

          <div className="border border-line p-[1.6vw]">
            <div className="flex items-start gap-[0.8vw] mb-[1.2vh]">
              <div className="text-[1.2vw] font-bold text-accent leading-none mt-[0.3vh]">05</div>
              <div className="text-[1.15vw] font-bold text-text leading-[1.35]">
                هل بياناتي محميّة ومن يطّلع عليها؟
              </div>
            </div>
            <div className="text-[0.95vw] text-muted leading-[1.65]">
              نظام صلاحيات من 8 أدوار مع 14 حارسًا على الخادم، جلسات مشفّرة، حماية CSRF، وسجل تدقيق كامل لكل عمليّة حسّاسة.
            </div>
          </div>

          <div className="border border-line p-[1.6vw]">
            <div className="flex items-start gap-[0.8vw] mb-[1.2vh]">
              <div className="text-[1.2vw] font-bold text-accent leading-none mt-[0.3vh]">06</div>
              <div className="text-[1.15vw] font-bold text-text leading-[1.35]">
                هل أستطيع تجربة النظام قبل الاشتراك؟
              </div>
            </div>
            <div className="text-[0.95vw] text-muted leading-[1.65]">
              نعم. اشترك مجانًا، أنشئ شركة تجريبيّة، واستعرض كل الوحدات ببيانات وهميّة. لا حاجة لبطاقة ائتمان للبدء.
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[7vh] right-[7vw] text-[1vw] text-muted">
        حاسبة.AI — منصّة تخطيط موارد المؤسسات
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] text-[1vw] font-semibold text-text">27</div>
    </div>
  );
}
