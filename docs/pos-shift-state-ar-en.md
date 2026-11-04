# حالة الوردية قبل الفتح / Shift state before opening

## النطاق ونسخة البداية
بدأت المراجعة من `1776843848864edf3b635aabba21e72851f7e6b8`؛ المحلي والفرع البعيد متطابقان والشجرة نظيفة.
الفرع: `sync/hasiba-erp-20261023` في `Abdullah-Almutairi12/Hasiba`. لا تغيير main أو إنتاج أو بيانات تشغيلية.

## إثبات العيب قبل الإصلاح
- اختبارا واجهة التحميل وفشل القراءة فشلا لأن زر فتح جديد كان متاحًا.
- اختبار استرجاع المحاولة المحفوظة كان ناجحًا ويجب الحفاظ عليه.
- PostgreSQL معزول: وردية مفتوحة ثم 25 سجلًا مغلقًا أحدث؛ قراءة القائمة لم تتضمن الوردية الأصلية.
- السجلات المنفصلة: `generated-artifacts/pos-shift-state/ui-before.log` و`api-before.log`.

## الإصلاح المحدود
- فشل/تحميل/إعادة جلب حالة الوردية يمنع واجهة الفتح الجديد وكذلك معالج الإرسال نفسه.
- يظهر إعادة تحقق عند فشل القراءة. استرجاع محاولة محفوظة يسبق هذا الحجب ويحافظ على المعرف والجسم.
- استعلام واحد يعيد كل الورديات المفتوحة المسموحة مع آخر 20 سجلًا؛ الحد للتاريخ وليس للحالة النشطة. تبقى شروط الشركة/الفرع والجهاز والكاشير للجهاز في SQL، واختيار الواجهة لا يستعير وردية كاشير آخر.
- لا ترحيل بيانات أو حزمة جديدة أو زيادة عددية لحد القائمة.

## التحقق
- المصدر المختبر ومصدر خادم/واجهة المتصفح: [`3849d10f74541873a3451bedd604ec87f2fcad25`](https://github.com/Abdullah-Almutairi12/Hasiba/commit/3849d10f74541873a3451bedd604ec87f2fcad25).
- بصمة المصدر: `1eb6535cd4db58817681fc2547fc4430cb8ad2de2c5ab9a54e5d31ac75fce737`؛ الشجرة نظيفة عند الاختبار. شهادة Vite هي بصمة الوحدة المقدمة مع ربطها بالشجرة والخادم، وليست ادعاء وجود SHA مضمّن في البناء.
- تشغيل كامل جديد واحد: من **2026-11-04 00:54:57 UTC** إلى **01:13:40 UTC**، رمز خروج **0**.
- **15/15** بوابة ناجحة، ومنها الأنواع والبناء والتدقيق وثبات المصدر.
- API: **1252 ناجحًا، 0 فاشل، 1 متجاوز شرطيًا** (بوابة الترقية المنفصلة تغطيه).
- UI: **425 ناجحًا، 0 فاشل، 0 متجاوز**، في 71 ملفًا.
- الترقية المستقلة: **1 ناجح**، و38 مستبعدة بمرشح اسم الاختبار، وليست 38 إخفاقًا.
- النتائج الموجهة التطويرية: 25 واجهة و24 خادم ناجحة، وهي مجموعات ضمن الاختبارات وليست أعدادًا تُجمع مع الإجمالي. توسيع اختبار الجهاز إلى 25 سجلًا مغلقًا من الكاشير/الجهاز نفسيهما مغطى في التشغيل الكامل النهائي.
- أثناء تطوير اختبار الواجهة أُصلح محدد عنصر خاطئ في الاختبار (`pos-session-context` مقابل المحدد الحقيقي `pos-active-session-context`)؛ هذا لم يكن عيب تشغيل جديدًا. تُحفظ محاولة الاختبار الوسيطة الفاشلة منفصلة عن القبول النهائي.

## رحلة الكاشير والمصالحة الجديدة
- قاعدة PostgreSQL اصطناعية معزولة، لا بيانات عملاء ولا تجاوز للحجب الضريبي.
- فرض فشل قراءة الحالة: ظهر تعذر التحقق وإعادة التحقق، دون زر فتح جديد. بعد إزالة العطل نجحت إعادة التحقق الأصلية.
- فتح **وردية واحدة فقط من الواجهة الأصلية** بنقد افتتاحي 125.50. معرفها **2**، ومرجعها `WRD-1793753919078-4dc64380`، الفرع 3 والكاشير 3 في هذه القاعدة الاصطناعية.
- أُضيفت بعدها **25 وردية مغلقة مصطنعة** لاختبار التاريخ، لا لإنشاء وردية مفتوحة أو تجاوز واجهتها.
- عند إعادة التحميل مع تأخير القراءة لم يتاح فتح جديد؛ وبعد اكتمالها وإعادة تحميل أخرى ظهر المرجع نفسه والكاشير والفرع نفسيهما.
- مصالحة SQL مستقلة: الوردية الأصلية والحالية **2**، العدد **1 → 26** (الزيادة هي 25 سجل اختبار مغلقًا فقط)، **إيصال فتح واحد**، **0 أوامر بيع**؛ لم يُرسل طلب فتح آخر.
- سجل النقل يثبت POST فتح واحدًا وGET يحتوي الوردية الأصلية بجانب 20 سجلًا مغلقًا أحدث على الأقل.
- استرجاع المحاولة المحفوظة أثناء فشل القراءة أُثبت باختبار واجهة دائم: نفس المعرف والجسم، دون محاولة جديدة. لا ندّعي إعادة رحلة فقد رد بيع في هذه الجولة؛ لا تغيير لمحرك البيع أو القيود هنا.
- خمس صور أصلية محفوظة. أبلغ أداة المتصفح عن تعذر تصدير الصور، ثم وُجدت الملفات فعليًا في مساحة العمل المشتركة ونُقلت للحزمة؛ لم تكن هذه ملاحظة فشل في الرحلة. بقي التقرير الخام محفوظًا مع توضيح ذلك.

## الملفات وحدود التسليم
الشيفرة: `artifacts/api-server/src/routes/pos.ts`، و`artifacts/erp-system/src/pages/pos-iconic.tsx`.
الاختبارات: `pos-shift-opening.test.ts`، و`pos-devices.test.ts`، و`pos-iconic.test.tsx` في مساراتها الأصلية.
الأدلة: `generated-artifacts/pos-shift-state/`؛ سجلات قبل/بعد، `final-verification/`، ومصالحة المتصفح وشهادتا المصدر وصور الرحلة وحزمة `Hasiba-Shift-State-Evidence.zip`.
الملفات المولدة مستثناة من Git وتُسلّم كملف قابل للتنزيل؛ ليست مرفوعة إلى GitHub لمجرد وجودها محليًا.
رُفع Commit الشيفرة المختبر رفعًا عاديًا وتحقق تطابقه مع GitHub. Commit التسليم اللاحق يحدّث هذا التقرير وتسجيل المرفق فقط، دون تغيير المصدر التنفيذي أو الاختبارات.
لا إخفاق نهائي معلوم متبقٍ ضمن الحالات المطلوبة. لا ادعاء بخلو ERP كله من الأخطاء أو قبول أجهزة فعلية أو إنتاج ضريبي؛ يبقى `TAX_POLICY_NOT_READY` قائمًا. لا main أو نشر إنتاجي أو نطاق إضافي.

## English
Baseline was a clean local/remote `1776843` on the existing synchronization branch.
Two UI regressions reproduced fresh-opening availability during loading and failed reads. A third test retained immutable saved-attempt recovery.
An isolated PostgreSQL regression reproduced an open shift disappearing behind 25 newer closed rows.
The bounded fix blocks fresh opening in both rendering and its handler until state reads succeed, preserves recovery, and uses one SQL snapshot to return authorized active shifts independently of the recent-history limit.
Tenant, branch, device and cashier restrictions remain in force. No migration, package change, main update, deployment or operational-data tests.
New full verification on clean `3849d10f74541873a3451bedd604ec87f2fcad25` ran 2026-11-04 00:54:57–01:13:40 UTC, exit 0: **15/15 gates; 1252 API passed, 0 failed, 1 conditional skip; 425 UI passed, 0 failed; independent upgrade 1 passed with 38 title-filter exclusions**. Directed subsets are not added to these totals.

The browser/API runtime and test source share SHA-256 `1eb6535cd4db58817681fc2547fc4430cb8ad2de2c5ab9a54e5d31ac75fce737`. Vite attestation identifies the served module and working tree, not an embedded build revision.
Native testing verified failed-read/recheck, one original UI opening, delayed reading on reload, and recovery of the exact same shift after inserting 25 newer CLOSED histories. Independent PostgreSQL reconciliation: original/current shift ID 2, row count 1→26 explained exclusively by the 25 seeded histories, one opening receipt, no sales, one opening POST. Saved-attempt recovery under a failed read is covered by a permanent UI test; no fresh sale/lost-sale-response journey is claimed in this bounded change.

Five actual native screenshots were recovered from the shared workspace after the tester reported an export-tool limitation. The raw report remains unmodified and an export note accompanies the ZIP. An intermediate directed UI failure was a wrong test selector, corrected before the final tested commit; it is preserved separately and is not a runtime failure.
The tested code commit was normally pushed and its remote equality verified. Later handoff commits change report/asset registration only. Generated evidence is delivered as a download, not misrepresented as Git-tracked content. No final known failure remains in this bounded scope; physical hardware, production, and tax acceptance are not claimed.
