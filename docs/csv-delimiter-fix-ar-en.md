# تصحيح اكتشاف فاصل CSV / CSV delimiter correction

## النطاق / Scope

تصحيح محدد في استيراد الأصناف الأساسية، على مشروع حاسبة القائم ومستودع
`Abdullah-Almutairi12/Hasiba`، فرع`sync/hasiba-erp-20261023`.
نقطة البداية`b7b67034f8d2dc0d51723d29965e83548cf6aed3`، شجرة نظيفة،
ولم توجد فروق بعيدة عند الجلب. لا تغيير لـmain أو الإنتاج أو الصلاحيات أو
الترحيلات أو قيدSKU العام أو بوابة`TAX_POLICY_NOT_READY`.
العرض الاستثماريPDF ومصدره لم يتغيرا بسبب هذا التصحيح.

This correction is limited to delimiter detection in the existing basic,
create-only product import. No new formats, general import engine, permission
system, migration, tenant-SKU migration, tax activation or production deployment.

## السبب والإصلاح / Cause and correction

كان الاختيار يقارن عدد`,` و`;` في أول سطر نصي، بما في ذلك داخل القيم
المقتبسة. لذلك يختار فاصلًا خاطئًا ثم يرفض ملفًا صحيحًا بسبب الاقتباس.
التصحيح يعيد استخدام محللCSV القائم لتجربة الفاصلين على كامل السجلات
المنطقية؛ يحترم`""` والأسطر داخل الخلايا وLF/CRLF/CR. لا يقبل تفسيرات مختلفة
صحيحة بصمت، بل يرفض الالتباس برسالة عربية واضحة. لا يُسمح بتفسير احتياطي
أحادي العمود لإخفاء عدم اتساق الأعمدة أو تجاوز الحد الأقصى.
أضيف فحص الحد12عمودًا عند إضافة الخلية أيضًا حتى لا يُفقد عند إنهاء الصف.
UTF-8 الصارم،256KiB،500صف بيانات،128حرفًا للخلية والأصفار البادئة محفوظة.

The previous first-physical-line punctuation count included quoted delimiters.
The existing parser now validates both supported separators over complete
logical records, respecting escaped quotes and embedded newlines. Different
valid interpretations are explicitly rejected. A one-column fallback cannot
rescue malformed or over-wide multi-column input. The12-column limit is also
checked at cell insertion, including the last cell of a record.

## إثبات قبل/بعد / Before and after

السجلان الجديدان مستقلان عن قبول1نوفمبر:

- قبل إصلاح المكتبة:37اختبارًا،28ناجحًا و9إخفاقات متوقعة، رمز عملية الاختبار1.
  شملت الإخفاقات الحالتين المرفقتين، والاقتباس المهروب/متعدد الأسطر،
  والالتباس وعدم اتساق الأعمدة وحدودها، والمسار الكامل عبرAPI للفاصلين.
  جميع اختبارات الاستيراد السابقة24بقيت ناجحة.
- بعد الإصلاح:37/37ناجحًا،0إخفاق،خروج0. منها11اختبار قراءة و26اختبارAPI
  علىPostgreSQL معزولة، بما فيها اختبارات الاستلام/الاسترجاع والتزامن
  وسحب الصلاحية والعزل القائمة. هذه أعداد مجموعة موجهة لا تضاف إلى الإجمالي.
- ملفاAPI الجديدان يحويان الحقول المطلوبة كلها، وربطًا صريحًا، ومعاينة
  دون إنشاء أصناف، وتأكيدًا واحدًا، وقراءةDB مستقلة للقيم، واسترجاع النتيجة
  نفسها، وثبات أعداد حركات وطبقات المخزون والقيود.

New targeted runs: before the library fix,28 passed/9 failed of37 (test-process
exit1); after the fix,37 passed/0 failed (exit0). The previous24 import cases
remain intact. The two new API cases cover parsing, mapping, preview without
product writes, confirmation, persisted values and receipt replay with no extra
stock or journal records. Parser tests cover both reported cases, quoted
punctuation, escaped quotes, logical multiline records, LF/CRLF/CR, ambiguity,
broken quoting, width and existing transport/cell limits.

## المصدر / Source

- المصدر التنفيذي المثبت:`c278944bd95140e753c2750d6e9e0e9bcbdc781f`.
- بصمة التنفيذ:`bbf71601c66a090e3d55768a3cc3c4b7d3e161541494c59130df6199e3515756`.
- الملفات التنفيذية/الاختبارات:
  - `artifacts/api-server/src/lib/product-import.ts`
  - `artifacts/api-server/src/lib/product-import-csv.test.ts`
  - `artifacts/api-server/src/routes/product-imports.test.ts`
  - `artifacts/api-server/src/test/product-import-browser.ts`
  - `artifacts/api-server/src/test/product-import-reconcile.ts`
- تعديلا أدوات تجربة المتصفح يسمحان بمجلد أدلة مستقل عبر وسيط سطر أوامر،
  دون استبدال أدلة التسليم السابق أو بيانات وصوله الاصطناعية.

## القبول النهائي الجديد / Fresh final acceptance

أُغلق التصحيح المحدد بنجاح؛ لا عيب مثبت باقٍ ضمنه. لم يُستخدم قبول1نوفمبر
بدل إعادة التشغيل. تشغيل واحد نهائي على المصدر أعلاه:

- `pnpm run verify` بدأ`2026-11-02T15:36:39Z` وانتهى`2026-11-02T15:55:51Z`
  (18:36:39–18:55:51 الرياض)، خروج0، **15/15بوابة**.
- API: **1173ناجحًا،0فاشل،1متجاوز مشروط،الإجمالي1174**.
  المتجاوز هو`upgrade preserves a pinned previous installation and its financial relationships`
  المقيد بـ`HASBA_MIGRATION_REFERENCE`؛ نجح في بوابة الترقية المستقلة:
  1ناجح و38خارج مرشح التشغيل. لا تُضاف هذه الحالة مرة ثانية إلى1173.
- UI: **377ناجحًا،0فاشل،0متجاوز**،68ملفًا.
- الأنواع، اختبارات العزل وأدلة التنظيف الثلاث، الترقية،API،UI، بناءAPI
  والواجهات الأربع، تدقيق الاعتماديات، وثبات بصمة المصدر نجحت جميعًا.
  تدقيق الاعتماديات:0تنبيهات بالمستويات كافة، وليس ضمانًا لانعدام الثغرات.
- المجموعة الموجهة37اختبارًا **جزء من إجماليAPI وليست إضافة إليه**.
  لا إعادة تلقائية للبوابات بعد النجاح.

One fresh full release run completed on the frozen source,15:36:39–15:55:51UTC,
exit0:15/15 gates;1173 API passed,0 failed,1 conditional upgrade skip of1174;
377 UI passed in68 files. The conditional upgrade case independently passed
(1 selected/38 filtered), not added again to the API total. Types, all builds,
audit and source-unchanged checks passed. Previous acceptance remains historical.

### رحلة المتصفح / Native browser journey

أدلة المتصفح الجديدة بين`15:38:10Z` و`15:41:43Z`، على الواجهة الأصلية`/products`،
ودخول طبيعي بحساب اصطناعي في قاعدة مستقلة:

1. `quoted-comma.csv`:8أعمدة وصفان، ربط الرأس العربي ذي الفواصل بـ`nameAr`
   وبقية الأعمدة صراحة؛ معاينة2صالح/0خطأ. قراءة المنتجات المستقلة قبل
   التأكيد أعادت`[]`. التأكيد مرة واحدة أنشأID3و4.
2. `quoted-semicolon.csv`:المسار نفسه،معاينة2صالح/0خطأ؛ القراءة قبل التأكيد
   أظهرت3و4فقط، لا أكواد الملف الجديد. التأكيد أنشأID5و6.
3. الأسماء العربية مع الاقتباس والسطر الجديد، والأكواد والباركود بأصفارها،
   والاسم الإنجليزي والوحدة والفئة والأسعار والتكاليف طابقت الملفات.
4. إعادة رفع الملف الأول:0صالح/4أخطاءتكرارSKU/باركود؛ لم يُؤكد، بقيت4أصناف.
5. ملف`a,b;c` و`x,y;z` رُفض برسالة«فاصلCSVملتبس» وحالة400، ثم نجح اختيار
   ملف صحيح وعاد ربط الأعمدة الطبيعي. لا تعديل للواجهة لأجل الاختبار.
6.8صورJPEGفعلية؛ فُحصت بصريًا عينتا المعاينة ورسالة الالتباس.
   خريطة مصدر وحدة الواجهة المقدمة فعليًا تطابق ملف المصدر المجمد، وخادم
   التجربة يسجلSHAوبصمة التنفيذ نفسيهما. لا اختلاف مصدر تنفيذي مع الاختبارات.

Two full valid CSV files (one per delimiter) completed original-UI upload,
explicit mapping, server preview without product writes and one confirmation.
IDs3–6 matched every fixture value. Duplicate preview rejected all duplicate
codes without writing. The ambiguous CSV visibly failed, and selecting a valid
file afterward restored mapping. Eight fresh JPEGs and served-source proof are
included. This native run did not repeat XLSX, lost-response or revocation flows;
their unchanged permanent API regressions ran in the fresh complete suite.

### مصالحة مستقلة / Independent reconciliation

- قراءة228جدولًا قبل/بعد؛4أصناف جديدة فقط، ولا تغير في أي صنف سابق.
-27جدولًا محميًا للمخزون والطبقات والتكلفة والحركات والمالية والتاريخ
  بقيت متطابقة بعدد الصفوف وبصمات محتواها. المخزون لكل صنف جديد`0.0000`.
- قراءةSQL مستقلة`READ ONLY`، مع`::text` للقيم العشرية، أثبتت السعر`12.30`
  والتكلفة`4.50` والأسماء والوحدات والفئة والأكواد والباركود والشركة.
- إيصالان مكتملان فقط، كل منهما2مقبول/0مرفوض، وأكواد منتجاتهماID3–6
  تطابق القاعدة؛ حدثا تدقيق`product_import.committed` فقط لهذه الشركة.
- التغيرات الأخرى المرصودة ليست مخفية: تهيئة أمان الحساب الاصطناعي،
  جلسة الدخول وlastLoginAt، ومهمة التنظيف القائمة وإعدادها التشغيلي.
  الجداول المتغيرة:
  `account_security,alerts_cleanup_runs,app_settings,audit_logs,financial_requests,products,session,users`.
  لا ادعاء بأن228جدولًا كلها لم تتغير.
- تشخيص مساعد أول قارن رقمJSON`12.3` بالنص`12.30` ففشل في تمثيل القيمة،
  لا في حفظها؛ حُسم بقراءةSQLنصية مستقلة، دون تعديل التطبيق.
  محاولة تشغيل أداة التشخيص من جذر لا يملكtsx لم تبدأ الأداة؛ أُعيد
  تشغيلها من حزمةAPI ببيئتها القائمة، دون تثبيت اعتماديات.

Read-only reconciliation compared228 tables: all27 protected stock/valuation/
financial/history tables and all original products were unchanged. Four exact
new products had zero stock. Two committed receipts account for exactly IDs3–6,
with two import audit events. The eight changed tables are listed explicitly;
authentication initialization and existing housekeeping are not claimed absent.
A diagnostic numeric JSON/string mismatch was resolved through typed SQL text
reads, not an application edit. A root-level missing-tsx diagnostic invocation
was corrected by using the API package's existing runtime.

### الأدلة والتوقف السابق / Evidence and prior interruption

كل الأدلة الجديدة في`generated-artifacts/csv-delimiter-fix/`:
`before*`,`after*`,`release*`,`report.json`,`native-events.json`,`screenshots/`,
`reconcile-*.json`,`independent-exact-values.json`,`served-source-proof.json`.
تشغيلverifyالذي بدأ عند تشغيل مساحة العمل أُوقف عمدًا قبل تعديل الشيفرة،
وحُفظ منفصلًا في`startup-interrupted-verification/`؛ ليس قبولًا جديدًا.
انتهاء مهلة أمرين لانتظار السجل لم يوقفverifyولا يمثّل فشل اختبار؛ التشغيل
نفسه انتهى بخروج0 المحفوظ. سجل الاختبارقبلالإصلاح له خروج1 رغم أن غلاف
حفظ السجل انتهى بـtailوخروج0؛`before-exit.txt` هو رمز عملية الاختبار الفعلي.

The startup-triggered verification was deliberately stopped before editing and
retained separately, not accepted. Log-wait command timeouts did not terminate
the actual release run. The pre-fix test process returned1; its logging wrapper
ended with successful tail (0), explicitly distinguished in provenance.

التقرير والدليل فقط أُضيفا بعد تجميد الشيفرة، ومعهما ذاكرة درس للمصالحة؛
لا تغير في بصمة التنفيذ. حالة الرفع المؤكدة محفوظة في`git-sync.json`
بالحزمة، وقد يليهاCommitتسجيل ملفاتLibraryفقط، يذكر مرجعه النهائي في رسالة
التسليم. المخرجات المستثناة منGit تسلّم كملفات تنزيل، ولا تدّعي وجودها فيGitHub.
Wordتم التحقق منZIP/XMLونصه العربي، لا فتحه فيMicrosoftWordالمكتبي.

Documentation and evidence registration after the source freeze do not change
the executable fingerprint. git-sync.json records the confirmed sync snapshot;
a later Library-only bookkeeping commit may be identified in the closing reply.
Ignored binary evidence is delivered separately, not claimed present in GitHub.
The report DOCX is XML/ZIP validated, not desktop-Word tested.

## الحدود / Limits

لم تُغيّر آلية المحاولات أو الخدمات المالية أوXLSX. اختبارات الانحدار القائمة
تغطي منع التكرار والعزل والصلاحيات؛ رحلة المتصفح الجديدة تخصCSV فقط.
لا استيراد عملاء أو موردين أو أرصدة أو فواتير، ولا توسيع لصلاحياتERP.
الاقتباس الصحيح هوASCII`"` وليس علامات الاقتباس الطباعية المائلة.
لا يدّعي هذا التصحيح اكتمال نظام المتجر أو انعدام جميع أخطاء البرنامج.

The fresh native scope is CSV. No claim of new physical device/network testing,
general storefront readiness, production tax approval or absence of all defects.
