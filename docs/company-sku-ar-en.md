# تفرد SKU داخل الشركة / Company-local product SKU

## النطاق والحالة / Scope and status

المشروع والمستودع القائمان `Abdullah-Almutairi12/Hasiba`، الفرع
`sync/hasiba-erp-20261023`. نقطة البداية النظيفة `e3f1420`، متطابقة مع GitHub.
لا تغيير لـmain، ولا نشر أو كتابة على بيانات عميل أو تفعيل ضريبي.
لم يُعَد بناء الاستيراد أو إصلاح CSV أو آلية المحاولات.

This changes base-product SKU uniqueness from global to `(company_id, sku)`.
The existing project, branch, catalogue import, CSV correction, financial retry
receipts and tax gate are preserved. No customer/supplier import was started.

## مراجعة المسارات / Path review

| المسار | النتيجة |
|---|---|
| مخطط products | القيد القديم `products_sku_unique` كان عامًا؛ استُبدل بقيد `products_company_sku_unique` |
| الإنشاء الأصلي POST /products | الشركة من الجلسة؛ body.companyId مرفوض؛ تعارض SKU المحلي يعيد409 برسالة عربية دون هوية شركة أخرى |
| التعديل الأصلي PATCH /products/:id | النموذج كان يرسل SKU لكن العقد والخادم يهملانه؛ أُضيف الحقل الاختياري وحفظه بقيد الشركة نفسه |
| البحث في المنتجات | شرط الشركة القائم محفوظ؛ أُضيف SKU إلى بحث الأسماء القائم، دون بحث عام |
| المسح GET /inventory/lookup | يطابق SKU/باركود تحت شركة الجلسة؛ لم يحتج إعادة بناء |
| عد الجرد بالكود | مطابقة الكود مقيدة بالشركة قبل التحقق من صنف الجلسة؛ لم تتغير |
| الاستيراد | المعاينة تقارن أكواد الشركة أصلًا؛ أصبح قيدDB متسقًا معها؛ الرسالة القديمة عن التفرد العام صُححت |
| تكاملات المتاجر | `resolveProduct` يربط mapping بالموصل والشركة، ومطابقة SKU بالشركة؛ لا تكامل حي جديد |
| استخراج فاتورة مورد/إنشاء صنف آلي | يكتب companyId من سياق الفاتورة؛ المطابقة القائمة بالأسماء مقيدة بالشركة، والمراجع بالمعرف لا SKU |
| بقية المبيعات والمخزون والتصدير | الروابط بمعرفات الأصناف، وليست FK مبنية على SKU؛ لم تُعاد كتابة هذه الدورات |

The existing scanner, stocktake lookup, marketplace resolver and invoice
auto-match were already tenant-scoped. Only product search gained the SKU match
inside its existing tenant predicate. Client companyId is not an authority:
write bodies explicitly reject it, and read-query parameters cannot override
the session tenant. Native edits now persist the SKU that the original form
already submitted; duplicate edits fail atomically instead of claiming success.

### المتغيرات / Variants

`product_variants.sku` له قيد عام مستقل، وبقي كما هو عمدًا. ملكية المتغير
تُستنتج من صنفه الأب؛ المسح يتحقق من الشركة عبر علاقة الأب. أولوية المطابقة
القائمة: الصنف الأساسي ثم المتغير، ولا يوجد قيد جديد عبر الجدولين. السماح
بنفس SKU لصنفين أساسيين في شركتين لا يعني استكمال سياسة أكواد المتغيرات.
التصنيفات المرجعية المشتركة لم تتغير.

Variants retain their separate global SKU constraint, parent ownership and
existing product-first lookup precedence. This task does not claim variant
code-policy completion or add cross-table SKU uniqueness.

## الترحيل والرجوع / Migration and rollback

`lib/db/drizzle/0072_company_product_sku.sql` يستخدم المشغل الأصلي. يُثبت القيد
المركب أولًا ثم يزيل القيد العام، داخل معاملة الترحيل نفسها وبعد انتظار
الكتّاب. لم تتغير الأكواد أو المعرفات أو الأرصدة أو الروابط أو طبقات التكلفة.
لا بادئات شركة ولا تطبيع أو قص للأكواد؛ تبقى نصوصًا بأصفارها الأولى، وبالمقارنة
الحرفية الحساسة لحالة الأحرف كما كانت.

بعد استخدام الكود نفسه في شركتين، لا يمكن إعادة القيد العام بأمان تلقائيًا.
لا down migration إجبارية، ولا إعادة تسمية أو حذف أصناف لحل تعارض الرجوع.
يلزم قرار مستقل ومدقق وخطة تحفظ المراجع والتاريخ؛ حتى ذلك الحين يُبقى قيد
الشركة عند معالجة مشكلة تشغيلية. لا تعني نقطة رجوع الشيفرة استعادة قاعدة
البيانات أو صلاحية إعادة القيد العام.

The original transactional migration runner installs the composite constraint
before dropping the global one. No product values, IDs or references are
rewritten. Reintroducing global uniqueness after legitimate cross-tenant reuse
requires a separate reviewed data policy; never force it by renaming/deleting
products. A code checkpoint is not an automatic database rollback.

## الأدلة الجديدة / Fresh evidence

- قبل الإصلاح: الاختبارات الثلاثة الجديدة أخفقت، مع26 حالة خارج المرشح،
  خروج1. ليس هذا تشغيلًا شاملًا.
- بعد الإصلاح الموجّه: **41/41 ناجحة**:29 اختبارAPI للاستيراد/الأصناف،
  و11 للقراءة وCSV، و1 لترقية القيد. هي أجزاء من إجمالي الخادم النهائي.
- اختبار القيد ينسخ بنية الصنف السابق بقيده العام إلى مخطط اختبار معزول،
  ويحفظ صف الصنف ومرجعFK تاريخيًا، ويطبق ملف0072 الفعلي مرتين؛ الحقائق
  والمراجع ثابتة، والكود نفسه مسموح لشركة أخرى وممنوع في الشركة نفسها.
  هذا الاختبار ليس بديلًا عن اختبار ترقية التطبيق السابق المثبت بالكامل.
- التشغيل الشامل الأول كشف أن قائمة أسماء الترحيلات المتوقعة في اختبار
  الترقية لم تتضمن0072. الترحيل نفسه طُبق؛ الإخفاق في مقارنة القائمة الصريحة.
  حُفظ السجل ثم أوقف التشغيل قبل إهدار بقية الاختبارات على مصدر غير نهائي.
  أضيف الاسم المتوقع فقط؛ لم تُحذف أو تُضعف فحوص البيانات والمراجع.
- التشغيل التالي انتهى بخروج1 و14/15:1177 خادم ناجح و1 متجاوز شرطيًا،
  و377 واجهة ناجحة وترقية مستقلة ناجحة. فحص الأنواع كشفTS7030 في مسار
  POST/products بسبب خلط return Response مع إرسال الاستجابة دونreturn.
  صُحح بإرجاع استجابتي النجاح والخطأ الموجودتين كما هما. لا تغيير للحالة
  أوJSON أو الصلاحية أو الكتابة؛ نجح فحص الأنواع المستقل بعد التصحيح.
  هذا التشغيل ليس القبول النهائي، وسُجله محفوظ منفصلًا.
- رحلة أصلية جديدة بحسابين مستقلين: A أنشأ0001 بمعرف3، وB أنشأ0001 بمعرف4.
  بحث كل شركة ومسحها أعادا صنفها وحده، والاطلاع بالمعرف الأجنبي أعاد404.
  رفضت الواجهة إنشاء0001 آخر داخلB بـ409. أنشأB الصنف6 بـ0002؛ رُفض
  تغييره إلى0001، ثم نجح تغييره الصريح إلى0003 مع بقاء معرفه6.
- عشر صورJPEG فعلية، وقراءاتAPI مستقلة موثقة؛ لا أسرار دخول في الأدلة العامة.
- مصالحة228 جدولًا قبل/بعد:3 أصناف جديدة فقط؛ كل الأصناف السابقة و27 جدولًا
  محميًا للمخزون والتكلفة والمالية والتاريخ بقيت متطابقة. لا إيصالات محاولات
  جديدة في هذه الرحلة؛ جدولها بقي ثابتًا. الأسعار12.30 والتكاليف4.50
  والمخزون0.0000 طابقت قراءةSQL النصية المستقلة، ولا تكرار داخل شركة.
- التغيرات غير المالية المرصودة: تهيئة أمان الحسابين، والجلسات وlastLoginAt،
  وتنظيف التنبيهات وإعداد التشغيل؛ لم ندّع أن228 جدولًا كلها لم تتغير.

Three new focused cases failed before the fix (26 filtered), then41/41 targeted
cases passed, including the unchanged CSV, isolation, revocation, closure and
receipt-recovery cases. Native create/search/lookup/edit verified independent
company reuse and local conflicts. Read-only SQL reconciliation proved three
new zero-stock products, unchanged original products,27 unchanged protected
tables and unchanged financial request receipts. The first full-run upgrade
failure was an outdated explicit expected migration list; its one-line update
preserves all historical integrity assertions.

## المصادر / Source provenance

- التغيير التنفيذي: `3b529083878b946cf3350f4dc530a50a9f207f49`،
  بصمة `f0d1a6a06cc675e2ff394669285c9920f69d1a13a3849c4eb008b7f73aeac93d`.
- مصدر تشغيل14/15: `8a55412bbc0c82f63b73cc68025c197b3f006398`،
  بصمة `7ab20fd85fc012a240dd4770fbd4f89abf513fcfeb9a364da3ba0d8de9ab4faf`.
- المصدر التنفيذي النهائي: `210ccf76a6fc9644b6dd46c6fb2e6fb7c8cb9607`،
  بصمة `ce253ba2b2f8431f268497257a68c87ad8890be39bbdb8e903a4f0ffe6bf1a29`.
- خادم المتصفح بدأ على3b52908. الفرق الوحيد إلى8a55412 هو إضافة اسم0072
  إلى اختبار `sales-return-cost.test.ts`، دون أي تغيير تنفيذي أو للواجهة
  أو الترحيل في تلك النقطة. إلى210ccf7 يضاف فقطreturn أمام استجابتيPOST
  الموجودتين؛ الجسم والحالة والكتابات لم تتغير. لا ندّعي تطابق بصمة خادم
  المتصفح النهائية أو جميع ملفاته مع210ccf7؛ فرقGit الكامل محفوظ في الحزمة.
  مكونات الواجهة والترحيل لم تتغير. لم نكرر رحلة المتصفح بعد تصحيح الإرجاع،
  وأعيدت اختبارات المسار وAPI كاملة والأنواع ضمن البوابات على210ccf7.
- كانت تقاريرMarkdown وذاكرة القرار غير محفوظة بعد أثناء التشغيل الأخير؛
  لذلك metadata تسجلdirty=true. لا فرق تنفيذي خارجCommit؛ البوابة تفحص
  ثبات بصمة التنفيذ، وتُحفظ الوثائق ويُتحقق من نظافة الشجرة عند الرفع.
- ملفات التغيير: مخططproducts، ملف0072، products.ts وproduct-imports.ts،
  اختبار الاستيراد واختبار الترقية الجديد، اختبار الترقية القائم، عقدOpenAPI
  ومخرجا API schemas وZod المولدان. التفاصيل بأسماء الملفات في Git.

The browser host started on3b52908. The14/15 run used8a55412; final gates use
210ccf7. The exact differences are one expected migration filename in a test,
then two explicit returns of the existing POST success/error responses, without
changing their status, payload, authorization or writes. Aggregate fingerprints
and the backend route file differ; frontend and migration files match. The
browser journey was not rerun after the strict-return typing fix; the complete
API suite and strict typecheck are rerun on210ccf7. Uncommitted report/memory
files account for dirty=true at the final run's start; executable code is committed.

## التحقق النهائي / Final verification

**نجح النطاق المحدد.** تشغيل جديد على210ccf7 من
`2026-11-02T16:35:06Z` إلى`2026-11-02T16:54:43Z`
(19:35:06–19:54:43 بتوقيت الرياض)، رمز الخروج0.

| الفحص | النتيجة الجديدة |
|---|---|
| بوابات المشروع |15/15 ناجحة، ولا بوابة فاشلة أو متجاوزة |
| الأنواع | ناجحة للمكتبات والخادم والواجهات/scripts |
| API / الخادم |1177 ناجح،0 فشل،1 متجاوز شرطيًا، الإجمالي1178 في95 ملفًا |
| UI / الواجهة |377 ناجح،0 فشل أو تجاوز في68 ملفًا |
| الترقية المستقلة |1 ناجح من النسخة السابقة المثبتة؛38 خارج مرشح تلك الرحلة، وليست38 إخفاقًا |
| الاعتماديات والبناء | التدقيق وجميع عمليات البناء ناجحة |
| ثبات المصدر | البصمة التنفيذية لم تتغير أثناء التشغيل |

حالةAPI المتجاوزة مشروطة ببيئة الترقية؛ اختبارها نجح في البوابة المستقلة،
ولا تجمع نتيجته أو الاختبارات41 الموجهة مرة أخرى مع1177. لا نتائج قبول قديمة
مستخدمة بدل هذا التشغيل. سجلا الإخفاق السابقان محفوظان منفصلين.

Fresh final verification **passed15/15**, exit0, on210ccf7,
16:35:06–16:54:43UTC. API:1177 passed,0 failed,1 conditional upgrade skip.
UI:377 passed,0 failed/skipped. The upgrade-specific case passed independently
(38 unrelated cases filtered). Typecheck, builds, dependency audit and unchanged
execution-source guard passed. Targeted cases are included, not added again.

أُعيد تشغيل خادم العرض المعزول بعد التصحيح على210ccf7 وبصمة التنفيذ نفسها،
ثم تحقق دخول حسابَي الاختبار وقراءة0001:3 للشركةA و4 للشركةB، و404 بالمعرف
الأجنبي. هذه قراءاتHTTP بعد إعادة التشغيل، وليست ادعاء إعادة رحلة المتصفح
كاملة. تستمر بيئة العرض الاصطناعية فقط ما دام خادمها وقاعدة الاختبار يعملان.

The current isolated host was restarted on210ccf7; both accounts' fresh
authenticated reads returned their own0001 and404 for the foreign product.
This post-restart check is HTTP, not a second full browser journey.

## التسليم والاستئناف / Delivery and resume

التقرير:`docs/company-sku-ar-en.md`؛ الدليل الخام المنقح والصور والمصالحة
تحت`generated-artifacts/company-sku/`، وملفاWord/ZIP في`.local/outputs/`.
هذه المخرجات مستثناة منGit عمدًا، وتُسلّم فعليًا عبر المكتبة، وليست مجرد
أسماء ملفات داخل التقرير. `git-sync.json` في الحزمة يوثّقCommit تسليم الشيفرة
والتقرير ومساواة البعيد وقت الرفع؛ قد يلحقهCommit خاص بفهرسة ملفات المكتبة،
لا تغيير تنفيذي فيه. أحدثSHA يُذكر صراحة في رد التسليم.

لا متبقٍ برمجي مثبت داخل تصحيحSKU المحدد. القيود الخارجية المذكورة أدناه
لم تُستكمل بهذه المهمة. نقطة الاستئناف: مراجعة هذا التسليم عند طلب المستخدم؛
لا تنفيذ لمرحلة تالية أو اختبارات إضافية تلقائيًا.

The report, actual Word file and evidence ZIP distinguish all three runs and
the native/source limitations. Generated deliverables are intentionally ignored
byGit and delivered through the Library. The packaged git-sync record verifies
the release commit; a later Library-index-only commit may follow. No proved
implementation defect remains inside this SKU correction. Do not start another
scope automatically.

## الحدود / Limits

لا قبول ضريبي إنتاجي؛ `TAX_POLICY_NOT_READY` باقٍ. لم تتغير صلاحيات كتالوج
الأدوار القديمة، ولم يُعَد اختبار أجهزة فعلية أو إرسال خارجي. أكواد المتغيرات
والتصنيفات المشتركة كما سبق. لا ادعاء اكتمالERP أو المتجر أو غياب جميع العيوب.
ملف العرض التعريفي لم يتغير: لا يتضمن ادعاء التفرد العام؛ ادعاء عزل الشركات
القائم لم يتغير معناه بهذا التصحيح، فلا سبب لإعادة تصديره.

No production tax activation, external delivery, hardware certification,
general storefront acceptance or variant-policy migration. The original deck
has no global-SKU claim needing correction; its company-isolation claim is
unchanged, so the original PDF is intentionally retained.
