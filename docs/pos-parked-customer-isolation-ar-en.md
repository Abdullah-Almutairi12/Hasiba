# عزل عميل الطلب المعلّق عن السلة التالية / Parked-customer isolation

## النتيجة العربية

أُغلق الإصلاح ضمن شاشة POS المحددة، دون تغيير محرك البيع أو التعليق أو الصلاحيات أو المستودعات أو الضرائب.

### الخلل والإصلاح
- قبل الإصلاح: تأكد تعليق العميل أ، وفرغت السلة لكن بقي اختياره ظاهرًا للسلة الجديدة. أُعيد ذلك فعليًا في الواجهة قبل تحديث Vite.
- بعد رد تعليق ناجح، تمسح الواجهة اختيار العميل للسلة النشطة فقط. هوية العميل تبقى في مسودة الخادم، ويعيدها مسار الاستئناف الأصلي.
- عند رفض التعليق تبقى السلة والعميل. وعند ضياع الرد تبقيهما الواجهة وتعرض رسالة «تعذر تأكيد التعليق» وتحدّث قائمة المعلّقات للقراءة، دون افتراض الفشل أو نجاح البيع.
- لم يتغير جسم أو مفتاح محاولة التحصيل المحفوظة، ولم تُمنح صلاحيات دليل إضافية.

### الإثبات الجديد
| الفحص | النتيجة |
|---|---|
| انحدار قبل الإصلاح على شيفرة POS عند 9e02c54 | فشل واحد، نجاحان، 29 حالة غير مختارة؛ وخطأ نقل غير معالج في حالة الرد الضائع |
| بعد الإصلاح: كامل ملف POS واختبارات منتقي العميل | 35 ناجحًا، صفر فشل؛ منها 3 حالات جديدة، وليست إضافة إلى إجمالي الواجهة أدناه |
| بوابات المشروع الكاملة | 15/15، رمز خروج 0 |
| API | 1253 ناجحًا، 0 فشل، 1 متجاوزًا مشروطًا |
| UI | 440 ناجحًا، 0 فشل |
| الترقية المستقلة | بوابة migration-upgrade ناجحة؛ راجع سجلها الخام |
| المصالحة المستقلة | 49 تحققًا ناجحًا، صفر فشل |

التجاوز المشروط في API يخص مرجع الترقية المثبت عندما لا يزوَّد ضمن التشغيل العام؛ بوابة الترقية المنفصلة شغّلته. لا تُجمع أعداد البوابات الجزئية مع إجمالي API أو UI.

### رحلة الواجهة الأصلية وقاعدة PostgreSQL المعزولة
شركة الاختبار الجديدة 12، الفرع 14، الكاشير 27، الوردية الأصلية 34، الصنف 10، والعميل أ = 5. لا علاقة لرصيد هذه الشركة برصيد السوبرماركت V2 في الشركة 11.

| المرحلة | النتيجة المثبتة |
|---|---|
| التعليق قبل الإصلاح | المسودة 3 / POS-PARK-2026-00001 تحفظ العميل 5؛ لا بيع أو فاتورة |
| الاستئناف وإعادة التعليق بعد الإصلاح | المسودة 4 / POS-PARK-2026-00002 تحفظ العميل 5؛ السلة فارغة واختيار العميل عام |
| بيع نقدي مستقل | الطلب 5 بلا customerId؛ الفاتورة 4 / PINV-2026-00003 للعميل النقدي 6؛ السند RCT-2026-00003؛ 100 ريال |
| استئناف أ وإتمامه | الطلب 6 للعميل 5؛ الفاتورة 5 / PINV-2026-00004 للعميل 5؛ السند RCT-2026-00004؛ 100 ريال |
| أثر التعليق وحده | صفر فواتير/سندات/دفعات؛ المخزون 20؛ قيد الافتتاح الوحيد لم يتغير |
| بعد البيعين | فاتورتان وسندان ودفعتان نقديتان فقط؛ المخزون 18 وقيمته 900؛ النقد 200؛ المبيعات 200؛ التكلفة 100؛ الذمم والضريبة صفر |

القيود 21–27 متوازنة ومرحّلة: قيد افتتاح واحد وثلاثة قيود لكل بيع (الإيراد والتحصيل والتكلفة)، دون قيد تعليق. حركات الصنف: استلام تهيئة 20 ثم صرف 1 ثم 1.

قورنت 15 مجموعة مالية ومخزنية من تجربة V2 بالتسليم السابق، وتطابقت: رصيد الأرز 8 وإقفال الصندوق 117 محفوظان. لا تعديل في main أو نشر أو دفع خارجي أو مهمة أجهزة.

### المصدر والتوقيت وحدود الدليل
- [الشيفرة المختبرة](https://github.com/Abdullah-Almutairi12/Hasiba/commit/3d68f6874714ca559d23bca627597d310a655787)، الفرع sync/hasiba-erp-20261023.
- بصمة التنفيذ: `1b77a1bf1feeb9f31df9806aea27d41546d6e39c1be422ea639d1a4f65dc30b6`.
- التشغيل الجديد: 2026-11-04T06:22:03.129Z إلى 2026-11-04T06:40:34.498Z، UTC، رمز خروج 0؛ كان المصدر نظيفًا وبقي ثابتًا أثناء التشغيل.
- واجهة المتصفح: 3d68f6874714ca559d23bca627597d310a655787. الخادم المعزول ظل محمّلًا عند aaa377b9ff81c00383ee3e88b5817a1b394b6682؛ أُثبت انعدام الفرق في الخادم والمكتبات والاعتماديات والبرامج بينه وبين المصدر المختبر. ليست هذه دعوى تطابق SHA كامل للخادم والواجهة.
- أثبتت الرحلة العميلين من مستندات PostgreSQL، لا من نص زر فقط. لا يعرض Stagehand أجسام HTTP الخام؛ لذلك لا ندّعي التقاطها. اختبار الانحدار الدائم يفحص أجسام طلبات البيع فعلًا.
- الرفض وضياع رد التعليق وثبات هوية محاولة التحصيل غُطّيت باختبارات الواجهة الدائمة؛ لم تُحقن أعطال شبكة في رحلة المتصفح الجديدة. لم تختبر طباعة ورقية أو أجهزة أو دفعًا خارجيًا.
- صور المتصفح متاحة بمعرّفات الاختبار في `native-report.md` و`screenshots-index.json`؛ لا ندّعي وجود ملفاتها الثنائية داخل الحزمة.
- أثناء التهيئة صُحّح مسار حفظ مساعد واختيار عمود في استعلام مصالحة، قبل الإثبات النهائي. فحص أنواع تمهيدي انقطع بحد أداة 60 ثانية؛ بوابة typecheck النهائية هي دليل الأنواع المعتمد، لا تلك المحاولة.
- احتُفظ بسجل أصول Library المحلي السابق ضمن commit الإصلاح. التقارير وملفات الإثبات اللاحقة لا تغير شيفرة التنفيذ. سجلات API/واجهة V2 السابقة ليست نتائج هذا التشغيل.

الملفات التنفيذية المعدلة: `artifacts/erp-system/src/pages/pos-iconic.tsx` واختباره `pos-iconic.test.tsx`. لا عيب مثبت متبقٍ في معايير هذه الشريحة، ولا ادعاء بخلو ERP كله من الأخطاء. يبقى TAX_POLICY_NOT_READY وحدود النطاق السابقة كما هي.

## English summary

Fixed the active-customer leak after confirmed parking. Only the next basket's selection is cleared; the parked server draft retains customer A. Rejected or unknown parking keeps the original basket/customer, and a lost response is explicitly reported as unconfirmed. Native resume and frozen payment-intent identity were preserved.

The original UI journey in isolated company12 produced exactly two cash sales: order5/invoice PINV-2026-00003 belongs to the walk-in cash customer6, while resumed order6/invoice PINV-2026-00004 belongs to customerA5. Both were100 SAR. Parking alone created no invoice, payment, movement or additional journal. Independent SQL proves stock20→18/value900, cash200, revenue200, COGS100, AR0 and VAT0, with all seven journals balanced. All15 V2 financial/inventory groups remain unchanged, including rice8 and closingcash117.

Fresh verification on `3d68f6874714ca559d23bca627597d310a655787`:15/15 gates, exit0; API1253 passed/0 failed/1 conditional skip; UI440 passed. The35 focused tests and 49 independent reconciliation assertions are subsets/separate evidence, not additions to suite totals. The separate pinned upgrade gate passed. Before-fix regression failed once and exposed an unhandled lost-park-response error; after-fix focused tests all passed.

Browser source is the tested commit; the isolated backend was loaded at `aaa377b9ff81c00383ee3e88b5817a1b394b6682` and its backend/library/dependency bytes are identical to the tested source. Raw HTTP bodies were not exposed by the browser tool; request-body assertions are in the permanent tests, and PostgreSQL documents prove the native results. Fault injection is covered in automated tests, not newly injected in this browser journey. Screenshot IDs are retained, but their remote image binaries are not included in the archive. No physical printing/devices/external payment, main change or production deployment. No known unclosed defect within this bounded acceptance.
