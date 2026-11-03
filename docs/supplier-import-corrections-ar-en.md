# إصلاح مراجعة استيراد الموردين / Supplier import review corrections

**أُغلقت الإصلاحات الأربع بنجاح ضمن نطاقها المثبت؛ 3 نوفمبر2026.**

## النطاق والمصدر

أربع مشكلات المستخدم فقط، على المشروع القائم والمستودع
`Abdullah-Almutairi12/Hasiba` والفرع `sync/hasiba-erp-20261023`.
البداية النظيفة `8869bc07907c485173df9324eb3adb9c7633b45c`؛ التسليم التنفيذي
السابقb741dde محفوظ في التاريخ، ولم يُستبدل أي عمل أحدث.

المصدر التنفيذي الجديد:
`6663c4c4177a29459eb53cd9be28e6301d8ca4f7`، البصمة:
`2eb1ae526ef6de04f99a29c2216a4a9066fe73e4499fb033441f84225c4a33d5`.
لا تعديلmain أو نشر أو بيانات تشغيلية أو إرسال خارجي. لا استيراد عملاء،
ولا توسع مالي أو ضريبي أو إعادة بناء الاستيراد. يبقىTAX_POLICY_NOT_READY.

## المشكلات والتصحيح

| المشكلة المثبتة | التصحيح المحدود |
|---|---|
| رفض «اسم الشركة» وCompany Name وSupplier Company Name رغم ربطها بالاسم | قبول عنوان اسم مورد طبيعي معروف فقط عندما يربط صراحة بحقلname؛ منعcompanyId/balance/iban والحقول غير المدعومة باقٍ، وكذلك منع ربطCompany Name بالملاحظات للتحايل |
| سحب موافقة التشابه بعد معاينة مؤكدة يبقي الحفظ فعالًا | الحفظ يشترط الموافقة الحالية وتأكيد المعاينة معًا؛ أي تغيير للمربع يبطل تأكيده المحلي، وإعادته تحتاج معاينة جديدة |
| الرقمNULL يوصف «غير مسجل» | أصبح «الرقم الضريبي غير متوفر»، دون أي تعديل لحالة التسجيل أو التاريخ |
| المعاينة تعرض السجلات الصالحة فقط وتعيد ترقيمها |previewRows منفصلة عنsuppliers: جميع الصفوف مع رقم المصدر وقيمه الخام والحالة وأخطاء الصف؛ السجلات الصالحة فقط في قائمة الحفظ |

تظل الشركة من الجلسة، وليست العناوين مصدر صلاحية أو ملكية. القائمة
المسموحة للكتابة لم تتغير. أسماء الشركة في هذه العناوين أوصاف للمورد.
الحفظ ذري ومحجوب عند أي خطأ؛ عرض صف خاطئ لا يجعله صالحًا للإدخال.

الصف1 للعناوين، وأول سجل2، والأرقام نفسها في الجدول والأخطاء والتحذيرات.
القيم الخاطئة، بما فيها البريد أو خلية رقمية، معروضة وليست مخفية.
أخطاء العناوين أو الربط العامة تبقى في الصف1 وتحجب الدفعة كلها، حتى
لو كانت قيم بعض صفوف البيانات صالحة. التشابه يظهر أيضًا على صفه.

سحب موافقة محلية قبل الإرسال يمنع الطلب؛ لا يدّعي إلغاء طلب سبق إرساله.
المربع معطل أثناء المحاولة المجهولة، ولا يحذف أصلها أو يغيّر جسمها
أو معرفها. الاسترجاع والإغلاق الآمن والخدمات والأقفال والصلاحيات القائمة
باقية. صلاحية المعتمد/المسؤولية لا تؤخذ من نوع عنوان الملف.

## إثبات قبل الإصلاح

أضيفت اختبارات دائمة إلى التنفيذ السابق قبل تعديل الشيفرة التنفيذية.
لم تكن الشجرة حينها نسخة قبول نظيفة جديدة: تغيّر ملفا الاختبارات لإظهار
الإخفاقات، بينما بقي تنفيذ الاستيراد كالسابق.

- PostgreSQL المعزولة:25 اختبارًا،19 ناجحًا و6 فاشلة، خروج1.
  ثلاث حالات عناوين طبيعية، وثلاث حالات معاينة مختلطة/خاطئة/صحيحة بالكامل.
- الواجهة:12 اختبارًا،7 ناجحة و5 فاشلة، خروج1.
  سحب الموافقة، نص الرقم المفقود، وثلاث حالات عرض الصفوف وترقيمها.
- ليست11 مشكلة مستقلة؛ إنها اختلافات اختبارية للمشكلات الأربع.
- بعد التصحيح:13/13 اختبار واجهة موجهًا ناجحًا؛ الحالة الإضافية تثبت
  الاحتفاظ بالمحاولة المجهولة بعد الإرسال رغم محاولة تغيير الموافقة.
- ظهر خطأ أنواع أثناء التطوير في فهرسة قيم الصف، وعولج بمفتاح النوع
  المولّد. السجل محفوظ، وفحصا الأنواع والتوليد نجحا بعده.

السجلات المنقحةbefore-api وbefore-ui وafter-ui لا تُستبدل بنتائج قديمة،
ولا تُجمع المجموعات الفرعية فوق الإجمالي الشامل.

## العقد والملفات

- `artifacts/api-server/src/lib/supplier-import.ts`: استثناء عنوان الاسم
  المربوط فقط، وبيانات معاينة كل سجل مستقلة عن مرشحي الحفظ.
- `artifacts/api-server/src/routes/supplier-imports.test.ts`:9 حالات جديدة،
  إلى جانب حالات العزل والحدود والصلاحيات والذرية والأقفال القائمة.
- `artifacts/erp-system/src/components/supplier-import-dialog.tsx`: موافقة
  قابلة للسحب، وصف دقيق، جدول كل الصفوف ورقم المصدر والحالة والأخطاء.
- `artifacts/erp-system/src/components/supplier-import-dialog.test.tsx`:
  اختبارات الموافقة المسحوبة/المعادة والمحاولة المجهولة والنص والصفوف.
- `artifacts/erp-system/src/lib/supplier-import-api.ts`: استهلاك نوع المعاينة
  المولّد بدل نسخة مكررة يدويًا.
- `lib/api-spec/openapi.yaml`: استجابة محددة لنتائج التحليل والمعاينة
  والاكتمال/الإغلاق، معpreviewRows وvalues/status/errors.
- أعيد توليدapi.schemas.ts وapi.ts للعميل وapi.ts لـZod؛ لا تحرير يدوي
  للمخرجات المولدة. لا تغيير مخططDB أو ترحيل جديد أو محرك حسابات.

## البوابات النهائية الجديدة

تشغيل جديد واحد مكتمل على المصدر6663c4c، لا إعادة تسمية لقبولb741dde:

| الفحص | النتيجة الجديدة الفعلية |
|---|---|
| البدايةUTC |2026-11-03T06:28:08Z|
| النهايةUTC |2026-11-03T06:45:33Z|
| بتوقيت الرياض |09:28:08–09:45:33 يوم3 نوفمبر2026|
| رمز الخروج |0|
| البوابات |15/15 ناجحة، بما فيها الأنواع والبناء وتدقيق الاعتماديات وعدم تغير المصدر |
| اختباراتAPI |1210 ناجحة،0 فاشلة،1 متجاوزة مشروطة |
| اختباراتUI |390 ناجحة،0 فاشلة،0 متجاوزة |
| انحدار الموردينAPI ضمن الإجمالي |25/25 ناجحًا؛after-api مستخرج من تشغيلAPI نفسه وليس تشغيلًا إضافيًا |
| انحدار واجهة الموردين ضمن الإجمالي |13/13 ناجحًا، ومثبت أيضًا بالتشغيل الموجه |
| الترقية المستقلة |1 ناجح،38 مستبعدة بمرشح الاختبار؛ الترقية من النسخة المثبتة نجحت |
| المصدر والخادم والمتصفح |6663c4c والبصمة2eb1ae…a33d5 متطابقة |

الحالة المتجاوزة فيAPI هي حالة الترقية التاريخية المشروطة؛ شُغّلت بوابتها
المستقلة بنجاح. ليست تخطيًا للمشكلات الأربع. الأعداد الفرعية ليست إضافات
للإجمالي. لم يُعاد تشغيل البوابات بعد نجاحها. تغييرات التقرير والذاكرة
والفهرس اللاحقة لا تغير البصمة التنفيذية؛ آخر رفع موثق وقت الحزم في
git-sync.json، ويُميّز عن مصدر الاختبار. قد يلحقهcommit فهرسة ملفات
Library فقط، ويُذكر آخرSHA النهائي في رسالة التسليم.

## رحلة الواجهة والمصالحة

اكتملت الرحلة على المصدر نفسه في قاعدةPostgreSQL اصطناعية، بدخول عادي
للشركتين6 و7. لا تجاوز مصادقة، ولا تغيير مورد سابق.

| الرحلة | ما ثبت فعليًا |
|---|---|
| mixed.csv وعنوان «اسم الشركة» | جميع الصفوف2/3/4 وأسمائها وبريدها ظاهرة؛2 و4 خاطئان و3 صالح؛ الحفظ معطل ولاcommit |
| all-invalid.xlsx وعنوانSupplier Company Name | الصفان2 و3 الخاطئان بقيمهما وأخطائهما ظاهران؛0 صالح والحفظ معطل |
| valid.csv وعنوانCompany Name | صفان صالحان2 و3؛ تحذير التشابه يتضمن «الرقم الضريبي غير متوفر» للسجل القديم ذيNULL |
| سحب الموافقة | بعد تأكيد المعاينة تعطل الحفظ فورًا عند إزالة العلامة؛ سجلات النقل تؤكد0 طلبcommit قبل التأكيد الفعلي |
| إعادة الموافقة | إعادة العلامة وحدها لا تكفي؛ ظلت معطلة إلى معاينة جديدة صحيحة |
| محاولة مرسلة وفقد رد | الخادم أكمل200 بالمعرفين14 و15 قبل قطع الرد؛ المربع بقي معطلًا والمجهول محفوظًا؛ بعد إعادة التحميل استُرجعت النتيجة نفسها بالمعرف والرمز الأصليين |
| الشركة الثانيةXLSX | قُبل العنوان والرقم نفسه في شركة أخرى، وأُنشئ16؛ بقي السجل13 القديم بلا تغيير |

أُنشئت3 سجلات فقط في محاولتين مكتملتين، ورصيد كل منها0.00 بنصSQL.
لا تكرار رقم داخل الشركة، ولا تكرار بعد فقد الرد. لا دمج بالاسم.

المصالحة مستقلة، للقراءة فقط فيREPEATABLE READ، وبصمات228 جدولًا.
بقيت29 مجموعة مالية/مخزنية، بما فيها السنوات والفترات، دون تغير.
كل صف مورد سابق مطابق حرفيًا، بما فيه الرصيد التاريخي7.25.
221 جدولًا مطابق بالكامل، والاختلافات الأخرى محددة للإدخال الجديد
وإيصالاته وتدقيقه والجلسات وتسجيل الدخول وتدقيق تنظيف التنبيهات.

أظهر الفحص الأول، وهو أوسع من الأثر التجاري، تغيرapp_settings. لم يُخف
سجله ولم يُعلن نجاحه: الخدمة القائمة لتنظيف التنبيهات حدثت
system.lastAlertSweep وupdated_at عند06:32:20Z، قبل تأكيد الاستيراد.
تحققت المصالحة من السجل القديم الوحيدid1، دون مالك أو فرع أو مراجعة
إعداد جديدة، وأن جميع الإعدادات الأخرى افتراضات فارغة، ومفتاحsystem
الوحيدlastAlertSweep، ومصدر الاحتفاظdefault كما في الخدمة القائمة،
وتوافق التوقيت. لم تُسقط مقارنة أي جدول مالي أو مخزني أو مورد سابق.
احتفظت الحزمة بالتشخيص الأول، وفصلت بيانات التشغيل هذه عن أثر الاستيراد؛
نتيجة المصالحة النهائية ناجحة دون تغير تجاري غير مفسر.

## الأدلة والحدود

السجلات الجديدة منفصلة فيgenerated-artifacts/supplier-import-corrections،
والتقرير النهائي يُسلّم معWord وZIP منقحين. لا تضم الحزمة ملف الوصول
الخاص أو أسرار البيئة أو الرموز الخام أوcookies.

لا اختبار إنتاجي أو أجهزة أو طباعة أو قبول زاتكا أو تنزيل نظام تشغيل
قالب الاستيراد أوWord مكتبي. التحقق البصري للواجهة الأصلية يُفصل عن
الاختبارات المحاكاة. لا ادعاء أنERP كله خالٍ من الأخطاء.
لا نطاق تالٍ تلقائي؛ التقدم التالي مراجعة هذا التسليم عند طلب المستخدم.

## English report

Scope: four reported supplier-import defects only, preserving release8869bc0
and executableb741dde on the existing repository and work branch.
New executable6663c4c4177a29459eb53cd9be28e6301d8ca4f7, fingerprint
2eb1ae526ef6de04f99a29c2216a4a9066fe73e4499fb033441f84225c4a33d5.
No main,production,real customer data,external sending,customer import or tax
activation. No replacement permission/import system.

Natural supplier-company name headers are accepted only when mapped to name.
Ownership IDs,balances,banks and unsupported mappings remain rejected. Trusted
session ownership is unchanged. Current consent AND a compatible confirmed
preview are required; toggling consent invalidates local confirmation and
requires fresh review. Sent/unknown operations retain original durable intent.
Missing VAT is now described as unavailable, not unregistered.

The response now separates ALL source records in previewRows from valid
insertable suppliers. Source record numbers start at2 after header1 and match
errors/warnings. Values,status,per-row errors are visible even for invalid
records. Header/global errors still block the whole atomic import.
OpenAPI response models were specified and regenerated; the frontend consumes
the generated preview type. No database schema or posting changes.

Before execution changes: isolated PostgreSQL25 tests,19 passed/6 failed;
UI12 tests,7 passed/5 failed. These are variants of the four defects, not eleven
separate application bugs. After UI correction13/13 passed, including an
additional unknown-intent preservation case. A development-only type indexing
error was fixed, with its log retained and successful subsequent type checks.
Native journey passed the mixed2/3/4 source-row preview, all-invalid XLSX2/3,
natural headers in Arabic/English, exact missing-VAT text, immediate disable on
withdrawal, no commit while withdrawn, and mandatory fresh review on rechecking.
Real server completed200 with IDs14/15 before the isolated transport dropped its
response. The disabled consent control could not erase the pending intent; reload
and query-only recovery returned identical IDs/key/tokenHash. CompanyB XLSX
created16 with independently reused VAT and preserved original13.

Independent read-only reconciliation:228 tables,221 byte-for-byte unchanged
tables,29 protected financial/inventory groups unchanged, all original supplier
rows unchanged, three new zero-balance suppliers and two receipts. The initial
broad check flagged existing alert-cleanup operational metadata in app_settings;
its diagnostic is retained. The original singleton/default shape, sole
lastAlertSweep key, default retention source and06:32:20Z timing were verified
against the existing scheduler writer; no business-table comparison was removed.
Final reconciliation passed with no unexplained business changes.

NEW full verification completed2026-11-03 from06:28:08Z to06:45:33Z, exit0:
15/15 gates,1210 API passed/0 failed/1 conditional upgrade case skipped,
390 UI passed/0 failed/0 skipped. Dedicated pinned-upgrade gate passed1 selected
case with38 filtered out. Supplier API25 and UI13 are subsets, NOT additive.
The dedicated upgrade passed separately rather than treating the conditional
skip as proof. Types/builds/dependency audit/source-unchanged all passed. Browser,
API host and tests share the exact6663c4c executable fingerprint above. No further
automatic verification cycle was started. Later documentation/Library-index
commits do not change executable fingerprint; git-sync.json identifies the push
confirmed when packaging, and the delivery message identifies the final push.
Old15/15/1201/385 acceptance remains historical, not evidence for these changes.

Not tested: production deployment/services,real customer data,physical devices,
printing,ZATCA production acceptance,OS-level template download or desktop Word.
DOCX ZIP/XML and evidence ZIP CRC/per-file hashes are validated. Only the four
reported defects are closed; no claim of an error-free ERP or complete import
ecosystem. No next scope started.
