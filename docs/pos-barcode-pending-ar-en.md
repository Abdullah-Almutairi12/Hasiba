# مسحات الباركود المعلقة — تقرير التسليم / Pending barcode scans delivery

التاريخ: 5 نوفمبر 2026. النطاق: حسم مسحات القراءة قبل تحصيل جديد، لا إعادة بناء POS.

## العربية

### النسخة وحدود العمل

- المستودع `Abdullah-Almutairi12/Hasiba`، الفرع `sync/hasiba-erp-20261023`.
- المرجع المراجع `14c9b70` محفوظ؛ بدأ العمل من `123e000` الأحدث، الذي يضيف بيانات أصول فقط.
- **المصدر النهائي المختبر والمتصفح والخادم:**
  `6e674a1cf66803be90681f72cb4795267c7e6ea2`.
- بصمة التنفيذ:
  `a99ea6404cdb8d90281e80d8515943a9e6655a7e6e8da4ff3d4c6c4395b2447b`.
- [الشيفرة المختبرة](https://github.com/Abdullah-Almutairi12/Hasiba/commit/6e674a1cf66803be90681f72cb4795267c7e6ea2).
  آخر رفع وتطابق المحلي والبعيد موثقان في `git-sync.json` بالحزمة ورد التسليم.
- لا تغيير لـmain أو ترحيلات أو محرك مالي أو اعتماديات. لا إنتاج أو دفع حقيقي.
  بقي `TAX_POLICY_NOT_READY` دون تجاوز؛ شركة الرحلة اصطناعية غير مسجلة ضريبيًا.

### السبب والإصلاح

1. كان البحث غير متتبع ضمن شروط التحصيل؛ أمكن دفع سلة بكمية1 أثناء انتظار
   مسحة ثانية. اختبار الشاشة الأصلية على شيفرة المرجع أرسل طلب بيع واحدًا
   حين كان المتوقع صفرًا؛ `native-before.log` يحتفظ بالإخفاق.
2. كانت `blocked=true` عند وصول الرد تعني إسقاطه نهائيًا. اختبار التحديث
   المؤقت فشل قبل الإصلاح، مع اختبار الحراسة المتزامنة؛ سجل `before.log`:
   7 نجاحات و2 إخفاقات، وليس قبولًا جديدًا.
3. أصبحت لكل مسحة مقبولة هوية قراءة مستقلة وحالة انتظار/انتظار تحقق آمن/فشل.
   تعرض الواجهة العدد والكود والنتيجة وإعادة المحاولة والإلغاء الصريح.
   إعادة المحاولة تخص المسحة نفسها، ولا تصبح وحدة إضافية.
4. تحجب حراسة متزامنة من مرجع المحاولات بدء طلب بيع جديد، حتى قبل اكتمال
   إعادة رسم الزر. لا تغيّر جسم/مفتاح محاولة دفع محفوظة ولا تمنع استرجاعها.
5. الرد الناجح خلال حجب مؤقت يبقى محفوظًا حتى عودة السياق الآمن. تغيير
   المستخدم أو الشركة أو المسؤولية أو العميل أو الوردية أو السلة يلغي
   الانتقال مع رسالة، ولا ينقل الرد إلى السياق الجديد.
6. مهلة القراءة30 ثانية؛ عند الفشل يبقى طريق إعادة المحاولة أو الإلغاء.
   الإلغاء والتقادم يمنعان إضافة رد متأخر. لا حاجة إلى محرك معاملات مالية
   لقراءة الصنف، ولا توجد تسوية مالية أو حذف لمحاولة دفع بسبب إلغاء قراءة.
7. وصول الوحدة الثانية يعدّل جسم المعاينة القائم، ويلغي مراجعة المبلغ القديم؛
   لا دفع تلقائي ولا فرض لقيم محسوبة من المتصفح.

### عيب إضافي كشفته رحلة هذه المهمة وعولج

على المصدر الوسيط `199ad74` نجحت الحراسة المالية: صفر طلبات أثناء الانتظار،
ثم بيع صحيح، ومصالحة7/7؛ لكن زر لوحة الكمبيوتر بقي مظهره متاحًا.
كان الحجب المرئي مربوطًا بشريط الهاتف فقط. أضيف اختبار DOM ففشل على
ذلك المصدر (`desktop-before.log`)، ثم ربط `LiveCartRail.payBlock` بالحالة
نفسها. بقيت الحراسة المتزامنة مستقلة عن تعطيل الزر.

الملفات التنفيذية والاختبارات المعدلة فقط:

- `artifacts/erp-system/src/hooks/use-pos-barcode.ts`
- `artifacts/erp-system/src/hooks/use-pos-barcode.test.tsx`
- `artifacts/erp-system/src/pages/pos-iconic.tsx`
- `artifacts/erp-system/src/pages/pos-iconic.test.tsx`

### نتائج التشغيل — لا جمع بين المصادر

| التشغيل | النتيجة الفعلية |
|---|---|
| التسليم السابق `0f81c53` / تقرير `14c9b70` | تاريخ محفوظ:14/15، ثم إعادة ملف PDF منفردًا11/11. لم يتحول بأثر رجعي إلى شامل ناجح. |
| المصدر الوسيط `199ad74` | شامل جديد15/15، خادم1285 نجاح/0 إخفاق/1 تجاوز، واجهة508 نجاح؛ بقي نقص الحالة المرئية الذي كشفه المتصفح وعولج لاحقًا. |
| **المصدر النهائي `6e674a1`** | **تشغيل شامل جديد15/15، رمز خروج0، خادم1285 نجاح/0 إخفاق/1 تجاوز، واجهة508 نجاح/0 إخفاق.** |

التشغيل النهائي: **2026-11-05 06:36:49.264 → 06:57:04.768 UTC**
(09:36:49 →09:57:04 الرياض)، بدأ وانتهى بالمصدر والبصمة نفسيهما وشجرة نظيفة.
فحص الأنواع والبناء والتدقيق والترقية المستقلة وحراسة عدم تغير المصدر نجحت.
تجاوز الخادم الواحد هو اختبار الترقية المشروط بتوفير التطبيق السابق؛ نُفذ
في بوابة الترقية المستقلة:1 نجاح و38 حالة مرشحة خارج مرشح هذه البوابة.
لا نجمع هذا النجاح أو63 اختبارًا موجهًا إلى إجمالي1285/508.
لم تتكرر مهلة PDF السابقة، ولم يعدّل اختبارها أو مهلاتها.

اختبارات الانحدار الدائمة تغطي الردود المعكوسة، كل مسحة مستقلة، التحقق
المؤقت، إغلاق الوردية، نطاقات السياق، الفشل والإعادة، المهلة وردها المتأخر،
الإلغاء، حراسة التحصيل المتزامنة، وحجب الزر وإعادة مراجعة الكمية2.
إخفاق إعداد اختبار الشاشة الجديد أثناء انتظار `act` غير المتزامن محفوظ
كفحص تشخيصي، لا إخفاق تطبيق: انتهى الاختبار النهائي بالمهلة الافتراضية
الأصلية5 ثوانٍ، دون تغيير مهلات الاختبارات القائمة.

### رحلة الواجهة وقاعدة PostgreSQL الجديدة

الشركة4، الفرع2، المستودع3، الوردية2؛ كاشير بمسؤولية POS محدودة.
افتتاح نقدي فعلي **0**، لا100، ولم تغيّر الوردية بعد إنشائها.

1. التقطت قاعدة البداية بعد التهيئة وفتح الوردية: صفر بيع/فاتورة/دفعة،
   ورصيد الصنف3 في مستودع المصدر20 بتكلفة3.
2. مسح `00001111` مرة: كمية1، ومعاينة خادمية10 تمت مراجعتها.
3. المسحة الثانية تأخر ردها بعد نجاح بحث الخادم200. ظهر تنبيه المسحات،
   وزر الدفع **disabled=true**. رفضت أداة المتصفح نقر عنصر معطّل؛ لم تُفرض
   النقرة. أثبت عداد طلبات المتصفح ومدخل الوسيط **صفر POST بيع**.
   الاختبار الدائم ينفذ محاولة النقر أيضًا ويتحقق من عدد الطلبات.
4. لم يبق مساعد التحكم الذي أطلقته أداة المتصفح حيًا؛ لذلك تجاوز التأخير
   مهلة30 ثانية وظهرت إعادة المحاولة/الإلغاء بوضوح، دون فقد الوحدة الأولى.
   التقط الوكيل الرئيسي `held.json` وحرر الرد يدويًا في07:02:47.369 UTC،
   مع صفر بيع قبل التحرير وبعده. لا ندعي تحريرًا آليًا بعد25 ثانية في الرحلة النهائية.
5. الرد القديم لم يزد الكمية. أعيدت **المسحة نفسها** مرة عبر زر الإعادة،
   دون مسحة لوحة مفاتيح جديدة: أصبحت الكمية2، وطلبت معاينة20 مراجعة جديدة.
6. تمت مراجعتها ثم دفع نقدي تجريبي واحد؛ الشاشة أكدت20 وسلة فارغة.
   لقطة النهاية مستقلة في07:03:44.502 UTC.

مراجع النهاية:

- البيع `ORD-1793862218250-732bc54f`، معرف1، الوردية2.
- الفاتورة `PINV-2026-00001`، إجمالي20، ضريبة0، مدفوع20.
- **بيع واحد، فاتورة واحدة، دفعة نقدية واحدة، حركة صرف واحدة لكمية2.**
- مخزون مستودع المصدر **18**؛ المستودع الآخر وضابط الشركة الأخرى دون تغيير.
- الأستاذ: نقد+20، ذمم صافي0، إيراد20، تكلفة مبيعات6، مخزون−6؛ قيود متوازنة.
- طبقات FIFO والكميات والقيمة متطابقة؛ المصالحة المستقلة **7/7**.
- مقارنة لقطة الانتظار بالبداية لم تظهر أي فاتورة أو دفعة أو حركة أو قيد
  أو إيصال مالي أنشأته المسحات وحدها.

### حدود الدليل والأدلة

- المحاكاة هي إدخال لوحة مفاتيح Enter ووسيط HTTP معزول يؤخر **رد البحث الحقيقي**؛
  ليست شهادة ماسح أو طابعة فعلية. التحقق المؤقت والعكس والإلغاء وتبديل
  السياق مثبتة باختبارات حتمية؛ لا أنسبها كلها إلى رحلة المتصفح الواحدة.
- سجل الوسيط يحتوي GET إضافيًا قبل التحرير لم يُلاحظ باعثه مباشرة.
  نحفظ التوقيت ولا نفترض أنه مسحة مقصودة أو ننسبه لسبب شبكي غير مثبت.
  بقيت الكمية1 قبل الإعادة الصريحة، وثبتت كمية2 وبيع واحد في النهاية.
- فشل الدخول الأول كان في وسيط الاختبار: منفذ داخلي ثابت كان يشير إلى
  بوابة المعاينة، لا التطبيق المقصود. صُحح بربط منفذ loopback حر والتحقق
  من الخطأ ومن استجابة التطبيق؛ لم يعدّل دخول المنتج أو صلاحياته.
- لا إخفاق وظيفي باقٍ مثبت ضمن هذا التصحيح. لا ادعاء بخلو ERP كله من الأخطاء.
- الحزمة المنقحة `hasiba-pos-barcode-pending-evidence.zip` تسلم كملف مستقل،
  وليست ملفًا مرفوعًا إلى Git لأنها داخل مجلد المخرجات المستثنى.
  تحتوي السجلات الخام المنقحة، نتائج كل مصدر منفصلة، صور المتصفح،
  SQL snapshots وملخص المصالحة والتوقيتات والبصمات وبيان المزامنة.
  استثنيت بيانات الوصول وملفات البيئة وسجلات الاستضافة الخاصة.

## English

**Scope:** resolve every accepted barcode read before starting a new POS checkout.
Existing barcode matching, immutable payment recovery, resumed carts, shifts and
financial services were reused; there are no new financial transactions for lookup.

**Final tested source:** `6e674a1cf66803be90681f72cb4795267c7e6ea2`;
execution SHA-256 `a99ea6404cdb8d90281e80d8515943a9e6655a7e6e8da4ff3d4c6c4395b2447b`.
The final full run started06:36:49.264 and ended06:57:04.768 UTC on2026-11-05,
exit0: **15/15 gates,1285 API passed/0 failed/1 conditional upgrade skip,
508 UI passed**. The independent legacy-upgrade gate passed its selected case.
The earlier14/15 plus standalone PDF retry remains historical, not relabeled.

Before-fix regressions prove a sale request was sent while the second read was
pending and a successful response was silently lost during temporary blocking.
Reads now have independent identities and explicit pending/waiting/failed states.
A synchronous ref-based fence prevents new checkout even before a UI rerender;
temporary blocking retains successful reads. Retry resolves the same unit.
Explicit cancellation, context changes and timeout invalidate late additions.
Unknown financial attempts retain their original key/body and recovery path.

The intermediate199ad74 browser journey proved zero sale ingress during the hold,
then a correct sale and7/7 reconciliation, but found an enabled desktop control.
A failing DOM regression demonstrated that gap; final6e674a1 wires the desktop
block without removing the independent handler fence. All gates were rerun after
that code change rather than attributing the earlier pass to final code.

The final native journey used a fresh disposable PostgreSQL fixture, company4,
branch2, warehouse3, shift2, openingcash0. First scan/review: one unit/10.
Second real lookup was held after upstream200: disabled payment, visible warning,
zero outgoing and ingress sale requests. A browser-tool background helper did not
remain alive, exercising the unchanged30-second timeout. Main captured read-only
state and explicitly released the response; the late result added nothing.
One explicit retry of that same scan produced unit2 and a new20 quote requiring
review, followed by **one cash sale20, one invoice, one tender and one two-unit issue**.
Final stock18; cash+20, netAR0, revenue20, COGS6, inventory−6; all entries balanced.
Independent exact SQL/ledger/FIFO reconciliation passed **7/7**.

Order `ORD-1793862218250-732bc54f`, invoice `PINV-2026-00001`.
The trace retains an extra unheld GET with unobserved trigger; no cause is invented,
and no extra unit or financial posting is inferred. Screenshots and raw evidence
preserve both infrastructure blockers and their resolution. No physical scanner
was tested. Temporary refresh, reversed responses, cancellation and context changes
are deterministic-test evidence, not all separate browser journeys.

Code, browser host and full tests share the final executable fingerprint.
Subsequent delivery changes are documentation only. The ZIP includes sanitized
raw results, source-bound receipts, snapshots, screenshots and remote-sync proof;
it excludes credentials and private host logs. No main change, production publish,
real payment, external send or `TAX_POLICY_NOT_READY` bypass occurred.
