# حاسبة — إصلاح هوية العميل النقدي وربط أعمدة العملاء

التاريخ:3 نوفمبر2026. شريحة إصلاح محددة لاستيراد دليل العملاء CSV/XLSX،
وليست ميزة أو دفعة ERP جديدة.

## المصدر والحدود

المستودع Abdullah-Almutairi12/Hasiba، الفرع sync/hasiba-erp-20261023.
نقطة البداية المحفوظة2f6fe3e2ca26ba07bf578a50004f8a5604955795.
المصدر النهائي للاختبارات والخادم والمتصفح:
56c3322187a81b2b14f8636a79abd1ec0aa7c858؛ بصمته
f4e6e86fa96945fef671a271645f93c1ec5e360e8693d62fdd51cf7227910747.
Commit التقرير وتسجيل المرفقات اللاحقان لا يغيران مصدر التنفيذ.
آخر Push مؤكد ونظافة الشجرة وتطابق GitHub موثقة في git-sync.json
داخل الحزمة وفي رسالة التسليم. الأدلة المولدة مستثناة منGit، لا تُنسب
إليه لمجرد تسليم ملفات Word/ZIP.

لم نغيرmain أو ننشر للإنتاج أو نستعمل بيانات تشغيلية أو نرسل بريدًا
أو ندفع خارجيًا. TAX_POLICY_NOT_READY باقٍ؛ لا تفعيل ضريبي.
لا ترحيلات قاعدة أو حزم أو محرك استيراد/محاولات أو موافقات جديد.
لا تحديث/دمج عملاء أو إعادة إسناد فواتير أو تغيير تاريخهم.

## السبب والإصلاح

1. كان استيراد taxNumber بالرمز POS-WALKIN ممكنًا؛ يستخدمه محركPOS
لاختيار العميل النقدي داخل الشركة، فكان هناك تعارض هوية.
أضفنا تعريفًا مشتركًا للرمز الداخلي وفحصًا بتطبيعUnicode/NFKC
وإزالة المسافات ومقارنة غير حساسة لحالة الحروف. التحقق يرفضه في
المعاينة؛ ويعيد مسار التنفيذ القائم التحقق داخل معاملة الدفعة قبل الإدخال.
تأكيد التشابه لا يستثنيه. معاينة موقعة قديمة لم تنفذ تُرفض عند التنفيذ؛
إيصال مكتمل قديم يُسترجع قبل إعادة التحقق من مسودة غير صالحة الآن،
بالمعرّف والجسم نفسيهما ووفق صلاحيات القراءة الحالية.

الإنشاء والتعديل اليدويان يرفضان إدخال الرمز وصوره المطَبّعة؛ ولا يمكن
محو رمز عميل نقدي قائم بتعديل رقمه إلىnull. إنشاءPOS الداخلي
واسترجاع العميل النقدي داخل شركته وأقفال إنشائه الأصلية محفوظة.
لم نحول رمزًا خارجيًا إلى هوية داخلية أو نغير المعرفات التاريخية.

2. كان فحص الملكية يرفض Company وCompany Address و«عنوان الشركة»
رغم ربطها بحقول دليل صحيحة. أضفنا استثناءات دقيقة مرتبطة بالحقل:
Company للاسم؛ عناوين الشركة للفوترة أو الشحن عند اختيار ذلك صراحة.
لا قبول للاسم/العنوان في حقل ملكية، ولا للعكس. بقي رفض companyId
وtenantId وlinkedCompanyId والأرصدة والفواتير وباقي الحقول المالية
والأعمدة غير المربوطة. لم تتغير الحقول الستة أو اختيارية الرقم الضريبي.
الواجهة الأصلية تعرف Company تلقائيًا للاسم؛ اختيار العناوين يظل
صريحًا، وأصبح الخادم يقبل الربط الصحيح بدل رفضه.

الملفات التنفيذية الأساسية:
- artifacts/api-server/src/lib/pos-walkin-customer.ts
- artifacts/api-server/src/lib/customer-import.ts
- artifacts/api-server/src/routes/customers.ts
- artifacts/api-server/src/routes/customer-imports.test.ts

أعيد استخدام مسار customer-imports.ts ومحرك المحاولات والتوقيع والقفل
والتدقيق والخدمات الأصلية دون إعادة بنائها. لا تغيير في واجهة العميل
التعاقدية أو واجهات الموردين أو الأرصدة أو الفواتير.

## اختبارات الانحدار الجديدة

قبل الإصلاح، مع بقاء تنفيذ2f6fe3e وإضافة الاختبارات فقط:
26 اختبارًا؛20 ناجحًا و6 فاشلة، خروج1. أثبتت الفشل حالتاCSV/XLSX
للرمز المحجوز، وثلاثة عناوين طبيعية، والإنشاء المباشر المحجوز.
before.log وbefore-tests.json يحفظان النتائج الفعلية، لا قبولًا سابقًا.

بعد الإصلاح، تشغيلPostgreSQL معزول جديد:
29/29 ناجحًا،0 فشل،خروج0. الحالات الجديدة والدائمة تشمل الدفعة
المختلطة والتأكيدين، والمعاينة القديمة بتوقيع وبصمة مراجعة قديمة صحيحة،
والإنشاء/التعديل اليدويين، والتطبيع، والمنشأة ذات العميل النقدي والأخرى
بلا عميل بعد، وعدم الاستعارة بين الشركات، وإيصالًا تاريخيًا ممثلًا
محقونًا كبيانات اختبار يُسترجع دون إعادة تنفيذ، ورفض الملكية/المالية
والربط الخاطئ. اختبار الإيصال ممثل معزول، لا تعديل لإيصال تشغيل.
بقيت اختبارات الأصفار البادئة والخصوصية والصلاحيات والسحب بعد الأقفال
والانتهاء والتزامن والإغلاق والطلب المتأخر والاسترجاع القائمة ناجحة.
لا تُجمع29 الموجهة فوق إجماليAPI النهائي.

## النتيجة النهائية الجديدة

### الرحلة الأصلية والمصالحة المنفصلة

المتصفح اختبر حجبCSV/XLSX والدفعة المختلطة، وحجبcompanyId قبل
المعاينة، والربط الصحيح ومراجعة التشابه وسحب تأكيده. في الاستيراد
الصحيح التزمت الخدمة ثم أسقط الوكيل الرد عمدًا بعد200/completed؛
ظهرت502، ثم أُعيد تحميل الصفحة مرة والاستعلام فقط بالمحاولة الأصلية:
عاد العميل12 مرة واحدة، بهاتف005001234 والعنوانين والضريبةnull.
تثبت العناوين من معاينة المتصفح ثمSQL؛ نموذج تفاصيل العميل الحالي
لا يعرض حقول العناوين، فلم ندّعِ إعادة التحقق منها عبر ذلك النموذج.

استوردت الشركة8 عميلًا عاديًا13 بالاسم نفسه «عميل نقدي - نقطة بيع»،
هاتف005009999 ورقم ضريبي فارغ. بعدها نُفّذ بيعPOS أصلي واحد
بكمية1 ودفع نقدي10 ودون اختيار عميل. الفاتورة2 اختارت العميل
الداخلي14 للشركة8، لا المستورد13 ولا العميل النقدي11 للشركة9.
السلة أفرغت والطلب مؤكد؛ لا دفع/إرسال خارجي أو ضريبة مستحقة.

**حد ورديةPOS:** واجهة التجزئة الأيقونية لحساب المالك لم تعرض نموذج
فتح وردية حين لا جلسة. حُفظ تقرير ذلك كما هو. أُنشئت وردية اختبار2
بنقد افتتاحي0 عبرAPI الأصلية وبمعرف ثابت، ثم أعيدت رحلة البيع
من الواجهة نفسها ونجحت. لا ندّعي فتح الوردية من الواجهة أو إصلاح
شاشتها ضمن هذه الشريحة. لا تغيير نشاط/سياسة ضريبية للتحايل؛ استُخدمت
شركة اصطناعية جديدة غير متبنية، وبقيت شركة العرض المتبنية محجوبة.

المصالحة المستقلة بعد الرحلة نجحت13/13:
عمليتا استيراد فقط، واسترجاع واحد لنفس المفتاح وبصمةToken والمعرف12،
وعملية بيع واحدة وفاتورة واحدة وصرف مخزني واحد بتكلفة3؛ المخزون
للمستودع5 أصبح19 وقيمته57، وطبقاته19/57؛ إجمالي مخزون الشركة
39 وقيمته117 يساوي حساب المخزون117. الإيراد10 والنقد10،
والذمم0 وضريبة المخرجات0 وتكلفة المبيعات3 وحركة حساب المخزون-3.
القيود الجديدة متوازنة تمامًا بفحصSQL للأعداد العشرية كنص.
كل سجلات العملاء والفواتير والإيصالات والقيود والحركات والسياسات القديمة
المحمية بقيت بايتاتها نفسها. أضيفت أربعة إيصالات محاولات لا غير:
استيرادان، وتهيئة الوردية المفصح عنها، وبيع واحد. لا إيصال استرجاع جديد.
حُفظت13 صورة فعلية للرحلة، وصورة إضافية للدخول العام.

host-source.json وbrowser-source.json يثبتان نفس بصمة التنفيذf4e6…
ومصدرالخادم56c3322. ملفات واجهةERP لم تتغير عن2f6fe3e؛ رُبطت
طلبات المتصفح بوكيل الخادم المعزول، مع200 للدخول والصحة ووحدةVite.
هذا تحقق تشغيل/مصدر من مساحة العمل، لا SHA مضمّن مستقل داخلJS
المحمّل في المتصفح. كانت تعديلات التقرير والذاكرة فقط معلقة أثناء
التشغيل الثاني، دون اختلاف في بصمة المصدر التنفيذي.

### البوابات

التشغيل الشامل الأول الجديد:12:22:34–12:41:53UTC، خروج1،
14/15؛1238API ناجحة،1 فشل مهلة،1 تجاوز مشروط؛412UI ناجحة،
والترقية المستقلة ناجحة. انتهت مهلة20000ms في اختبارVAT قائم
لتجميع المرتجعات وحدود الرياض؛ لا اختلاف حساب أو فشل حراسة جديد
أثبتته هذه النتيجة. السجل محفوظ مستقلًا في first-verification.

شُغّل ملفVAT نفسه منفردًا دون تغيير شيفرة أو مهلة:
12:42:40–12:42:57UTC، خروج0،3/3؛ الحالة نفسها أكملت نحو4.8ث.
سبب تباطؤ التشغيل الأول الجذري لم يُثبت، فلا ننسبه قطعًا إلى البيئة
ولا نزعم إصلاحًا ضريبيًا. أُعيدت البوابات كاملة مرة واحدة لهذا الفشل.

**التشغيل الشامل الختامي اكتمل12:43:34–13:02:29UTC**
(15:43:34–16:02:29 الرياض)، خروج0:
15/15 بوابة؛1239API ناجحة/0 فشل/1 تجاوز مشروط لاختبار الترقية
الذي شُغّل مستقلًا؛412UI ناجحة/0 فشل؛ الترقية المستقلة1 ناجح
و38 مستبعدة بمرشحها، لا38 فشلًا. ملفVAT نجح3/3 في التشغيل
الشامل نفسه أيضًا. فحص الأنواع وبناء الخدمات والتدقيق الأمني للاعتماديات
نجحت، وبوابةsource-unchanged أكدت بقاءf4e6… نفسها.
final-verification/summary.json وtests.json والسجلات المنفصلة والتوقيتات
وverify.exit هي أدلة هذه النتيجة، لا ملخص قبول سابق.
لا إخفاق نهائي باقٍ ضمن الإصلاحين المثبتين؛ أُغلقت الشريحة فقط.
لم نرفع مهلة أو نضعف اختبارًا، ولم نبدأ تشغيلًا إضافيًا بعد نجاحها.

## البيانات القديمة وحدود الإثبات

فحص قاعدة العرض الاصطناعية قبل تهيئةPOS لم يجد رمزPOS-WALKIN
قائمًا؛ بيانات التهيئة اللاحقة أنشأت عميلًا نقديًا صحيحًا للشركة الأجنبية9
بالخدمة الأصلية. لم نفحص قواعد العملاء التشغيلية أو نزعم خلوها من
تعارض قديم. إن وُجد سجل قديم محجوز ملتبس المصدر، تُراجع هوية
إنشائه وأدلتها بصلاحية وتدقيق مستقلين؛ لا دمج/حذف أو إعادة كتابة
الفواتير أو تخمين بأنه العميل النظامي. الإصلاح وقائي لمساري الاستيراد
والإدخال اليدوي؛ ليس ترحيل تنظيف بيانات تاريخية.

تشخيصات تجهيز الأدلة منفصلة في setup-boundaries.txt: أخطاء عمود
استعلام/مسار عمل/حل اعتماد داخل المساعد عولجت، وتهيئةPOS أكملت
حفظها لكن غلافها انتهى بمهلة بسبب مؤقتات التطبيق بعد إغلاقPool؛
لم تتكرر التهيئة ولا بقيت عملية مجهولة. ليست هذه إخفاقات قبول تطبيق.
حسابات الدخول وبيئة القاعدة والرموز وكلمات المرور محجوبة من الحزمة.
أجسام جداول المصادقة تُستبدل بأعداد وبصمات؛ الأدلة المالية منقحة.
Word تحققZIP/XML وليس اختبار فتح علىMicrosoft Word مكتبي.

## فصل القبول السابق

قبول استيراد العملاء السابق علىf132d4a/2f6fe3e:
15/15،1230API/1 مشروط مغطى مستقلًا،412UI. هذه نتيجة تاريخية
محفوظة، وليست نتيجة الإصلاح الحالي. لا نزعم خلو النظام كله من الأخطاء.

---

# Hasiba — customer import review corrections

Date:3 November2026. Only the two requested customer-directory corrections.

## Source and changes

Repository Abdullah-Almutairi12/Hasiba, branch sync/hasiba-erp-20261023.
Preserved starting delivery2f6fe3e2ca26ba07bf578a50004f8a5604955795.
Final code/test/browser host source56c3322187a81b2b14f8636a79abd1ec0aa7c858,
fingerprint f4e6e86fa96945fef671a271645f93c1ec5e360e8693d62fdd51cf7227910747.
Later report/asset-registration commits do not modify runtime. The confirmed
push/equality receipt is git-sync.json inside the evidence ZIP and the final
delivery message. Generated evidence is ignored by Git and delivered separately.

The reserved POS-WALKIN internal identity could previously be supplied through
customer import. A shared NFKC/whitespace/case-normalized guard now rejects it
in preview and the existing transactional execution revalidation. Similarity
consent cannot override it. Correctly signed old unexecuted previews are
rejected; previously completed receipts remain recoverable under the same
request body/key and current read authorization. Manual create/update cannot
provide the reserved marker or clear an existing cash identity. Original
internal per-company cash creation and its locking were preserved.

Natural Company→name and Company Address/عنوان الشركة→billingAddress or
shippingAddress now have precise field-aware allowances. Ownership/tenant/
linked-company/finance fields, unknown fields and unmapped columns remain
blocked. Six fields only; optional tax number does not infer registration.
Original UI auto-detects Company as name and accepts explicit address mapping.
No new frontend surface, contract, dependency, migration or parallel engine.

Runtime files:lib/pos-walkin-customer.ts,lib/customer-import.ts,
routes/customers.ts; permanent regressions:routes/customer-imports.test.ts.
Existing customer-imports route, signed previews, durable attempts, authority
and transactional/audit services were reused.

## New evidence, not previous acceptance

Before correction:26 directed tests,20 passed/6 failed,exit1, with original
runtime and only regression instrumentation added. Failures proved reserved
CSV/XLSX import, three mapped natural headers and direct reserved creation.
After correction:new isolated PostgreSQL run29/29 passed,exit0, including
correctly signed pre-fix preview facts, representative historical receipt
replay, manual normalized impersonation/clearing, internal creation and
company isolation, prohibited ownership/finance and existing permissions,
locking/concurrency, revocation, expiry, lost-response recovery and zeroes.
Directed tests are subsets, not added to the final API total.

## Final fresh verification and native reconciliation

Native customer UI proved reserved CSV/XLSX/mixed-batch blocking, unsupported
companyId blocking, correct explicit address mapping and similarity consent/
withdrawal. The valid commit completed server-side200 before the proxy
deliberately dropped its reply. After the resulting502, one reload and native
query-only recovery returned the same customer12 exactly once. SQL confirmed
phone005001234, both mapped addresses and null optional tax number. The detail
editor has no address inputs; post-save addresses were verified independently,
not claimed as a native detail-editor check.

Company8 imported ordinary customer13 with the same cash-customer name,
phone005009999 and no tax number. Original POS then sold product3 quantity1
for10 cash with no customer selection:invoice2 selected true internal
company8 customer14, neither imported13 nor foreign company9 cash customer11.
The UI showed confirmed sale and cleared cart. No real payment was sent.

POS limitation:the owner retail UI did not expose a native shift-opening
form when closed. The initial blocked report is retained. An explicitly
API-only synthetic shift2/opening0 was provisioned through the original
authenticated service with a stable attempt key; the native sale then passed.
Native shift opening/hardware were not accepted or rebuilt here. No tax or
activity configuration was changed to bypass a guard; a fresh non-adopted
synthetic company was used and the adopted company remained gated.

Independent read-only exact-SQL reconciliation13/13 passed:two imports,
one same-key/token-hash recovery, one sale/invoice/stock issue; warehouse5
stock/layers19,value57; company stock39,value117 matches inventory GL117.
New revenue10,cash10,AR0,output VAT0,COGS3,inventory GL movement-3.
All new entries balance; old protected customer/document/receipt/journal/
movement/tax-policy row text remained unchanged. Four new durable receipts
only:two imports, disclosed shift fixture, one sale; recovery added none.
Thirteen actual journey screenshot files plus the public login capture are
included, not screenshot filenames alone.

Host/browser-source evidence records56c3322/f4e6… with identical executable
fingerprints. Frontend files were unchanged from2f6fe3e. Native requests were
logged through the same isolated proxy; HTTP login/health/Vite module200 and
module hash are captured. This is running-workspace/source evidence, not a
separately embedded in-browser compiled-build SHA attestation. Only report/
memory edits were pending during the second full run; runtime fingerprint
was unchanged.

First fresh full run12:22:34–12:41:53UTC:exit1,14/15 gates,1238 API passed,
one20s timeout/one conditional skip,412UI passed, independent upgrade passed.
Existing VAT-return netting/Riyadh-boundary test timed out with no financial
assertion mismatch. Its unmodified isolated diagnostic rerun12:42:40–12:42:57
passed3/3,exit0; that case took~4.8s. Root cause of the slowdown is unproven;
no timeout was raised and no tax/report change is claimed. First-run logs
remain separate. The necessary second full run completed
12:43:34–13:02:29UTC(15:43:34–16:02:29Riyadh),exit0:
15/15 gates;1239API passed/0 failed/1 conditional upgrade skip;
412UI passed/0 failed. Independent upgrade:1 passed/38 filtered out.
The same VAT file also passed3/3 within this final full run.
Types, all service builds, dependency audit and unchanged-source gate passed.
Final summary/tests/logs/timings/exit files belong to this run, not earlier
acceptance. No final failing assertion remains within these two fixes.
The bounded slice is closed; no timeout was increased, test weakened or
additional validation cycle started after success.

## Boundaries

No main change, production publish, ordinary-data write, real external mail/
payment or tax-policy activation. TAX_POLICY_NOT_READY remains. No customer
merge/update migration, invoice reassignment or historical financial rewrite.
The isolated pre-fixture inspection found no existing reserved cash marker;
company9 cash was then legitimately seeded through the original service.
Production historical collisions were not inspected or automatically repaired.
Any ambiguous old record requires independent audited identity review, not
inference, deletion, merging or rewritten invoices.

Harness setup errors/timeouts are separately preserved and explained in
setup-boundaries.txt, not misreported as application acceptance defects.
Credentials/environment/tokens are omitted; authentication table bodies are
reduced to counts/hashes and financial evidence sanitized. DOCX ZIP/XML is
validated, not desktop Word rendering.

Previous acceptance15/15,1230 API/1 independently covered conditional skip,
412UI belongs to the previous source. It is not a new-run result. This slice
does not establish that the entire ERP is complete or free of vulnerabilities.
