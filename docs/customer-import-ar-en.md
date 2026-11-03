# حاسبة — استيراد دليل العملاء من CSV/XLSX

تاريخ التقرير: 3 نوفمبر 2026. الشريحة مستقلة ضمن 05.2 و07.1 و12.4
وضوابط 14.2–14.5؛ لا تغيير لمعرّفات سجل المتطلبات الأصلية الـ73.

## حالة القبول

أُغلقت شريحة إنشاء دليل العملاء CSV/XLSX ضمن نطاقها المثبت فقط.
التشغيل النهائي الجديد11:18:22–11:35:54UTC، الموافق14:18:22–14:35:54
بتوقيت الرياض، انتهى بخروج0:15/15 بوابة؛1230 API ناجحًا/0 فشل/
1 متجاوز مشروط،412 UI ناجحًا/0 فشل. اختبار الترقية المشروط نُفّذ
مستقلًا ونجح1 مع38 حالة أخرى مستبعدة بمرشح الاسم، لا إخفاقات.
لا تجمع20 API أو22 UI الموجهة فوق الإجماليات.

بوابات النسخة النهائية جميعها ناجحة: فحص الأنواع،اختبارات المشغّل
المعزول،أدلة تنظيف الفواتير والقبض والمرتجعات،الترقية المستقلة،
الخادم،الواجهة،بناءAPI وERP والدليل والعرض وبيئة التصميم،تدقيق التبعيات،
وثبات المصدر من بداية التشغيل لنهايته. تدقيق824 تبعية بلا تنبيهات
منخفضة/متوسطة/عالية/حرجة، وليس إثبات انعدام ثغرات النظام كله.
الرحلة الأخيرة والمصالحة على المصدر النهائي منجزتان فعليًا؛ لا عائق
أو إخفاق نهائي مثبت متبقٍ داخل هذه الشريحة.

المستودع Abdullah-Almutairi12/Hasiba، الفرع sync/hasiba-erp-20261023.
مصدر التنفيذ المقبول f132d4a أدناه؛ Commit التوثيق اللاحق لا يغير بصمته.
آخر رفع مؤكد وتطابق المحلي والبعيد ونظافة الشجرة موثقة في git-sync.json
داخل الحزمة وفي رسالة التسليم. الملفات المولدة مستثناة منGit عمدًا؛
وجودها قابل للتنزيل في Word/ZIP لا يعني رفعها إلى المستودع.

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
22 اختبارًا للمسار والمعاينة والتأكيد المسحوب وعدم تكافؤ إعادة تحديده
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
5. التشغيل التالي على d3e651f،10:58:36–11:16:04UTC بخروج0،
   نجح15/15 و1230 API و409 UI، لكنه لا يُنسب
   لإصلاح الواجهة اللاحق. مراجعة التوافق أثبتت أن رفض إنشاء الاستيراد403
   أو تعطل خدمته503 كان يحجب أيضًا قراءة مالية قديمة مصرحًا بها في
   صفحة العميل. فشل اختباران قبل الإصلاح مع19 ناجحًا؛ صُحح شرط العرض
   فقط ليعتمد المستخدم المقيد أو استجابة الدليل، لا رفض صلاحية الإنشاء.
   نجحت22/22 بعده، بما فيها حماية الحساب المقيد قبل اكتمال الطلب وعند
   الرفض. لا صلاحيات خادم جديدة أو إلغاء لحجب المالية عن مستخدم الدليل.
   رحلة فعلية بحساب محاسب اصطناعي: طلب الاستيراد403 وقائمة العملاء200،
   مع بقاء قراءة القائمة وملف360 القديمين وإخفاء زر الاستيراد. أعيدت
   عضويته إلى مالك كما كانت، بسجل اختبار منفصل، دون تغيير عميل أو مبلغ.

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

## إعادة الرحلة على المصدر النهائي f132d4a

بعد إصلاح توافق القراءة أُعيدت الرحلة الأصلية فعلًا، لا إعادة تسمية
للأدلة السابقة. من11:24:36 إلى11:29:33UTC، على الخادم والواجهة المطابقين
لبصمة المصدر النهائي83f3560b، وبأساس SQL مستقل بعد تهيئة الخادم واستعادة
عضوية الاختبار الأصلية.

CSV بالحساب الأول: عرض المطابقات السابقة3/5 و6، ثم سحب التأكيد وإعادة
تحديده وإعادة المعاينة والتأكيد النهائي. ضغطة حفظ واحدة، ثم قطع الرد بعد
200/مكتمل عند11:26:35UTC، ثم إعادة تحميل واستعلام فقط عند11:27:11:
العميلان8 و9 نفسهما، لا إعادة إرسال أو حفظ ثانٍ. XLSX بالحساب الثاني:
مطابقات الشركة7 للسجلين4 و7 فقط، ثم تأكيد وإنشاء العميل10 عند11:29:33.
لا دمج أو تعديل للسابقين أو كشف هويات الشركة6. حُفظت15 صورة جديدة لهذه
الإعادة، و3 صور لاختبار توافق المحاسب؛ المجموع34 صورة مع الجولة الأولى
والدخول، بينها لقطة التشخيص الأول المحفوظة.

## المصالحة النهائية الجديدة

أساس11:23:11 ومقارنة11:32:34UTC، كلاهما على البيئة الاصطناعية نفسها:
228 جدولًا،35 ماليًا/مخزنيًا محميًا، وثلاثة عملاء جدد8/9/10 وإيصالان جديدان
فقط. جميع العملاء السابقين، بما فيهم5/6/7 من الجولة الأولى، وإيصالاتهم
مطابقة تمامًا. النتيجة المسترجعة مطابقة للمفتاح وبصمة الجسم والمعرّفات.
لا تغير في الفواتير أو التحصيل أو القيود أو طبقات التكلفة أو المخزون أو
الموردين أو إعدادات العمل. التغييرات التشغيلية للتدقيق والجلسات وتنظيف
التنبيهات منفصلة ومفسرة، ولا جدول متغير غير مفسر.

إجمالي ما أُنشئ في الجولتين6 سجلات في4 دفعات، وليس6 في دفعتين ولا
تكرارًا للطلب المفقود؛ لكل دفعة معرف جديد وتأكيد تشابه صريح. مصالحة
الجولة الأخيرة تستبعد مفاتيح الدفعات القديمة من الجديد وتثبت بصمة جميع
الإيصالات السابقة بعد هذا الاستبعاد. بصمة جدول العضويات بكامله قبل
اختبار المحاسب وبعد استعادة مالك الاختبار مطابقة، مع restored:true.

## المصالحة المستقلة الأولى المحفوظة

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
المصدر النهائي للبوابات والرحلة المستأنفة بعد إصلاح توافق القراءة:
`f132d4a5efa2b6047d0e028d99f12bdc707d01ea`
وبصمته:
`83f3560bb44b14c11215f4350daf3e038be290f743d57e6786612223cdc47041`.
الشيفرة التشغيلية المختلفة عن الرحلة الأولى هي شرط العرض المذكور في
صفحة العملاء فقط؛ لم يتغير محرك الاستيراد أو المحاولات أو خدمات الخادم.
مقارنة902 مسار في المصدر الوسيط d3e651f قبل إصلاح العرض محفوظة منفصلة
باسم second-runtime-source-equality.json؛ لا تُنسب للنسخة الأخيرة.
أُعيد تشغيل الخادم والواجهة على المصدر الأخير قبل رحلة التوافق
والرحلة النهائية. لا تسمية لقبول قديم على أنه تشغيل جديد.

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

This create-only customer-directory slice is accepted within its evidenced
scope. Final NEW full verification ran11:18:22–11:35:54UTC
(14:18:22–14:35:54 Riyadh), exit0:15/15 gates;1230 API passed,0 failed,
1 conditional skip;412 UI passed,0 failed. The conditional legacy-upgrade
case ran independently and passed1, with38 other cases excluded by its
name filter. Directed20 API/22 UI are subsets, not additive totals.

All gates passed: types, isolated-runner tests, invoice/receipt/return cleanup
evidence, independent upgrade, API/UI tests, API/ERP/docs/deck/sandbox builds,
dependency audit and unchanged-source proof. Audit of824 dependencies reported
zero vulnerabilities; this does not establish that the whole application is
vulnerability-free. Final native journey and independent reconciliation really
completed. No unresolved proven defect/blocker remains within this slice.

Repository Abdullah-Almutairi12/Hasiba, branch sync/hasiba-erp-20261023.
Accepted runtime/test source is f132d4a; later report commits do not change
its fingerprint. Last confirmed push, local/remote equality and clean tree
are recorded in git-sync.json inside the ZIP and the delivery message.
Generated evidence is deliberately ignored by Git and delivered as actual
Word/ZIP files, not falsely claimed as repository content.

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
permissions/privacy. 22 UI cases cover the review protocol, raw invalid rows,
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

A subsequent intermediate full run on d3e651f
(10:58:36–11:16:04UTC, exit0) passed15/15,1230 API and409 UI.
Compatibility review then proved that an import-create403 or import-service503
incorrectly hid an existing legacy financial read view. Two regressions failed
before the display-only fix (19 others passed);22/22 passed after it, including
managed-user protection before options resolve/on denial. Server rights did
not change. A fresh native accountant session proved options403/list200 with
the original authorized list/360 still readable and no import button. The
synthetic membership was restored to its exact original owner role.

The original CORE journey was then actually repeated on the FINAL f132d4a
source,11:24:36–11:29:33UTC, not inherited from the first run. Account A's
single CSV commit completed200 at11:26:35 before response loss; one reload and
query-only recovery at11:27:11 restoredIDs8/9. Account B's XLSX createdID10
normally at11:29:33 after its own local-match review. No cross-company identity
disclosure or old-row merge/update. Fifteen new images and3 accountant images
were saved:34 image files overall, including the original diagnostic/public
login. API host and browser source fingerprint match final verification.

New independent PostgreSQL baseline11:23:11 and after snapshot11:32:34UTC
again checked228 tables/35 protected tables. Exactly3 NEW customers and2 NEW
receipts, zero financial/inventory effects, all prior customers (including the
first run's5/6/7) and receipts identical, no unexplained table change. Receipt
recovery matches key/body hash/IDs. The entire membership table's original and
restored hashes match. Across BOTH separately reviewed runs there are6 new
customer records and4 intentional batches, not duplicate execution of a lost
request. Original and final reconciliation records are separately retained.

Browser/server commit c1331b629699b1ca51047094891dcfa43de17cd3 has full source
hash4e35a1abceeb860530ce31abfd9a43375766e4eacfe2142bd24ffd8f1e8e713e.
Final gate and resumed native source f132d4a5efa2b6047d0e028d99f12bdc707d01ea
has full hash83f3560bb44b14c11215f4350daf3e038be290f743d57e6786612223cdc47041.
The sole runtime path changed since the first journey is the Customers display
condition, not importer/attempt/backend logic. The earlier902-path equality
proof applies ONLY to intermediate d3e651f and is preserved under
second-runtime-source-equality.json. API/Vite restarted on the final source
before the compatibility and final journeys. Old runs are not relabelled.

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
