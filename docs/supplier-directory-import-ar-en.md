# استيراد دليل الموردين / Supplier directory import

## الإغلاق والنطاق

أُغلقت مهمة واحدة: إنشاء سجلات دليل موردين جديدة منCSV وXLSX عبر صفحة
الموردين الأصلية. لا تحديث أو دمج تلقائي، ولا استيراد أرصدة أو فواتير أو
قيود أو بنوك أو روابط شركات، ولا استيراد عملاء. لا ادعاء باكتمالERP.

البدء من `1b0ae2d9b4ef49ec001a9a1f5e810048958759cc` بشجرة نظيفة ومطابقة
GitHub، والحفاظ على جميع التسليمات السابقة. المستودع
`Abdullah-Almutairi12/Hasiba`، الفرع `sync/hasiba-erp-20261023`.

المصدر التنفيذي المختبر:
`b741ddeaec5badf2684e4bc35ede12d790e3295a`.
بصمة التنفيذ:
`6c6ec841aa91855af11cff878ce082767114dcaec4ce05aae813c3cf63f631be`.
الخادم ورحلة المتصفح وبوابات المشروع على البصمة نفسها. لم يتغير المصدر
بعد الاختبار؛ تقارير التسليم وفهرسةLibrary لاحقة ولا تدخل بصمة التنفيذ.

لم يُعدّلmain، ولم يحدث نشر أو استخدام بيانات تشغيلية أو إرسال أو دفع
خارجي. يبقى `TAX_POLICY_NOT_READY` قائمًا. لا تغيير للعرض الاستثماريPDF.

## الاستخدام وما نُفّذ

1. افتح «الموردون» ثم «استيراد موردين» عند امتلاك صلاحية إنشاء المورد.
2. نزّل نموذجCSV أو اخترCSV UTF-8 أوXLSX بورقة واحدة.
3. اربط كل عمود بأحد: الاسم، الرقم الضريبي، البريد، الهاتف، العنوان، الملاحظات.
   الاسم وحده إلزامي؛ احذف الأعمدة غير المدعومة من الملف بدل إسقاطها بصمت.
4. اعرض المعاينة: كل الصفوف والقيم والأخطاء والتكرارات. لا تُحفظ سجلات فيها.
5. إذا ظهر اسم مطابق، راجع المورد المقترح ومعرفه ورقمه، ثم أكد إنشاء سجل
   مستقل وأعد المعاينة صراحة. ليس ذلك إثباتًا لاتحاد الهوية أو دمجًا.
6. أكّد الحفظ الكامل. تُعرض نتيجة محفوظة بمعرّفات الموردين، وتتحدث القائمة.

حدود القارئ الأصلي نفسها:256KiB،500 صف بيانات،12 عمودًا،128 حرفًا للخلية.
CSV يدعم الفاصلة أو الفاصلة المنقوطة والاقتباس العربي/المختلط. فحوصZIP
وحدود فك الضغط والصيغ والروابط والخلايا المركبة في القارئ القائم لم تُخفف.
لم تُحفظ بايتات الملف أوbase64 في قاعدة البيانات؛ إيصال المحاولة يحفظ النتيجة.

الأرقام النصية تحفظ أصفارها الأولى؛ خليةExcel الرقمية تُرفض بدل تخمين
قيمتها أو أصفارها. التعليمات تطلب إعادة إدخالها من المصدر الأصلي كنص، وليس
مجرد تغيير التنسيق بعد ضياع الدقة. CSV لا يحمل تاريخ تنسيقExcel: فقدٌ
وقع قبل تصديره إلى نص لا يمكن إثباته أو استعادته آليًا من الأرقام وحدها.

الرقم الضريبي غير الفارغ يحتفظ بمعناه الحرفي كما في الدليل المقبول سابقًا،
ولا يضيف هذا العمل تطبيعًا تاريخيًا أو قاعدة تحقق قانونية لدولة جديدة.
الرقم المفقود يصبحNULL، وليس حكمًا على التسجيل. لا يولّد الاستيراد ضريبة
أو فاتورة أو تسجيلًا. تأخذ حقول إعداد المشتريات غير المستوردة افتراضات
المخطط السابقة، لا قيمًا مالية أو ضريبية من الملف.

## الصلاحيات والهوية والمحاولات

- استخدمت صلاحية `procurement.suppliers.create` القائمة للمعلومات والقراءة
  الأولية والمعاينة والتنفيذ، وصلاحية `.read` المناسبة للاسترجاع والإغلاق.
- لا صلاحية جديدة أو مسمى إلزامي؛ تشمل المسؤوليات المدارة ووراثة القالب
  والمنع الفردي. لا صلاحيات صرف أو قيود أو استلام أو أرصدة ضمنية.
- الشركة والمستخدم من الجلسة الموثوقة؛ الطلبات ذات الحقول الزائدة مرفوضة،
  وعمود الشركة أو الرصيد/البنوك لا يمكن تهريبه بربطه بحقل الملاحظات.
- بقي القيد0073 المركب على الشركة والرقم. تكرار الرقم داخل الملف أو
  الشركة يمنع الدفعة، ويُعرض المورد المتعارض دون تعديل بياناته.
- المعاينة الموقعة مرتبطة بالشركة والمستخدم والمحتوى وغرض الاستيراد
  وبصمة التشابه الذي روجع؛ تنتهي بعد15 دقيقة. تغير التشابه يبطل التنفيذ.
- يسبق قفل الجدول إعادة فحص الأهلية والتعارضات. الحفظ ذري، جميع الصفوف
  أو لا شيء؛ القيد الفعلي يحمي أيضًا من الكتاب الأصليين.
- المعرف والجسم والهوية المختارة للمسؤولية تُحفظ قبل الإرسال في آلية
  المحاولة القائمة. لا تعديل مع محاولة مجهولة، ولا مسح بناءً علىHTTP.
- الاستعلام لا ينفذ طلبًا غائبًا. الإغلاق يحفظ إيصال منع دائمًا تحت
  القفل الأصلي؛ الطلب المتأخر لا ينفذ بعده. المكتمل لا يمحوه الإغلاق.
- بعد إعادة التحميل يمكن استرجاع النتيجة، مع مقارنة المعرف قبل تنظيف
  التخزين حتى لا تُحذف محاولة أحدث. سحب القراءة لا يثبت عدم التنفيذ.
- تفصل تواقيع الغرض الموردين عن الأصناف؛ تستمر قراءة معاينات الأصناف
  القديمة التي سبقت حقل الغرض بوصفها معاينات أصناف.

## العيوب التي كُشفت وعولجت أثناء البناء

قبل التعديل نجحت8 اختبارات الموردين/الترقية القائمة في قاعدة منفصلة.
أول تشغيل للشريحة الجديدة:55 ناجحًا و6 إخفاقات من61، وليس6 عيوب تطبيق:

* خطأ في مُصالِح الاختبار طلب عمودid غير الموجود في جدول الإيصالات؛
  صُحّح إلى المفتاح الفعلي دون تغيير مخطط التطبيق.
* مسار الاستيراد الأول احتفظ بقفل عضويةFOR SHARE قبل انتظار جدول
  الموردين، فحُجبت عملية سحب الإذن وتتابعت5 مهلات اختبارات مرتبطة.
  لم يكن ذلك فشلًا في التسليم السابق. أثبتته حالة انتظارPostgreSQL الفعلية.
* صُحح فحص البداية ليكون خارج المعاملة، ثم أُعيد الفحص بعد قفل الجدول.
  لمنع انعكاس ترتيب أقفال الكتاب القائمين، يُجرّب قفل سلطة الاعتماد دون
  انتظار وهو ممسك بالجدول؛ إن لم يتوفر تُرفض المحاولة ذريًا وتبقى محفوظة
  للاسترجاع أو الإغلاق. لا تخفيف لمنع أو صلاحية.

نجحت بعدها62/62 في4 ملفات:15 حالة استيراد موردين،29 استيراد أصناف،
7 هوية مورد،11CSV. أضيفت حالة انتهاء المعاينة إلى المصدر النهائي؛ يحتوي
فحصه الشامل16 حالة استيراد موردين. الاختبارات الموجهة أجزاء من الإجمالي.
تعثر توليد العقد أولًا بسبب اقتباس وصفYAML يحوي فواصل، ثم نجح التوليد
وفحص الأنواع؛ لا واجهة مخادعة بدل وظيفة مطلوبة.

## نتيجة التشغيل النهائي الجديد

البداية `2026-11-03T05:48:18Z`، النهاية `2026-11-03T06:06:18Z`،
أي08:48:18–09:06:18 بتوقيت الرياض. رمز الخروج **0**.

| الفحص | النتيجة الجديدة |
|---|---|
| بوابات المشروع | **15/15 ناجحة** |
| API | **1201 ناجح /0 فشل /1 متجاوز مشروط**،98 ملفًا |
| UI | **385 ناجح /0 فشل /0 متجاوز**،69 ملفًا |
| ترقية التطبيق السابق المستقلة | ناجحة؛ الحالة المشروطة مغطاة في تشغيلها المستقل |
| الأنواع وكتالوج الاختبارات وفحوص أدلة التنظيف | ناجحة |
| بناءAPI وERP والدليل والعرض وsandbox | ناجح |
| تدقيق الاعتماديات وثبات المصدر | ناجح |

لم تُجمع نتائج المجموعات الفرعية فوق1201/385. لم تُعد البوابات بعد نجاحها،
ولم يُستخدم قبول161cd6d أو747e5a5 القديم كأنه قبول الاستيراد الجديد.

## رحلة المتصفح الأصلية والمصالحة

حسابان اصطناعيان في الشركتين6 و7، دخول عادي، لا تجاوز مصادقة.

| الحالة | الدليل الفعلي |
|---|---|
| CSV عربي باسم فارغ | صف صالح وآخر خاطئ؛ التأكيد معطل ولا تنفيذ |
| XLSX بخانة رقمية فقدت الدقة | خطأ إرشادي ونص مطلوب؛ التأكيد معطل |
| CSV صحيح بأعمدة مختلفة | معاينة كاملة والأصفار محفوظة؛ حفظ المعرفين7 و8 |
| فقد الرد بعد الحفظ | طبقة نقل اختبارية رصدت200/completed ثم قطعت الرد؛ الواجهة أبقت المجهول، وبعد إعادة التحميل استرجعت7 و8 بالمعرف والرمز الأصليين |
| XLSX وتشابه اسم بلا رقم | موافقة صريحة ثم معاينة ثانية؛ سجلان جديدان9 و10، لا دمج مع7 |
| منافس بعد المعاينة | إنشاء مورد11 من الواجهة الأصلية في تبويب آخر؛ تنفيذ المستورد409 واستعلامه409 ثم إغلاق200 |
| متابعة العمل بعد الرفض | محاولة جديدة مختلفة؛ حفظ المورد12 دون مسح يدوي للتخزين |
| الشركة الثانية | قائمة فارغة قبل الاستيراد؛ الرقم نفسه مقبول بسجل13 مستقل، والقائمة لها وحدها |

الموردون المستوردون6 في4 دفعات مكتملة، ومعهم سجل منافس واحد يدوي في الاختبار.
إيصالات الاستيراد5:4 مكتملة وواحد مغلق. لا ازدواج بعد فقد الرد.
أرصدتهم جميعًا0.00 بنصSQL، ولا تكرار رقم محلي. كل الموردين السابقين،
بما فيهم السجل المرجعي ذو الرصيد7.25، بقوا مطابقين حرفيًا.

المصالحة مستقلة للقراءة فقط فيREPEATABLE READ، بصمات جميع228 جدولًا.
27 جدولًا ماليًا/مخزنيًا محميًا لم يتغير مطلقًا. ظهر اختلاف في جدولي
السنة والفترة عند المقارنة الأولى: إعادة تشغيل الخادم الاصطناعي شغّلت
المهيئ الأصلي للشركتين الجديدتين، فأضاف4 سنوات فارغة و52 فترة **قبل**
أول استيراد. ليست قيودًا أو حركة مخزون أو فواتير.

لم تُسقط حماية الجدولين لتجاوز الإخفاق: حُفظ التشخيص الأول، وأُعيد بناء
البصمة الدقيقة لكل الصفوف الأصلية بعد فصل الإضافات الأربعة المعروفة
ومراجع فتراتها. تطابقت أعدادها وبصماتها مع الأصل، وتحققت الأوقات وحالة
الإضافات المفتوحة. نتيجة29 فحصًا محميًا: **لا تغير غير مفسر**، ولا تغير
في الأرصدة والفواتير والقيود والمخزون السابقة.

## الأدلة والحدود ونقطة الاستئناف

التقرير محفوظ هنا، والمخرجات المنقحة تُسلّم منفصلة عنGit فيWord وZIP.
تشمل السجلات قبل/بعد، المصدر، نتائج البوابات، رحلة الواجهة والصور،
وسجل النقل، وفقد الرد، والمصالحة وتشخيص تهيئة التقويم، وبيان بصمات الملفات.
الصور المتاحة نُسخت إلى الحزمة؛ بعض معرفات الصور غير المتاحة لم تُختلق.

طبقة النقل الاختبارية محلية أمام التطبيق الأصلي بلا تغيير خدماته أو
صلاحياته، وتقطع ردًا واحدًا فقط بعد200/completed. تعثر تجهيزها أولًا
في مسار اعتماد اختبار ثم في منفذ مشغول، لا في كود المنتج؛ عولج ذلك
باعتماد المنفذ الحلقي المخصص تلقائيًا، والتحقق من الاستجابة الفعلية.
الحجب الضريبي لم يُلغَ.

حدود الدليل: معاينتا الرفض الأوليان لهما صور لا حالةHTTP ملتقطة في
المتصفح؛ اختباراتAPI الدائمة تغطي الرفض. تنزيل النموذج كنقر وتحميل
نظام فعلي لم يوثَّق؛ اختُبرت بايتات نموذجه وبنيته بوحدات الواجهة.
لم يُختبرWord المكتبي أوSafari/Windows فعلي أو طباعة ورقية أو زاتكا/دفع
أو بريد حي أو نشر أو ترحيل إنتاجي.

لا عيب معلوم متبقٍ في نطاق الاستيراد المثبت. لا بدأ تلقائيًا لاستيراد
العملاء/الأرصدة أو نطاق آخر. نقطة الاستئناف مراجعة التسليم عند الطلب.
المرجع السابق محفوظ في تاريخ الفرع، ولا يجوز إبطال تفرد الشركة السابق
بإجبار قيد عالمي أو تغيير أرقام الموردين. إثبات الرفع فيgit-sync.json
داخل الحزمة؛ قد يليه فهرسLibrary فقط، ويُذكر آخرSHA في رسالة التسليم.

## English delivery report

Implemented one create-only supplier directory import in the existing suppliers
page: CSV/XLSX upload, explicit column mapping, full row/error/conflict preview,
similar-name acknowledgement and second preview, atomic confirmation and durable
outcome. Name is required; VAT,email,phone,address,notes are optional. No existing
supplier updates/merges, balances,invoices,banking,intercompany links or customer
imports. No new role system or implicit financial authority.

The shared safe reader and durable intent/receipt engine were reused. Reviewed
content, actor,company,purpose and exact similar-name facts are signed. Execution
rechecks permissions and conflicts after the relation wait. A nonblocking
authority-fence acquisition avoids a cycle with existing fence-first writers.
Denials never authorize deleting unknown attempts. Recovery uses read authority;
closure is durable and rejects delayed execution.

Baseline8 tests passed on the prior release. The first new suite had55 passes
and6 failures: one receipt-column test-fixture mistake and a genuine new
membership/relation lock-order defect causing five dependent timeouts. Both were
corrected without weakening assertions. Next targeted run62/62 passed; an expiry
case was then added to the final16 supplier-import cases. Focused counts are
subsets, not added to final totals.

Fresh final run2026-11-03T05:48:18Z–06:06:18Z, exit0:15/15 gates,
1201 API passed/0 failed/1 conditional historical-upgrade skip,
385 UI passed/0 failed. Independent historical upgrade, types, builds and audit
passed. Executable commit b741ddeaec5badf2684e4bc35ede12d790e3295a and
fingerprint6c6ec841aa91855af11cff878ce082767114dcaec4ce05aae813c3cf63f631be
match the native test host and browser-served source. Later docs/index commits
do not change executable bytes.

Native UI proved both formats, real post-commit response loss followed by reload
and exact recovery, explicit name-review without merging, a competing native
supplier creation followed by409/recover409/safe-close200 and successful new
intent, and independent company reuse of the same VAT. Six imported rows in four
completed batches plus one controlled manual competitor, all balances0.00,
five durable receipts including one closure. Existing suppliers unchanged.

Independent read-only SQL hashed228 tables.27 protected financial/stock tables
were byte-for-byte unchanged. Two fiscal metadata tables gained4 empty years and
52 periods from the original initializer on isolated-host restart BEFORE the
first import. Their original-row hashes were reconstructed and match baseline;
the initial mismatch is retained, not hidden or passed by ignoring the tables.
No unexplained change among29 protected checks. No financial posting, stock,
invoice or original supplier balance was altered.

Limitations: numeric Excel cells rejected; historical digit loss before CSV text
export cannot be inferred/recovered. VAT strings keep the existing literal
identity policy, not new legal validation/canonicalization. Similar-name review
is exact trimmed-name matching, not a fuzzy identity assertion. Negative native
preview HTTP statuses and actual OS template download were not captured; visual
and API/unit evidence are distinguished. No live service,production deployment,
real customer data,device acceptance or whole-ERP completion is claimed.
