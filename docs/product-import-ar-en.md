# استيراد الأصناف الأساسية — Basic catalogue import

## تصحيح CSV — 2 نوفمبر2026 / CSV correction

إصلاح اكتشاف الفاصل موثق بصورة مستقلة في
[`csv-delimiter-fix-ar-en.md`](csv-delimiter-fix-ar-en.md). نتائج1 نوفمبر أدناه
تبقى قبولًا تاريخيًا وليست نتائج تشغيل الإصلاح الجديد.

CSV يدعم الفاصلة العادية`,` أو المنقوطة`;`، مع علامات اقتباس ASCII`"` حول
القيم التي تتضمن فاصلًا أو سطرًا جديدًا، ومضاعفة الاقتباس الداخلي`""`.
يُختبر الملف كسجلات منطقية كاملة، لا بعدّ علامات أول سطر نصي.
يلزم اتساق عدد الأعمدة. إذا نتج تفسيران صحيحان مختلفان، يُرفض الملف برسالة
«فاصل CSV ملتبس»؛ وحّد الفاصل واقتبس علامات الفصل التي تنتمي إلى القيم.
لا تغيّر الأكواد النصية أو أصفارها البادئة أثناء التصحيح.

CSV accepts comma or semicolon separators, ASCII double-quoted fields, doubled
embedded quotes and embedded line endings. Detection validates complete logical
records and consistent widths. Two different valid interpretations are rejected
explicitly rather than guessed. Quote punctuation belonging to cell values.
All previous size limits, create-only scope, authority and retry rules remain.

## نطاق العمل وحالته / Scope and status

اكتملت هذه الشريحة المحددة برمجيًا وبالأدلة أدناه على المشروع القائم وفرع `sync/hasiba-erp-20261023`.
نقطة البدء المحفوظة `0b0847f`؛ لا إعادة بناء لأوامر البيع أو الضرائب.
هذا سجل الشريحة الجديدة، وليس قبولًا عامًا للمتجر أو جميع المستوردات.

Implemented path: original Products → CSV/XLSX import → server parsing →
explicit column mapping → read-only preview → explicit atomic create-only
confirmation → durable receipt / recovery / safe closure.
The native journey and a fresh complete release run are now finished. Historical
results are not attributed to this implementation.

## نتيجة القبول الجديدة — 1 نوفمبر2026 / Fresh final acceptance

- المصدر المختبر ومصدر خادم التجربة: `d4dca522c4500241c62ec2b05fa2b65d7d1b64f4`.
- بصمة التنفيذ: `711c0b68b7a34fa8da1defe42fe4af424e5049cfa8985deb8b6b1a4e4632d894`.
- تشغيل واحد نهائي لـ`pnpm run verify`: البداية `2026-11-01T06:39:12Z`،
  النهاية `2026-11-01T06:55:44Z`؛ أي09:39:12–09:55:44 بتوقيت الرياض؛ خروج0.
- **15/15 بوابة ناجحة**: الأنواع، اختبارات مشغّل العزل وأدلة تنظيف المستندات
  الثلاث، الترقية المستقلة، الخادم، الواجهة، بناء الخدمات/العرض/الدليل/المعاينة،
  تدقيق الاعتماديات، وعدم تغير المصدر أثناء التشغيل.
- API: **1160 ناجحًا،0 فاشل،1 مستبعد**. الاستبعاد المشروط بمرجع الترقية هو
  `upgrade preserves a pinned previous installation and its financial relationships`.
  هذه الحالة نفسها نجحت في بوابة الترقية المستقلة:1 ناجح و38 حالة خارج مرشح
  ذلك التشغيل الموجّه؛ لا نضيفها مرة أخرى إلى إجمالي API.
- UI: **377 ناجحًا،0 فاشل،0 مستبعد**، ضمن68 ملفًا.
- اختبارات الاستيراد الجديدة: **24 PostgreSQL و13 واجهة**، وهي أجزاء من الإجماليين
  أعلاه، وليست أعدادًا إضافية. تدقيق الاعتماديات نجح؛ لا يعني ذلك انعدام ثغرات التطبيق.
- لم تبدأ دورة تحقق شاملة إضافية بعد هذا النجاح. السجل الخام والملخص
  `generated-artifacts/product-import/release-verification/`؛ البداية والنهاية
  ورمز الخروج محفوظة في ملفات`release-*.txt` والسجل`release.log`.

### رحلة الواجهة الأصلية والمصالحة

1. ملف CSV غير صالح: صفان،0 صالح،6 أخطاء مفصلة للأسعار والوحدات والتكرار؛
   لا تأكيد ولا كتابة.
2. CSV صالح: ربط الأعمدة، فك ربط SKU ثم تصحيحه، معاينة بلا حفظ، تأكيد صريح:
   الصنفان4 و5. بقيت الأصفار البادئة والأسماء العربية والأسعار والتكاليف صحيحة.
   إعادة استيراده أعطت4 أخطاء تكرار ولم تنشئ صنفًا إضافيًا.
3. XLSX صالح: الصنفان6 و7. لمحاكاة رد ضائع، مرّر غلاف`fetch` مؤقت داخل المتصفح
   الطلب الحقيقي، وانتظر رد200 وحالةcompleted، ثم تحقّق من وجود الصنفين بطلب
   قراءة مستقل إلى خدمة المنتجات **قبل** إخفاء الرد عن الواجهة ورفعAbortError.
   لا تتوافر`page.route/context.route` في أداة المتصفح المستخدمة؛ لذلك لم نختبر
   إسقاط حزمة شبكية أو انقطاع جهاز فعلي، ولا نصف الغلاف بأنه اختبار شبكة مادي.
4. بعد إعادة تحميل الصفحة بقيت بصمتا الجسم والمعرّف نفسيهما. سُحبت صلاحية الإنشاء
   في قاعدة الاختبار فقط: خيارات الاستيراد403، لكن استعلام النتيجة بقي ظاهرًا
   وأعاد الصنفين6 و7 دون تنفيذ آخر. أعيد دور الحساب الاصطناعي بعد الاختبار.
5. تسجيل خروج ودخول طبيعيان للشركة الثانية: قائمة منتجات فارغة. توجد8 صورJPEG
   فعلية، ومنها عرض390×844؛ هذا محاكي عرض، لا اختبار هاتف أو لوحي فعلي.
6. قراءة مستقلة لـ228 جدولًا قبل/بعد:4 أصناف جديدة فقط، بالمطابقة الدقيقة للأسماء
   والأكواد والأسعار والتكاليف ومخزون0؛ لم يتغير أي صنف سابق ولا أي من27 جدولًا
   محميًا للمخزون والتكلفة والمالية. إيصالان مكتملان فقط، كل منهما يقبل صنفين.
   طابقت بصمة معرّف المحاولة المخزنة دليل المتصفح، وبقي جسم الطلب ثابتًا بعد التحميل.
7. التغييرات غير المالية الأخرى المرصودة: جلسات الدخول وlastLoginAt وتهيئة سجلَي
   أمان للحسابين الاصطناعيين، وتشغيل مهمة التنظيف القائمة(0 محذوف) وتحديث
   `system.lastAlertSweep`. لم ندّع أن كل الجداول228 بقيت دون تغيير.
8. تطابق مصدر الخادم والاختبار، وتحقّق GET200 لوحدة الواجهة مع تطابق
   `sourcesContent` في خريطة المصدر مع ملف الواجهة المجمد. الأدلة:
   `host-source.json`, `tested-source.json`, `served-source-proof.json`,
   `journey-report.json`, `event-evidence.json`, `reconcile-*.json`,
   `independent-*.json`, `receipt-reconciliation.json`.

### المنفذ والمراجع والحدود / Delivery and limits

الخدمات الأصلية للمنتجات والمسؤوليات والمحاولات والتدقيق أعيد استخدامها.
لا ترحيلات قاعدة جديدة ولا تغيير حزم. الملفات الأساسية:
`artifacts/api-server/src/lib/product-import.ts`,
`artifacts/api-server/src/routes/product-imports.ts`,
`artifacts/api-server/src/routes/product-imports.test.ts`,
`artifacts/api-server/src/test/product-import-browser.ts`,
`artifacts/api-server/src/test/product-import-reconcile.ts`,
`artifacts/erp-system/src/components/product-import-dialog.tsx`,
`artifacts/erp-system/src/lib/product-import-api.ts`,
وصفحة المنتجات الأصلية، وعقدOpenAPI ومخرجات توليده. القائمة الكاملة في`source-files.txt`.

لم نعد تشغيل رحلة بيع أصلية جديدة؛ المطلوب هنا استيراد كتالوج، والرحلة الجديدة
تخصه فقط. اختبارات أوامر البيع القائمة ضمن البوابات لا تُعرض كرحلة متصفح بيع جديدة.
صلاحية إنشاء الأصناف الحالية للمالك/المدير/المخزون محفوظة؛ هذه الشريحة لا تحول
جميع صلاحيات الكتالوج إلى القوالب المفوضة، ولا تمنح إنشاءً بسبب صلاحية حركة مخزون.
لا JSON أو عملاء أو موردون أو أرصدة أو فواتير مستوردة؛ ولا تحديث لأصناف موجودة
أو استيراد دفعات/متغيرات/تتبع. هذه حدود صريحة وليست وظائف مكتملة.
يبقى قيدSKU العام موروثًا كما هو، وتصنيفات النظام مشتركة. لا قبول لمتجر كامل
أو ضريبة إنتاجية أو أجهزة فعلية. بيئة الرحلة اصطناعية مؤقتة وليست مخزن بيانات متجر حي.

حُدّث **ملف العرض الأصلي**`.local/outputs/Hasiba-AI-ERP.pdf` من مصدره،
بنفس هوية العرض ومعرّفات شرائحه32. تغيرت الصفحتان24 و31 فقط؛ بقية30 صفحة
متطابقة صوريًا مع النسخة السابقة. فُحصت جميع الصفحات بصريًا، والصفحتان المعدلتان
بالحجم الكامل، والنص المستخرج بلا رموز استبدال. بصمةPDF الجديدة:
`a11e876fc3bd41bb73490c9e0c98d09b80e4816e89b9690722497365d1d11ecc`.
ملفWord وحزمةZIP يسلمان كملفات فعلية. Word مكتوبUnicode منطقيًا وOOXML صحيح،
لكن لم يفتح في تطبيقWord مكتبي. ملفاتPDF/Word/ZIP والصور مخرجات مستثناة منGit،
وليست ملفات نزعم رفعها إلىGitHub؛ تسلم عبر بطاقات الملفات.

### English acceptance summary

Completed only basic, atomic, create-only CSV/XLSX catalogue import on the original
Products screen. A fresh final run on d4dca522 finished at06:55:44Z, exit0:
15/15 gates,1160 API passed/0 failed/1 conditionally skipped,377 UI passed.
The conditional upgrade case passed separately in the isolated upgrade gate;
24 new API and13 UI tests are already included in those totals.
Real PostgreSQL barriers exercise both execution/closure and execution/revocation
orders. The native browser run covered invalid mapping/data, valid CSV and XLSX,
duplicates, response loss after committed readback, reload, revoked-create receipt
recovery, and a separate company. Fault injection was a one-shot client fetch
wrapper—not physical network loss. Independent SQL reconciliation confirms four
exact new zero-stock products, two receipts, unchanged historical products and
protected stock/ledger tables. Authentication/cleanup side effects are separately
identified, not falsely described as zero changes to every table.

The frontend served source map, host and test fingerprints agree. The original
32-slide PDF was regenerated and visually checked. No dependencies, database
migrations, main changes, production deployment, external mail/payment or tax-gate
bypass. Legacy global SKU uniqueness and shared categories remain explicit limits.
No general importer, existing-product update, full-store readiness, device test or
production ZATCA acceptance is claimed. Later delivery commits contain reports
and asset bookkeeping only; the executable fingerprint remains the tested one.
Final GitHub synchronization is recorded in the delivery snapshot and closing reply.

## القرارات والحدود / Decisions and limits

- أصناف جديدة فقط، كل الصفوف أو لا شيء؛ لا تحديث صامت ولا مطابقة بالاسم.
- SKU والباركود نصيان؛ تُرفض الخلايا الرقمية لهما ولا تُخمّن أصفار مفقودة.
- كل عمود مربوط صراحة؛ لا تجاهل لأعمدة المخزون والضريبة والمتغيرات والتتبع.
- الأسعار غير السالبة مطلوبة صراحة؛ لا تحويل قيمة مجهولة إلى صفر.
- كميات ابتدائية صفر؛ حد أدنى5؛ تتبع none وطريقة average مثل إنشاء الصنف
  الأصلي. تكلفة الكتالوج ليست حركة تقييم مخزني.
- CSV UTF-8 أو ورقة XLSX واحدة؛256KiB،500صف،12عمودًا،128حرفًا للخلية.
  حد مستقل450000بايت لبيانات المعاينة الموقعة بعد الترميز.
- ZIP inflation is bounded before ExcelJS; formulas and unsupported cell types
  are rejected. No external file/resource service is used.
- يستخدم إذن إنشاء الأصناف الحالي؛ مسؤوليات حركة المخزون لا تمنحه ضمنيًا.
- SKU uniqueness is GLOBAL in the existing model. A hidden-company collision
  fails atomically with a generic unavailable-code error, without revealing
  the other company. This slice does not migrate that constraint.
- التصنيفات مرجع النظام المشترك القائم، وليست تصنيفًا مستقلًا جديدًا.
- لا أرصدة افتتاحية أو حركات مخزون أو قيود أو فواتير أو تحديث تاريخ التكلفة.
- `TAX_POLICY_NOT_READY` unchanged. No production, main, real mail/payment,
  device or ZATCA acceptance.

## دليل مختصر / Quick user guide

1. افتح «المنتجات» ثم «استيراد CSV / XLSX» بحساب مخوّل.
2. افتح مرجع أرقام الفئات والوحدات أو نزّل قالب CSV. اكتب أكواد SKU/الباركود
   كنص في Excel قبل إدخالها؛ التنسيق اللاحق لا يعيد الأصفار المفقودة.
3. ارفع الملف واربط كل عمود. احذف الأعمدة غير المدعومة من الملف نفسه.
4. عاين الصفوف والأخطاء. أرقام CSV تشير للسجلات لا أسطر محرر النص إذا احتوت
   الخلية سطرًا جديدًا. لا حفظ أثناء هذه الخطوة.
5. أكّد فقط بعد صلاحية جميع الصفوف؛ تعرض النتيجة معرّفات الأصناف المحفوظة.
6. إذا فُقد الرد لا تبدأ محاولة جديدة: أعد فتح النافذة واستعلم عن المحاولة.
   إعادة التنفيذ تستخدم جسم المحاولة ومعرّفها نفسيهما. الإغلاق الآمن يسترجع
   العملية المكتملة إن وجدت، أو يسجل منعًا دائمًا لتنفيذ طلبها المتأخر.
   رفض الوصول لا يثبت عدم التنفيذ. سجل متصفح غير قابل للقراءة لا يُحذف
   تلقائيًا؛ يحتاج معالجة أدلة، وليس مسحًا يدويًا أثناء محاولة مجهولة.

## تحقق التطوير / Development checks

22 targeted PostgreSQL tests and13 UI tests passed before the final two
execution/closure barrier cases were added. These are targeted results only;
the release counts will come from a new complete run.

The first concurrency harness awaited a membership writer while retaining
the catalogue blocker. The existing database authority trigger correctly
waited behind the execution reader, creating a test-induced cycle. Partial
and failed logs are preserved separately. The corrected tests exercise both
real linearization orders without weakening the authority fence.

UI review found and fixed recovery controls hidden behind revoked-create
options, old-scope asynchronous results, and overly permissive closure reply
handling. Permanent tests cover these cases; final outcomes are recorded above.

أخطاء أدوات التحقق الإضافية منفصلة عن التطبيق: لم تتوافرPIL/python-docx،
فاستخدمت أدوات الصور القائمة وOOXML القياسي دون تثبيت حزم. قرأت أداة تشخيص أولية
إيصالًا دون غلاف`value`، وقارنت أداة أخرى بصمتين مختلفتي التعريف: المتصفح يبصم الجسم،
والخادم يبصم`canonical({params,body,query})`. صُححت أدوات التشخيص، لا محرك المحاولات،
وتحقق تطابق المعرّف وثبات جسم المتصفح ونتيجة الإيصال. سجلاتها منفصلة عن النجاح النهائي.
