# تصحيح تحديد وردية POS / POS shift-selection correction

## الهوية والنطاق
- المستودع: `Abdullah-Almutairi12/Hasiba`.
- الفرع: `sync/hasiba-erp-20261023`.
- البداية: `df21572541e511930dab55684487d0af384f7da6`، شجرة نظيفة ومحلي/بعيد متطابقان عند الفحص.
- حُفظ الإصلاح السابق `3849d10` وسجله؛ لا إعادة بناء لمحرك فتح الوردية أو المحاولات أو الصلاحيات.
- مصدر الشيفرة لهذه الشريحة: `e55f3e649a6c677d7a228a061d7ec2f432178b0c`.
- بصمة التنفيذ: `8e0e0ca1af9d9d57a0801150229a738bf0dff0891f9de8d0f8165dbabb577128`.
- لا main أو نشر أو بيانات تشغيلية أو دفع/إرسال خارجي. لا ترحيل أو تغيير مخطط أو اعتماديات أو قيد جديد يمنع تعدد الورديات.

## العيب المثبت والإصلاح
كان المحدد يرجع بلا نتيجة فور عدم العثور على الاختيار المحفوظ، ولو كانت وردية أخرى مؤهلة مفتوحة. وكان غياب الاختيار النهائي، بما فيه حالة التعدد، يعامل في الشاشة كغياب ورديات.

أصبح المسار يفصل قائمة الورديات المؤهلة عن الوردية المحددة:
1. الاختيار المحفوظ الصالح يبقى هو الاختيار، دون استعارة أول صف في القائمة.
2. عند بطلانه ووجود وردية مؤهلة واحدة، تستخدم ويحدث الاختيار المحفوظ بعد قراءة ناجحة.
3. عند التعدد دون اختيار صالح، تعرض «اختر الوردية» مع المرجع ووقت الفتح بتوقيت الرياض؛ يختار الموظف صراحةً ويحفظ الاختيار لاستعادته بعد التحميل.
4. وجود أي وردية مؤهلة يحجب الفتح الجديد في العرض وداخل معالج الإرسال. لا يتاح فتح جديد إلا بعد نجاح القراءة وإثبات عدم وجود وردية مؤهلة، مع الإذن والنطاق القائمين.
5. الشارة تعرض «جارٍ التحقق من الوردية» أثناء القراءة و«تعذر التحقق» عند الفشل. «لا توجد وردية مفتوحة» تخص القراءة الناجحة الخالية فقط؛ يعرض غياب الفرع طلب اختيار الفرع، لا إثبات غياب الوردية.
6. استرجاع طلب الفتح المحفوظ يبقى مقدمًا على إنشاء طلب جديد، بالمفتاح والجسم والمسؤولية الأصليين.

التصفية المحلية تستعمل بيانات الخادم المصرح بها وتفصل الفرع والكاشير؛ لم تتغير تصفية الشركة أو الجهاز أو المسؤولية في الخادم. بقي مسار توافق الورديات القديمة بلا هوية كاشير، دون تعديل سجلات تاريخية أو منح وصول جديد في الخادم.

## الملفات
- `artifacts/erp-system/src/lib/pos-session-context.ts`
- `artifacts/erp-system/src/pages/pos-iconic.tsx`
- اختباراهما الدائمان في `pos-session-context.test.ts` و`pos-iconic.test.tsx`.
- قاعدة قرار المنتج في `.agents/memory/product-scope.md` وهذا التقرير.
- مساعدا البيانات/الاستضافة المعزولة وسجلات الأدلة في `generated-artifacts/pos-shift-selection/`؛ نواتج مولدة مستثناة من Git وليست ملفات مرفوعة إلى المستودع.

## إثبات قبل وبعد
`ui-before.log`: اختبارات الانحدار الجديدة على تنفيذ البداية قبل إصلاحه؛ أربع حالات فاشلة و20 مستبعدة بمرشح الاسم، خروج 1. الحالتان الوظيفيتان أثبتتا إرسال **POST واحد بدل صفر**: المحفوظة 9 مغلقة و42 مفتوحة، وورديتان مفتوحتان بلا اختيار صالح. فحصا الشارة لم يجدا الشارة الموحدة الجديدة؛ مقتطف DOM والسلوك القديم يعرضان غياب الجلسة أثناء التحميل/الفشل.

`ui-after.log`: **28 ناجحًا، صفر فاشل** في الملفين كاملين. لا تضاف هذه المجموعة الفرعية إلى إجمالي الواجهة.

يشمل الفحص الاختيار القديم، والتعدد والاختيار الصريح وإعادة التحميل، وعدد طلبات الإنشاء، وحجب التحميل والفشل وإعادة التحقق، وعدم إظهار ورديات كاشير/فرع آخر، وعزل الاختيارات بحسب المستخدم والشركة والمسؤولية، وفتح الوردية المسموح عند غيابها، واسترجاع الجسم والمفتاح الأصليين.

ظهر أثناء التطوير فشلان في تأكيدين قديمين: أحدهما كان يتوقع عدم الاسترداد بمجرد وجود اختيار غير صالح، والآخر كان يتوقع صياغة الشارة القديمة. حدّثا إلى السلوك المطلوب مع بقاء اختبارات عدم استعارة وردية كاشير آخر ومنع الطلبات. السجل الوسيط `ui-directed.log` محفوظ منفصلًا عن النجاح النهائي.

## الواجهة الأصلية ومصالحة PostgreSQL المستقلة
استُخدم تسجيل الدخول الأصلي و`/pos` على قاعدة اصطناعية مخصصة؛ لا حساب عميل. الإعداد السيناريوي أنشأ سجلات اختبار فقط، وليس فتحًا عبر الواجهة:
- شركة 6، فرع 6 «جدة — نقاط البيع»، مستخدم 7.
- المحفوظة المغلقة 28؛ المفتوحة الوحيدة 29. أعادت الشاشة اختيار 29 وحفظته، دون POST فتح.
- أضيفت مفتوحة ثانية 30 فقط لإعداد حالة التعدد. سجلت قراءة مستقلة قبل الإضافة عدم تغير حالة السيناريو الأول.
- أعيد الاختيار القديم 28 للاختبار؛ ظهرت قائمتا 29 و30 مع المرجع ووقت الفتح، دون فتح بديل.
- اختيرت 29 أولًا من القائمة، ثم اختيرت **القيمة 30** صراحة في متابعة محددة، وليس حسب ترتيب الصف. استقرت 30 بعد إعادة التحميل في الواجهة والتخزين.
- المرجع النهائي: `CHOICE-B-c09feeeb-9f83-411c-a9a9-9a502736e4ca`.
- `reconciliation.json` في `2026-11-04T01:50:04.862Z`: كل حقول الصفوف الثلاثة مطابقة للقطة ما بعد إعداد التعدد؛ ورديتان مفتوحتان وواحدة مغلقة، وإيصالات فتح **0 قبل/بعد**. رقم الوردية المختارة ومرجعها يطابقان صف PostgreSQL.
- النقل الملتقط: **0 POST فتح**؛ عدد GET يتزايد بسبب التحديث الدوري وليس مؤشرًا لإنشاء ورديات.

`native-report.md` يحفظ الرحلة والمتابعة. افترض التقرير الأول أن «(الرياض)» اسم الفرع؛ صُحح ذلك في ملحقه: هي منطقة توقيت العرض، والفرع ظل جدة. وحُسمت قراءة ترتيب الصف باختيار القيمة 30 صراحة. لا عيب منتج من هاتين الملاحظتين.

## البوابات النهائية
التشغيل الجديد بدأ `2026-11-04T01:44:08Z` وانتهى `2026-11-04T02:02:38Z`، **رمز الخروج 0**، على المصدر النظيف أعلاه، بعد نهاية الفحوص الموجهة:

| الفحص | النتيجة الفعلية الجديدة |
|---|---|
| جميع البوابات | 15/15 |
| الأنواع | ناجح |
| API على PostgreSQL معزولة | 1252 ناجحًا، 0 فاشل، 1 تجاوز شرطي؛ 100 ملف |
| الواجهة | 428 ناجحًا، 0 فاشل، 0 متجاوز؛ 71 ملفًا |
| الترقية المستقلة من النسخة السابقة | 1 ناجح، 38 مستبعدة بمرشح الاسم |
| بناء API والواجهات وتدقيق الاعتماديات | ناجح |
| ثبات بصمة المصدر طوال التشغيل | ناجح |

التجاوز الشرطي في التشغيل الاعتيادي خاص باختبار ترقية النسخة السابقة الذي يشغّل مستقلًا؛ بوابته المستقلة نجحت في هذه الدورة نفسها. لا تضاف الفحوص الموجهة أو الترقية المستقلة إلى إجمالي API/UI.

السجلات الخام الجديدة و`summary.json` و`tests.json` وهوية المصدر تحت `generated-artifacts/pos-shift-selection/final-verification/`. لا تستخدم نتائج تسليم `3849d10` مكان نتائج هذه الدورة. انتهت عملية التحقق، ولم تبدأ دورة تحقق إضافية بعد النجاح.

## الرفع وتسليم الأدلة
رابط الشيفرة المختبرة: https://github.com/Abdullah-Almutairi12/Hasiba/commit/e55f3e649a6c677d7a228a061d7ec2f432178b0c

بعد جلب الفرع ومقارنة تاريخه، رُفع المصدر برفع عادي على الفرع نفسه وثبت تطابقه مع GitHub؛ Commit التسليم اللاحق يضيف هذا التقرير وتسجيل حزمة الأدلة فقط. رابط آخر رفع مؤكد وحالة تطابق المحلي/البعيد في رسالة التسليم النهائية، و`git-sync.json` يوثق رفع مصدر الاختبار. ليست الحزمة المولدة جزءًا من Git؛ تسلم كملف قابل للتنزيل في مكتبة المشروع مع التقرير الثنائي اللغة والسجلات المنقحة وصور الرحلة والمصالحة.

أغلقت هذه الشريحة ضمن نطاقها دون عيب نهائي معلوم أو مانع قبول متبقٍ. لا تعني هذه النتيجة اكتمال جميع وظائف POS أو ERP.

## حدود الدليل
- المتصفح أثبت رحلة الاختيار الأصلي وإعادة التحميل على كاشير اصطناعي مخول، لا جميع الأجهزة والمسؤوليات فعليًا.
- تحميل/فشل قراءة الوردية واسترجاع نية الفتح بالمفتاح والجسم الأصليين مثبتة باختبارات الواجهة الدائمة؛ لم تكرر أعطال الشبكة اختياريًا في رحلة المتصفح الجديدة.
- فحص الشركة والفرع والكاشير والجهاز والصلاحيات وسجل يفوق 20 صفًا يبقى ضمن اختبارات الخادم الأصلية عند تشغيل البوابات، لا بادعاء تجربة جهاز فعلي.
- لم تنفذ مبيعات أو قيود أو صرف في هذه الرحلة لأنها ليست نطاق إصلاح الاختيار. لم يفتح الحجب الضريبي العام `TAX_POLICY_NOT_READY`.
- مصدر المتصفح والخادم مطابق لمصدر الشيفرة المحفوظ أعلاه وبصمته؛ دليل Vite يجمع بصمة الوحدة المقدمة وهوية مساحة العمل، وليس SHA مضمّنًا في حزمة إنتاج.
- لقطة `public-login.jpg` تؤكد عمل صفحة الدخول العامة فقط؛ دليل الاختيار المحمي هو تقرير المتصفح وصوره الخمس والمصالحة، لا لقطة الزائر.
- لا ادعاء بخلو ERP كله من الأخطاء أو اكتمال قبول إنتاجي.

---

## English report
Baseline was clean local/remote `df21572` on the existing Hasiba synchronization branch, preserving accepted source `3849d10`.

Two regressions reproduced an unintended opening POST: a closed preferred shift masked the only eligible open shift, and multiple eligible open shifts without a valid preference were treated as no shift. The selector now separates eligibility from selection, recovers/persists a sole eligible shift, and requires explicit native selection when ambiguous. Every option identifies its reference and opening time in Asia/Riyadh. Both rendering and the fresh-opening handler block creation while any eligible shift exists. Valid saved preferences remain authoritative operating choices, not authorization evidence.

The status strip now distinguishes checking, failure, selection required and confirmed absence. Immutable saved-opening replay remains available. Existing backend tenant/device/cashier/branch/responsibility authorization and active-shift/history query remain unchanged. No database migration, package change, historical rewrite or global multiple-shift restriction was introduced.

Before-fix filtered run: **4 failed /20 title-filter exclusions**, including **1 unwanted POST instead of 0** in each functional regression. The status tests exposed the missing unified state badge. After-fix directed suite: **28 passed /0 failed** across the two full files, not added to final totals. Two intermediate assertions were updated because they encoded the old stale-preference behavior and old status wording; the raw intermediate failure log is retained separately.

New native journey used the original login and POS with synthetic PostgreSQL data. Closed preference 28 automatically became open shift 29. One additional synthetic open row 30 set up ambiguity; no opening endpoint was used for setup. The original chooser displayed both references/timestamps, blocked fresh opening, and persisted an explicit choice across reload. A narrow follow-up selected exact value **30** rather than its visual list position; native context, stored choice and database reference agreed. Read-only independent reconciliation at **2026-11-04T01:50:04.862Z** verified unchanged complete rows, **2 open +1 closed shifts**, **0 opening receipts before/after**, and **0 opening POSTs**. The tester's initial timezone/list-position interpretations are corrected in its preserved addendum, not product failures.

Test/browser/API source: `e55f3e649a6c677d7a228a061d7ec2f432178b0c`; execution SHA-256 `8e0e0ca1af9d9d57a0801150229a738bf0dff0891f9de8d0f8165dbabb577128`. Vite evidence attests served module bytes and working-tree identity, not an embedded production build SHA.

New full verification ran **2026-11-04T01:44:08Z–02:02:38Z**, **exit 0**: **15/15 gates; 1252 API passed /0 failed /1 conditional skip; 428 UI passed /0 failed /0 skipped; independent legacy upgrade 1 passed /38 title-filter exclusions**. Typechecking, all builds, dependency audit and source-unchanged also passed. The normal API conditional skip is the separately executed legacy-upgrade test; that independent gate passed in this same run. Directed subsets and upgrade counts are not added to API/UI totals. Previous delivery results are not reused and no extra verification cycle was started after success.

Tested code link: https://github.com/Abdullah-Almutairi12/Hasiba/commit/e55f3e649a6c677d7a228a061d7ec2f432178b0c . Normal push was completed after fetch/history comparison and remote equality was verified on the same branch; the subsequent handoff commit contains report/asset registration only. Final response provides the confirmed latest remote handoff SHA. Generated evidence is a downloadable sanitized ZIP, not falsely represented as Git-tracked output. The public-login screenshot proves only anonymous page availability; authenticated selection evidence is the native tester report, its five images and the database reconciliation. This bounded correction is accepted with no final known failure or acceptance blocker.

Browser evidence is bounded to selection/reload for the synthetic authorized cashier. Loading/error and immutable opening recovery are exercised by permanent UI tests, not newly injected browser network faults. Backend isolation/device/history tests belong to the full gate run, not real-hardware acceptance. No sale, payment, production, main change or tax activation occurred. No claim that the entire ERP is defect-free.
