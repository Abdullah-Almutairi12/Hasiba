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
النتائج النهائية والمصدر المختبر ورحلة المتصفح والرفع تُستكمل بعد نهاية التشغيل؛ هذا الملف لا يدّعي قبولًا قبل ذلك.

## English
Baseline was a clean local/remote `1776843` on the existing synchronization branch.
Two UI regressions reproduced fresh-opening availability during loading and failed reads. A third test retained immutable saved-attempt recovery.
An isolated PostgreSQL regression reproduced an open shift disappearing behind 25 newer closed rows.
The bounded fix blocks fresh opening in both rendering and its handler until state reads succeed, preserves recovery, and uses one SQL snapshot to return authorized active shifts independently of the recent-history limit.
Tenant, branch, device and cashier restrictions remain in force. No migration, package change, main update, deployment or operational-data tests.
Final acceptance is recorded only after the new gates and native browser journey finish.
