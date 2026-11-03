# حاسبة — استيراد دليل العملاء من CSV/XLSX

تاريخ التقرير: 3 نوفمبر 2026. الشريحة مستقلة ضمن 05.2 و07.1 و12.4
وضوابط 14.2–14.5؛ لا تغيير لمعرّفات سجل المتطلبات الأصلية الـ73.

## حالة القبول

بانتظار نتيجة التشغيل النهائي؛ لا يعد نجاح الرحلة وحده قبولًا للبوابات.
سيُحدّث هذا القسم بالنتيجة الفعلية قبل التسليم.

## ما نُفّذ

- زر «استيراد العملاء» داخل صفحة العملاء الأصلية؛ ملف CSV أو XLSX ثم
  ربط الأعمدة ومعاينة ومراجعة وتأكيد وحفظ دفعة ذرية. إنشاء فقط: لا تحديث
  ولا حذف ولا دمج لسجل سابق. لا JSON أو أرصدة أو فواتير في هذه الشريحة.
- الحقول الستة فقط: الاسم مطلوب، والهاتف والبريد والرقم الضريبي وعنوانا
  الفوترة والشحن اختيارية. الفرد لا يحتاج رقمًا ضريبيًا أو هوية شخصية.
  الرقم المفقود لا يحدد حالة التسجيل الضريبي، ولا توجد خدمة تحقق خارجي.
- استعمال قارئ المنتجات الآمن وحدوده القائمة دون توسيعها أو إضافة حزمة.
  الحقول النصية تحتفظ بالأصفار البادئة. رقم Excel العددي في حقل معرّف
  يُرفض مع تفسير؛ لا اختلاق للأصفار المفقودة أو تخمين للهوية.
- عنوان «اسم الشركة» أو Company Name المربوط بحقل الاسم طبيعي ومسموح؛
  ملكية السجل تُشتق من الجلسة لا الملف. حقول الملكية والائتمان والأسعار
  والدفع والأرصدة والروابط بين الشركات غير مقبولة.
- جميع صفوف المعاينة الأصلية معروضة بأرقام صفوف الملف، بدءًا من2 بعد
  العنوان، وقيمها وأخطائها، بما فيها ملف لا يوجد فيه أي صف صالح. وجود
  خطأ واحد يمنع حفظ الدفعة كلها، ولا تقتصر المعاينة على مرشحي الحفظ.
- التطابق غير الفارغ للاسم/الهاتف/البريد/الرقم الضريبي، بعد حذف الفراغات
  الطرفية وتوحيد حالة الأحرف، يولد تحذيرًا داخل الملف والشركة الحالية.
  هذا ليس كشفًا ضبابيًا أو إثبات هوية ولا قيد تفرد أو دمجًا أو منعًا آليًا.
  لا فحص لكشف عملاء شركة أخرى. يُسمح بإنشاء سجل مستقل بعد المراجعة.
- تأكيد التشابه منفصل عن التأكيد النهائي. سحبه يمنع الإرسال فورًا؛
  إعادة تحديده وحدها لا تكفي، بل تلزم معاينة جديدة ثم تأكيد نهائي جديد.
  الخادم يوقّع حقائق المطابقات المراجعة ويعيد حسابها بعد انتظار القفل؛
  تغير المطابقات يستلزم مراجعة جديدة، لا استعمال موافقة قديمة.
- أُعيد استعمال المحاولات المالية الدائمة القائمة دون محرك موازٍ:
  يُحفظ المعرف والجسم قبل الإرسال، ويبقي الرد المجهول الطلب ثابتًا،
  والاسترجاع يعيد النتيجة الأصلية، والإغلاق الموثوق يمنع الطلب المتأخر.
  حذف الحالة المحلية مشروط بتطابق المحاولة لحماية محاولة أحدث في تبويب آخر.
- العملاء الجدد بلا طلبات أو إنفاق أو حد ائتمان أو شروط دفع أو قائمة سعر
  أو ارتباط شركة. السجلات السابقة والعميل النقدي لا يُعدَّلون.

## الصلاحيات والخصوصية

أُضيفت إلى كتالوج المسؤوليات والقوالب القائم صلاحيتا قراءة دليل العملاء
وإنشاء سجلاته. يمكن منحهما دون قراءة الفواتير أو صلاحيات الموردين.
الإنشاء يحتاج القراءة أيضًا. قيد القراءة الأعلى والتعليق وانتهاء المنح
وسحبها تؤثر مباشرة. يجري فحص العضوية والصلاحيات والخصوصية الحية داخل
معاملة الحفظ بعد انتظار قفل جدول العملاء، مع حاجز السلطة القائم.

دليل العملاء الحالي تابع للشركة القانونية ولا يحمل فرعًا؛ لم نخترع ملكية
فرع أو نجمع شركات. مستخدم المسؤوليات يحصل من قائمة العملاء على حقول
الدليل فقط، دون أرصدة أو فواتير أو حدود ائتمان أو روابط شركات. واجهته
تخفي الإجراءات المالية والتحرير وملف360 غير الممنوحة. الحسابات القديمة
تحافظ على أدوارها السابقة؛ لا توسيع تلقائي للصلاحيات. تقييد خصوصية
المالك يُطبق أيضًا قبل كشف المطابقات أو إعادة النتيجة.

## الاختبارات الدائمة الجديدة

ملف الخادم `artifacts/api-server/src/routes/customer-imports.test.ts`:
20 اختبارًا على PostgreSQL معزولة. يشمل CSV/XLSX وأصفار المعرّفات
والعناوين الطبيعية والملكية/الحقول المالية والصيغ والحدود والصفوف الخاطئة،
والتشابه دون دمج، وعزل شركتين وتبديل الشركة لعضو مشترك، وتغير حقائق
المراجعة، وتقييد التوقيع بالشركة والمستخدم والغرض والجسم، والانتهاء،
والإغلاق وإعادة المحاولة والتزامن، وسحب القراءة/الإنشاء والخصوصية،
ومنح الدليل المستقلة والقوالب والمنع الأعلى والتعليق وانتهاء المنحة.
اختبارات الأقفال تستعمل حواجز PostgreSQL فعلية لا مؤقتات شبكة وحدها.

ملف الواجهة `artifacts/erp-system/src/components/customer-import-dialog.test.tsx`:
19 اختبارًا للمسار والمعاينة والتأكيد المسحوب وعدم تكافؤ إعادة تحديده
بالمراجعة، والصفوف الخاطئة والحالة المجهولة والاسترجاع والإغلاق وحماية
المحاولة الأحدث ونطاق المستخدم والشركة والمسؤولية وواجهة الدليل المقيدة.
الأعداد الموجهة أجزاء من الإجماليات وليست أعدادًا تضاف إليها.

## سجل الإخفاقات وتصحيحها

1. التشغيل الشامل الأول على c1331b6، من10:37:22 إلى10:55:25UTC،
   انتهى بخروج1:14/15 بوابة؛1229 API ناجحًا و1 فاشل و1 مشروط متجاوز؛
   409 UI ناجحًا. الاختبار الجديد لانتهاء المنحة جعل ends_at أقدم من
   starts_at، فرفض قيد قاعدة البيانات بيانات الاختبار قبل فحص الصلاحية.
   هذا عيب تجهيز اختبار، لا دليل على خلل صلاحية في التطبيق. حُفظت
   السجلات دون تغيير تحت first-verification وfirst-verify.*.
2. صُحح الاختبار فقط إلى فترة قديمة صحيحة: البداية قبل يومين والنهاية
   قبل يوم؛ بقيت كل تأكيدات الرفض والسماح والتعليق والمنع الأعلى كما هي.
   لا تغيير في قيود قاعدة البيانات أو منطق التطبيق ولا تجاوز للبوابة.
3. محاولة تشغيل موجهة توقفت بحد أداة shell البالغ60 ثانية أثناء بدء
   Vitest، دون نتيجة؛ لم يبق لها تابع يعمل. سجل الانقطاع منفصل، وليس
   نجاحًا أو فشل اختبار. أُعيد التشغيل بمهلة كافية:
   10:57:17–10:58:13UTC، خروج0،20/20 ناجحة.
4. في رحلة المتصفح صُنّف تعطيل زر إعادة المعاينة بعد نجاحها خطأً أولًا.
   أثبت سجل النقل200 وcanCommit:true، ثم استكمال الرحلة أن المطلوب
   تحديد التأكيد النهائي المنفصل. حُفظ التشخيص الأول وتصحيحه؛ لم يُغيَّر
   التطبيق لإلغاء هذا الضابط.

## الرحلة الأصلية الفعلية

واجهة وخادم على قاعدة اصطناعية منفصلة، لا بيانات عملاء أو قنوات خارجية.
أحداث النقل:10:39:57–10:47:08UTC، بعد تشغيل الخادم واستقرار التهيئة.

الحساب الاصطناعي الأول/الشركة6:
- mixed.csv: الصفوف2/3/4 ظاهرة، اثنان بخطأ بريد وواحد صالح؛ لا حفظ.
- all-invalid.xlsx: صفان خاطئان مع القيم والأسباب؛ لا حفظ.
- valid.csv: ستة أعمدة وعميلان؛ تطابق أحدهما مع سجل سابق، مع عرض
  الأصفار البادئة والعنوانين. روجع سحب الموافقة وإعادتها والمعاينة الجديدة.
- قبل ضغطة حفظ واحدة فُعّل عطل نقل لمرة واحدة؛ لم تُقطع الاستجابة إلا
  بعد أن أعاد الخادم200/مكتمل فعليًا. عرضت الواجهة نتيجة مجهولة وحجبت
  تعديل الملف والجسم. بعد إعادة التحميل استُعمل «استعلام النتيجة فقط»،
  لا إعادة إرسال، واستُعيد المعرّف والجسم والنتيجة نفسهما: العميلان5 و6.
  القائمة الأصلية تحدّثت دون دفعة ثانية.

الحساب الثاني/الشركة7:
- company-b.xlsx، مع رقم ضريبي مشترك مع سجل بالشركة7 ومع عميل بالشركة6.
  التحذير أظهر سجل الشركة7 وحده، لا هوية الشركة6. بعد التأكيد والمعاينة
  أنشئ العميل7 مستقلًا، وتحدّثت القائمة الأصلية. لا رفض عالمي للرقم.

حُفظت15 صورة فعلية للرحلة وصورة عامة للدخول. نُقلت الصور من مرفقات
أداة المتصفح إلى الحزمة نفسها؛ ملاحظتها الأولية بعدم وجود تصدير محلي
لا تعني غياب الصور من التسليم النهائي.

## المصالحة المستقلة

قراءة PostgreSQL مستقلة في snapshot، بعد تهيئة الخادم لا قبلها.
الأساس10:38:55UTC، والمقارنة النهائية10:50:26UTC.
- 228 جدولًا فُحصت بالعدد وبصمة نص الصفوف، مع نص SQL للأرقام الدقيقة.
- ثلاثة عملاء جدد فقط في شركتين، وثلاثتهم بإنفاق/طلبات/ائتمان0،
  وشروط دفع0 وروابط/قوائم أسعارNULL. كل صف عميل سابق مطابق تمامًا.
- إيصالا محاولة فقط، واسترجاع الرد المفقود يطابق المفتاح وبصمة الجسم
  ومعرّفات النتيجة؛ إيصالات المحاولات السابقة مطابقة بعد استبعاد الجديدين.
- 35 جدولًا ماليًا/مخزنيًا محميًا لم يتغير؛ ولا تغير غير مفسر في بقية
  الجداول. لا فاتورة أو تحصيل أو قيد أو طبقة مخزون أو قائمة أسعار
  أو مورد سابق تغير.
- تغييرات المستخدمين/الجلسات هي تسجيل الدخول، والتدقيق/المحاولات
  من التنفيذ، وبيانات تشغيل تنظيف التنبيهات مؤرخة ومنفصلة.
  إعدادات العمل مطابقة بعد استثناء lastAlertSweep وتوقيتها التشغيلي فقط.
  لا حذف شامل للاستثناءات ولا اعتماد على قائمة مالية قصيرة وحدها.

## المصدر والملفات

مصدر الرحلة والخادم:
`c1331b629699b1ca51047094891dcfa43de17cd3`
وبصمته الكاملة:
`4e35a1abceeb860530ce31abfd9a43375766e4eacfe2142bd24ffd8f1e8e713e`.
المصدر النهائي للبوابات:
`d3e651f1e6ca541a6c19b5f32f9f31e5ad19e720`
وبصمته:
`c26c93220ec178cd817eb342f1a576be4e5e3044dc40d390ade169f0cd7a24d4`.
الاختلاف الوحيد في المصدر التنفيذي المحتسب هو سطر بيانات اختبار المنحة؛
ومعه ملفا ذاكرة توثيقيان خارج البصمة. لم نسم رحلة المتصفح تشغيلًا جديدًا.
مقارنة مستقلة لـ902 مسار runtime/config تثبت عدم تغير أي منها:
`67f4957413076bdc19df907e9c57a406230ce0ef80d2230c1aeedfa811b901c0`
في المصدرين؛ التفاصيل في runtime-source-equality.json.

الملفات الأساسية:
- الخادم: lib/customer-directory-access.ts وlib/customer-import.ts،
  routes/customer-imports.ts واختباراته، routes/customers.ts وindex.ts.
- توسيع المسؤوليات القائمة: team-catalog.ts،responsibility-context.ts،
  team-store.ts،permission-templates.ts،managed-access.ts،require-role.ts.
- الواجهة: customer-import-dialog.tsx واختباراته،customer-import-api.ts،
  pages/customers.tsx.
- العقد: lib/api-spec/openapi.yaml ومخرجات api-client-react وapi-zod.
- السجل: هذا التقرير وcommercial-execution-status-ar.md
  وenterprise-requirements-ar.md. لا ترحيل أو تبعية جديدة.

## الحدود ونقطة الاستئناف

الشريحة لإنشاء دليل العملاء فقط، لا تسليمًا لكل الاستيراد أو ERP.
لا استيراد رصيد/فاتورة/تحصيل/ائتمان أو JSON، ولا دمج/تحديث/حذف.
لم نختبر ملفات مستخدم حقيقية أو إرسالًا أو خدمة ضريبية إنتاجية أو أجهزة
فعلية أو كل المتصفحات والهواتف. لا ادعاء أن النظام خالٍ من الأخطاء.
حزمة Word جرى التحقق من XML وسلامة ملفها، لا تشغيل Word مكتبيًا.
يبقى TAX_POLICY_NOT_READY، ولا تغيير main أو نشر أو بيانات تشغيلية
أو تعديل العرضPDF. قبول المنتجات والموردين السابق محفوظ ولا يعاد بناؤه.
بعد تسليم هذه الشريحة لا نطاق تالٍ تلقائي؛ نقطة الاستئناف مراجعة التسليم
وأي ملاحظة محددة على دليل العملاء، لا تنفيذ أرصدة أو فواتير تلقائيًا.

---

# Hasiba — create-only customer directory CSV/XLSX import

## Acceptance

Final fresh verification is still running while this draft is prepared.
The final result will replace this section before delivery.

## Implemented scope

The existing Customers page now supports CSV/XLSX parsing, explicit column
mapping, server preview, match review, final confirmation and atomic creation.
Only name (required), phone, email, tax number, billing address and shipping
address are accepted. Individuals need no tax/personal ID. Missing tax data
does not establish tax registration. Existing records and the cash customer
are not updated, merged, deleted or replaced.

The established safe reader, limits, signing, financial-attempt protocol,
responsibilities, templates, audit and authority fence are reused. No new
dependency, migration, permission engine or accounting engine was introduced.
Text identifiers preserve leading zeroes; numeric spreadsheet identifiers are
rejected rather than guessed. Natural company-name headers map to the name,
never ownership. Financial, ownership, credit/payment/price-list/intercompany
fields are not imported.

Every original preview row, including invalid rows, retains file row numbers,
raw values and reasons. Any validation error blocks the whole batch. Exact
trimmed/case-normalized nonempty name/phone/email/tax matches are company-local
review warnings, not uniqueness rules or identity evidence. Match consent is
revocable; rechecking alone does not restore approval: a fresh preview and
separate final confirmation are required. Match facts are signed and rechecked
inside the transaction after the lock.

Directory read/create are explicit capabilities in the existing sales
responsibility catalog; they do not require or imply invoice/supplier/finance
access. Upper denials, suspension, expiry, privacy and live authority after
locks apply. Directory records are company-wide because they have no branch.
Managed list responses and UI exclude financial details and ungranted360/edit
actions; legacy roles are not broadened.

Durable attempts preserve key/body before sending, keep unknown requests
immutable, recover the same completion and safely close unexecuted attempts.
Late execution after closure and deletion of a newer tab's attempt are blocked.

## Permanent tests and actual browser proof

20 isolated PostgreSQL API cases cover formats, mapping, limits, invalid rows,
independent identities, cross-company membership switching, changed review
facts, token binding/expiry, real PostgreSQL races, recovery/closure and live
permissions/privacy. 19 UI cases cover the review protocol, raw invalid rows,
pending attempts, recovery/closure, newer-attempt protection and restricted
directory mode. Subsets are included in full totals, never added to them.

The native authenticated journey ran on synthetic companies6 and7, from
10:39:57 through10:47:08UTC. Mixed CSV and all-invalid XLSX could not save.
Six-field valid CSV displayed leading zeroes and addresses. Withdrawing and
rechecking match consent required new preview and general confirmation.
A local one-shot transport fault dropped the response only AFTER the original
server returned200/completed. One page reload and query-only recovery restored
IDs5/6 without resending. Company7's XLSX then createdID7 after local match
review; no company6 identity was disclosed. The original list refreshed after
both recovered and normal success. Fifteen native screenshots plus a public
login screenshot are included as actual image files.

Independent read-only PostgreSQL reconciliation checked228 tables and35
protected financial/inventory tables. Exactly3 customers and2 attempt receipts
were added; all prior customer rows and prior receipts remained identical.
New rows have zero orders/spend/credit/terms and null price/intercompany links.
No invoices, payments, journals, inventory/cost layers, suppliers or business
settings changed. Auth/session, audit/attempt and alert-cleanup operational
metadata changes are separately explained. Recovery matched the original key,
body hash and IDs.

## Failures, correction and provenance

The first new full run on c1331b6 (10:37:22–10:55:25UTC, exit1) passed14/15
gates,1229 API with1 failed/1 conditional skip, and409 UI. One NEW expiry-test
fixture violated the database's starts_at<=ends_at constraint before testing
authority. Only that fixture was corrected to an actually expired valid
interval; all assertions and database protections remain intact. The subsequent
directed run (10:57:17–10:58:13UTC, exit0) passed20/20. An intervening60-second
shell timeout at test startup is separately retained, not counted as a result.

The first browser diagnostic incorrectly called the already-completed
repreview gate a deadlock. Transport evidence and completion showed the
separate final checkbox was still required. Both diagnostic and correction are
retained; no application change weakened the review requirement.

Browser/server commit c1331b629699b1ca51047094891dcfa43de17cd3 has full source
hash4e35a1abceeb860530ce31abfd9a43375766e4eacfe2142bd24ffd8f1e8e713e.
Final gate source d3e651f1e6ca541a6c19b5f32f9f31e5ad19e720 has full hash
c26c93220ec178cd817eb342f1a576be4e5e3044dc40d390ade169f0cd7a24d4.
The only code-path difference is one test-fixture line; two memory files are
documentation. All902 runtime/config paths are identical, with independent
tree hash67f4957413076bdc19df907e9c57a406230ce0ef80d2230c1aeedfa811b901c0
on both. The browser journey is not falsely relabelled as a new run.

Main files: customer-directory-access.ts, customer-import.ts,
routes/customer-imports.ts/test, customers.ts, responsibility catalog/context/
template/store guards, native customer-import dialog/tests/client/Customers
page, OpenAPI and generated React/Zod contracts. Exact paths are in the ZIP.

No legacy acceptance is relabelled as new. Earlier product/supplier work stays
preserved. No production/main/external delivery or TAX_POLICY_NOT_READY bypass.
Balances, invoices, payments, JSON, merging and all-ERP completion are outside
this slice, not silently claimed. No real customer files, live channels,
physical devices, exhaustive mobile/browser matrix or desktop Word rendering
were tested. Delivery completes this slice only; no next scope starts
automatically.
