# تفرد الرقم الضريبي للمورد داخل الشركة / Company-local supplier VAT identity

## النطاق والنسخ / Scope and source identity

المستودع `Abdullah-Almutairi12/Hasiba` والفرع `sync/hasiba-erp-20261023`.
بدأ العمل من `161cd6d8f267003f0c127bac645db19390db4202` بشجرة نظيفة وتطابق
مع GitHub. أُبقيت إصلاحات SKU وCSV والاستيراد دون إعادة بنائها.

المصدر التنفيذي لهذا الإصلاح:
`747e5a56a476d6b311953d1393f99b621879aafa`،
بصمة التنفيذ:
`5d5e6f5da943da236c1fd571172eaf6b255d2a4ce4336417b023f6194d953d7e`.
هذا التقرير يتتبع قبول الشريحة المحددة فقط، لا اكتمال المشتريات أو ERP.

No main changes, production deployment, customer-data tests, supplier/customer
import construction, external messaging or payment occurred. The general
`TAX_POLICY_NOT_READY` gate remains in place.

## ما ثبت وما تغير / Findings and changes

| المسار | الدليل والتغيير |
|---|---|
| مخطط الموردين | كان `suppliers_vat_number_unique` عامًا بالفعل؛ أصبح القيد `suppliers_company_vat_number_unique(company_id,vat_number)` |
| الترحيل0073 | تثبيت القيد المركب أولًا ثم إزالة العام داخل معاملة محرك الترحيل الأصلي؛ لا UPDATE أو DELETE أو إعادة ترقيم |
| إنشاء وتعديل المورد | الشركة من الجلسة؛ رفض body.companyId صراحة؛ تضارب محلي409 برسالة تخص الشركة بدل500 في التعديل |
| الرقم الغائب | undefined/null/سلسلة فارغة/مسافات فقط تصبح NULL في الطلب الجديد أو التعديل الصريح؛ ليس ذلك حكمًا على تسجيل المورد ضريبيًا |
| الأرقام السابقة | لا تطبيع جماعي؛ لا تغيير للفراغات التاريخية أو القيم غير الفارغة، بما فيها أصفار البداية؛ لا إسقاط سجلات أو تغيير ارتباطات |
| المساعد الآلي القديم | كان يغيّر رقم مورد له الاسم نفسه؛ أُزيل هذا الإثراء الضمني، والمطابقة المرقمة الآن بالشركة والرقم فقط |
| فاتورة المورد من المسح | تستخدم حل الهوية داخل معاملتها المالية الأصلية، بدل SELECT ثم INSERT غير المحمي رغم التعليق القديم الذي ادعى خلاف ذلك |
| التزامن | قفل هوية معاملي ومفتاح شركة/رقم، ثم INSERT ON CONFLICT DO NOTHING وإعادة قراءة الفائز داخل الشركة؛ لا DO UPDATE على بيانات الفائز |
| غياب الرقم في المسار الآلي | احتُفظ بمسار الاسم المطابق حرفيًا داخل الشركة بين السجلات غير المرقمة فقط، مع تسلسل الطلبات؛ لا مطابقة تقريبية ولا إسناد إلى مورد مرقم بالاسم وحده |
| القراءة والبحث والفواتير | فُحصت حدود الشركة القائمة وحُفظت؛ لا صلاحية أرصدة أو دفع أو استلام جديدة من صلاحية دليل الموردين |

Nonblank VAT values are preserved literally; this task does not introduce a new
tax-number validation/canonicalization policy. Name-only lookup is retained for
unnumbered records with an exact name, within the company, without VAT enrichment,
renaming or merging records. It does not infer legal identity or registration.
The unused exported `findOrCreateSupplier` helper and the live from-scan path now
share the same transactional resolver rather than disagreeing.

## الاختبارات الموجهة / Targeted evidence

السجلات في `generated-artifacts/supplier-vat/` وتُسلّم نسخة منقحة في ZIP.
ليست مجلدات المخرجات المتجاهلة بواسطة Git جزءًا من مزامنة الشيفرة.

### قبل الإصلاح

شُغّل الملف الجديد على المصدر السابق الحقيقي بقاعدة PostgreSQL منفصلة:
7 حالات، **6 فاشلة و1 ناجحة**، exit1. هذه نتيجة فشل متوقعة لإثبات الحالة،
وليست قبولًا. خمس حالات كشفت اختلافات السلوك المطلوبة:
التكرار العابر للشركات، رد التعديل عند التعارض، المسافات كرقم غائب،
رفض companyId المرسل، والإثراء الخاطئ بالاسم.

الحالة السادسة الخاصة بالترحيل المالي فشلت بسبب نقص فترة مالية في
fixture الاختبار الجديدة، **لا بسبب عيب تطبيق مثبت**؛ أضيفت فترة مصطنعة
مفتوحة للشركتين إلى إعداد الاختبار. لا يُنسب هذا الفشل إلى قيد الرقم.
اختبار الترحيل نفسه يعيد إثبات23505 على القيد العام الفعلي قبل SQL0073.

### بعد الإصلاح

**30 اختبارًا ناجحًا،0 فشل** في4 ملفات:
7 لحالات المورد الجديدة، و1 لترحيل المورد، و14 لدورة فاتورة المورد القائمة،
و8 لصلاحيات المشتريات القائمة. لا تُضاف هذه الأعداد إلى الإجمالي الشامل؛
هي مجموعة فرعية منه. فحص الأنواع الموجه نجح كذلك.

تشمل الاختبارات:

- شركتين تسجلان الرقم نفسه مع معرفين مستقلين؛ البحث والقراءة والتعديل
  وفاتورة الشركة الأخرى تبقى غير متاحة.
- ثلاث محاولات إنشاء متزامنة داخل الشركة:201 واحد و409 اثنان؛
  وتعديلان متزامنان إلى الرقم نفسه:200 واحد و409 واحد.
- غياب الرقم وفراغه ومسافاته، ومحاولات تزوير ملكية الشركة.
- طلبات بحث/إنشاء آلية متزامنة وعدم استبدال رقم المورد السابق بالاسم.
- المسار الحقيقي `POST /invoices/from-scan`، ومحاولتان متزامنتان
  بالمعرف والجسم نفسيهما ثم إعادة استرجاع؛ فاتورة واحدة وقيد واحد
  لكل شركة، ذمة10.00 ومدين10.00 ودائن10.00 دون مضاعفة.
- سحب العضوية مع جلسة مفتوحة ورفض القراءة والإنشاء دون تغيير المورد.
- الشريحة القائمة للصلاحيات والفواتير، بما فيها أقفال PostgreSQL الفعلية،
  وسحب أهلية المراجع، وعدم استهلاك كميات الاستلام مرتين.

## دليل الترقية وحماية التاريخ / Upgrade and historical preservation

اختبار PostgreSQL مخصص ينشئ مخططًا معزولًا بمخطط حقول المورد الحقيقي
وقيده العام السابق، مع رقم يبدأ بأصفار وسجل NULL وفراغ تاريخي ورصيد
123.45 ورصيد7.25 ومراجع فاتورة. يثبت الرفض قبل الترحيل، ويطبق ملف0073
مرتين لإثبات عدم إعادة الأثر، ويقارن صفوف المورد والمراجع قبل/بعد حرفيًا،
ثم يثبت السماح العابر للشركات والمنع المحلي.

هذا الاختبار المخصص ليس بديلًا عن بوابة ترقية التطبيق السابق المثبّت
في المشروع؛ تُسجّل نتيجتها المستقلة مع البوابات النهائية.
لا يُفترض أن فحص قاعدة اختبار يثبت حالة بيانات أي منشأة تشغيلية.
لم تُقرأ بيانات العملاء لتطبيعها ولم تُكتب.

## الفحص النهائي ورحلة الواجهة / Final verification and native browser

### رحلة الواجهة والمصالحة الجديدة

أُعيدت الرحلة في الواجهة الأصلية `/suppliers` بحسابين اصطناعيين منفصلين،
بخروج ودخول عاديين، على المصدر747e5a5 والبصمة المذكورة أعلاه:

- الشركة4: حفظ المورد بالرقم `300123456789003`، المعرف1.
- الشركة5: قائمة خالية أولًا، ثم حفظ الرقم نفسه بسجل مستقل، المعرف2.
- إضافة مكرر داخل الشركة5 رُفضت برسالة «يوجد مورد آخر بنفس الرقم
  الضريبي داخل هذه الشركة»، وبقي النموذج قابلًا للتصحيح.
- مورد آخر بالمعرف4 بقي رقمه `300123456789013` بعد رفض تعديله إلى
  الرقم المشغول؛ حُفظ مورد بلا رقم بالمعرف5، VAT=NULL.
- الرجوع للشركة4 أظهر سجلها1 فقط؛ محاولتا GET/PATCH مباشرتان
  إلى سجل الشركة5 أعادتا404 من الجلسة الأصلية.

ست صور في `screenshots/` و`report.json` و`native-events.json`.
رمزا HTTP لمحاولتي التكرار في **المتصفح** لم يُلتقطا منفصلين؛ ثبتت
رسالتاهما بصريًا وثبات الصفوف، بينما ثبت409 عبر اختبارات API الفعلية.
لا تُسمى معاينة النموذج اختبار طباعة أو تنزيل أو فاتورة من المتصفح.
الفواتير وإعادة محاولاتها جرى اختبارها في API، لا ادعاء رحلة متصفح لها.

المصالحة المستقلة READ ONLY/REPEATABLE READ:
بداية `2026-11-03T04:21:51.600Z`،
نهاية `2026-11-03T04:28:09.831Z`.
فُحص228 جدولًا، وثبت عدم تغيير29 جدولًا محميًا للفواتير والقيود
والمخزون وطبقات التكلفة والأرصدة والمحاولات المالية نتيجة رحلة المورد.
السجلات الأربعة الجديدة أرصدتها جميعًا `0.00` بالنص العشري SQL؛
لا تكرار محلي، والشركتان مستقلتان. لم توجد سجلات مورد سابقة في
fixture المتصفح؛ حفظ التاريخ السابق مثبت باختبار الترحيل المنفصل،
ولا يُنسب إلى مصالحة قائمة كانت خالية.

الملفات الثلاثة غير المحفوظة التي رصدها مختبر المتصفح كانت تقرير
هذا التسليم وذاكرته المكتوبين بالتوازي من الوكيل الرئيسي، لا تغييرات
تنفيذية مجهولة. بصمة المصدر التنفيذي لم تتغير بسببها.

### Full-suite result

شُغّل فحص شامل جديد **مرة واحدة** بعد تثبيت المصدر747e5a5؛
بداية الغلاف `2026-11-03T04:20:50Z`، نهايته `2026-11-03T04:38:03Z`
وملخصه النهائي `04:38:03.730Z`، رمز الخروج **0**.
بتوقيت الرياض: **07:20:50–07:38:03 يوم3 نوفمبر2026**.

| الفحص | نتيجة التشغيل الجديد |
|---|---|
| البوابات | **15/15 ناجحة**، لا فشل |
| فحص الأنواع | ناجح |
| isolated-runner وفحوص أدلة التنظيف الثلاثة | ناجحة |
| API | **1185 ناجح/0 فشل/1 متجاوز مشروط**، إجمالي1186،97 ملفًا |
| UI | **377 ناجح/0 فشل/0 متجاوز**،68 ملفًا |
| ترقية التطبيق السابق المستقلة | **1 ناجح/0 فشل**؛38 حالة أخرى مرشحة خارج اختيار `-t` وليست إخفاقات |
| بناء API وERP والدليل والعرض وsandbox | ناجح |
| تدقيق الاعتماديات | ناجح |
| ثبات بصمة المصدر عند نهاية الفحص | ناجح |

الحالة المتجاوزة في API تشترط بيئة الترقية السابقة؛ غطتها بوابة الترقية
المستقلة فعلًا. لا تُجمع1/38 أو30 الموجهة مع1185 كأنها اختبارات إضافية.
وقت API `04:22:02` ومدته797 ثانية، ووقتUI `04:35:24` ومدته131.70 ثانية
في سجلي الإطار الخام؛ مدد البوابات في summary تشمل تشغيل الغلاف أيضًا.

المصدر التنفيذي واختبارات API/UI والترقية والخادم الذي استُخدم في رحلة
المتصفح متطابقة على747e5a5 وبصمة5d5e6f…d953d7e. ملفات الواجهة الأصلية
لم تُعدّل. ملفات التقرير والذاكرة اللاحقة لا تدخل بصمة التنفيذ؛ تُحفظ
بـCommit تسليم منفصل، ولا تُنسب نتيجة الفحص إلى شيفرة مختلفة.

عند بدء الجلسة كان هناك تشغيل تلقائي على161cd6d. تُرك لينتهي قبل أي
تعديل تنفيذي، وانتهى `2026-11-03T04:13:56.203Z` بـ15/15 على بصمةSKU
السابقة ce253…f1a29؛ محفوظ منفصلًا في `previous-source-verification/`.
**ليس هذا قبول الإصلاح الجديد**. تشغيل المورد الجديد مستقل عنه أعلاه.
انتهت إحدى مهلات انتظار أداة shell أثناء الانتظار، لكن عمليةverify نفسها
لم تتوقف أو تُعد تشغيلها؛ رمز خروجها النهائي0 محفوظ في `final-exit`.

### الإغلاق والمتبقي المحدد

أُغلقت شريحة التفرد المحلي للمورد بما تثبته الأدلة أعلاه. لا عيب معلوم
متبقٍ داخل هذا التصحيح، ولا تشغيل اختبارات آخر لازم بعد نجاح المصدر نفسه.
المتبقي خارج نطاقه: استيراد الموردين/العملاء، وأي قرار تطبيع للأرقام
التاريخية، أو سياسة هوية أقوى للمورد بلا رقم. هذه ليست وظائف مُنجزة
بسبب هذا التغيير، ولا مهام جديدة بدأها الوكيل.

لم يُختبر نشر أو ترحيل إنتاجي، ولا بيانات عميل، ولا استلام بريد أو دفع
خارجي، ولا تشغيل هيئة أو أجهزة/طباعة ورقية. لم تُبنَ شاشة جديدة ولم تُغيّر
نسب الضريبة أو التسجيل. العرض التعريفيPDF لم يتغير؛ بصمته المحفوظة:
`a11e876fc3bd41bb73490c9e0c98d09b80e4816e89b9690722497365d1d11ecc`.

نقطة الرجوع قبل التغيير161cd6d محفوظة في تاريخ الفرع؛ قيد الرجوع البياني
المذكور أدناه ملزم بعد أي استخدام مشروع للرقم عبر الشركات. نقطة الاستئناف:
مراجعة هذا التسليم عند طلب المستخدم، دون بدء نطاق تالٍ تلقائيًا.
إثبات المزامنة موجود في `git-sync.json` بالحزمة؛ قد يليه Commit
لفهرسة ملفات Library فقط، ويُذكر آخر SHA المؤكد في رسالة التسليم.

## الملفات الأساسية / Core files

- `lib/db/src/schema/suppliers.ts`
- `lib/db/drizzle/0073_company_supplier_vat.sql`
- `artifacts/api-server/src/lib/supplier-identity.ts`
- `artifacts/api-server/src/routes/suppliers.ts`
- `artifacts/api-server/src/routes/invoices.ts`
- `artifacts/api-server/src/routes/supplier-vat.test.ts`
- `artifacts/api-server/src/lib/company-supplier-vat-upgrade.test.ts`
- `artifacts/api-server/src/routes/sales-return-cost.test.ts`: أُضيف اسم0073
  إلى قائمة الترحيلات المتوقعة حرفيًا، دون حذف فحوص التاريخ أو المراجع.

No UI redesign, new import surface, parallel accounting engine, or parallel
permission/approval system was introduced. The original supplier form remains
the user interface. No investment presentation claims were changed.

## الرجوع والحدود / Rollback and limits

بعد استخدام الرقم نفسه بصورة مشروعة في شركتين، لا يصح إعادة قيد عام بالقوة.
لا حذف أو دمج أو بادئات أو إعادة ترقيم لتسهيل الرجوع. يمكن إرجاع شيفرة
متوافقة مع القيد المركب؛ وأي تغيير للسياسة يحتاج قرار بيانات مستقلًا.
لا يُنفّذ down migration هدّام تلقائيًا.

لا يشمل هذا التسليم بناء استيراد الموردين/العملاء، أو تغيير سياسة مطابقة
الأسماء إلى مطابقة تقريبية، أو توحيد السجلات بين الشركات، أو تفعيل ضريبي،
أو اتصال هيئة أو بريد/دفع فعلي، أو قبول أجهزة وطباعة ورقية.

## English handoff

The old VAT uniqueness was global in the actual database, not merely in a
schema comment. Migration0073 atomically installs company-local uniqueness
before dropping the old global constraint and does not rewrite data.

The existing supplier create/edit endpoints now return a company-specific409
for VAT conflicts, reject client-owned companyId, and treat blank new input as
missing evidence. Search/detail/invoice ownership and the existing procurement
authorization machinery are retained.

The scanner now uses the shared transactional supplier resolver. Numbered
suppliers are matched on company and exact VAT only. A matching name cannot
replace an existing VAT. Concurrent creation resolves the same company-local
winner without updating its name/contact data. Existing unnumbered exact-name
fallback remains scoped to unnumbered records, without merging rows.

The initial focused run had6 failures/1 pass:5 requested behavior gaps and1
test-fixture omission (missing fiscal period). The corrected isolated fixture
then passed all30 targeted tests. The migration regression independently proves
the original actual PostgreSQL constraint fails cross-company reuse, preserves
historical rows/references, and enforces local uniqueness after migration.

The fresh final full run started2026-11-03T04:20:50Z and ended04:38:03Z,
exit0:15/15 gates,1185 API passed/0 failed/1 conditional skip,377 UI passed,
and the independently executed pinned historical upgrade passed. Its38 other
test cases were filtered by the selected test name, not new failures. Counts
from focused suites are included in, not added to, the final API total.

The native original supplier UI was exercised in two independently signed-in
synthetic companies. The same VAT produced supplierID1/company4 and
supplierID2/company5. Duplicate add and edit were visibly rejected without
changing existing rows; missing VAT saved as NULL. Authenticated cross-company
GET/PATCH returned404. Duplicate409 status was proven by API tests; the browser
captured the Arabic conflict but not its response status separately.

Independent read-only reconciliation examined228 tables and confirmed29
protected financial, stock, invoice and retry tables unchanged by the directory
journey. All four new supplier records had exact SQL-text balances0.00. There
were no original suppliers in the browser fixture, so historical preservation
is evidenced by the separate migration test, not inferred from an empty list.

Tests and the native API host use the same executable commit747e5a5 and full
fingerprint recorded above. The earlier source161cd6d startup verification
completed separately before edits; its result is not reused as this acceptance.
No final verify was abandoned or silently restarted. Subsequent documentation
and Library indexing commits do not change executable source. See the packaged
Git sync evidence and final handoff for the verified pushed release SHA.

The scoped correction is closed with no known remaining defect in its tested
scope. Historical VAT canonicalization, stronger identity policy for suppliers
without VAT, supplier/customer imports and live production acceptance are not
claimed or started. This report does not claim the entire ERP is bug-free.
