# حاسبة — سلامة سياق الوردية ومراجعة البيع / POS shift continuity

## النتيجة العربية

أُصلحت الحالات الثلاث المحددة، واكتملت رحلة بيع أصلية ومصالحة PostgreSQL معزولة.
لم تُغيّر خدمات البيع أو الترحيل أو صلاحيات الخادم أو السجلات التاريخية.
هذا قبول للنطاق المحدد، وليس إعلان خلو ERP من الأخطاء أو قبول ضريبي إنتاجي.

### المصدر والتسليم

- المستودع: `Abdullah-Almutairi12/Hasiba`.
- الفرع: `sync/hasiba-erp-20261023`. لم يُعدّل `main` ولم يحدث نشر إنتاجي.
- البداية النظيفة: `e0a68d6c40ad4900465a3e2b8115dc171529a03c`، مع حفظ `e55f3e6` وأسلافه.
- إصلاح التنفيذ ورحلة المتصفح والخادم المعزول:
  `9caad106601585a51ec97d603fc57d0d2fb7bf58`.
- بصمة ذلك المصدر:
  `8455f13f68131e96039264ae7e008436eb7351196b81e04b86183a38932b7cbb`.
- مصدر الفحوص النهائي المرفوع والمؤكد:
  [`2a3b7f0795f5400129723ccaa77590e8b58b6d11`](https://github.com/Abdullah-Almutairi12/Hasiba/commit/2a3b7f0795f5400129723ccaa77590e8b58b6d11).
- بصمته:
  `e85fab1b24ae8dc23f9211e48a9d5f4e992375a517d0792099b24e26b1f456b6`.
- الفرق بين مصدر المتصفح والمصدر النهائي ثلاثة أسطر لبيانات اختبارات فقط:
  إضافة معرّف صاحب الوردية إلى اختبارات الخصم والصلاحيات والبائع.
  لم تتغير شيفرة التنفيذ. يثبت `runtime-equivalence.json` تطابق
  903 ملفات تنفيذ/إعداد من حيث Git blobs، وتطابق ملف POS المخدوم فعليًا.
  لم نعد رحلة المتصفح بعد تعديل هذه البيانات الاختبارية، ولا ندعي تطابق بصمتي
  المصدر الكاملتين؛ فتعريف البصمة يتضمن الاختبارات.
- رُفعت الشيفرة برفع عادي بعد الجلب وفحص كون البعيد سلفًا للمحلي، ثم تأكد SHA
  مباشرة من GitHub. أي Commit لاحق لهذا المصدر يخص التقرير وتسليم الملف فقط؛
  يرد رابط آخر تسليم في رسالة التسليم النهائية.

### ما تغير ولماذا

| الحالة | الإصلاح والدليل |
|---|---|
| التحديث الخلفي يلغي مراجعة المبلغ | تبقى الوردية المؤكدة أثناء `isFetching` مع حجب الأعمال الجديدة حتى انتهاء القراءة. لا يتغير مفتاح المعاينة إذا بقي السياق والسلة والحقائق ثابتة. يبطل الإقفال أو الخطأ السياق. تغيير الكمية أو انتهاء المعاينة يظل يتطلب مراجعة. |
| صنف قبل اختيار الوردية يعطل القائمة | يرفض مسار إضافة الصنف قبل وجود وردية محددة ومؤكدة، برسالة عربية. لا تبدأ سلة يتيمة ولا تتعطل القائمة. بعد الاختيار تعمل الإضافة طبيعيًا. |
| وردية بلا `cashierUserId` تنسب للمستخدم | لا يعد غياب المعرّف دليل ملكية. تظهر رسالة توضح الالتباس وطلب مراجعة المسؤول وإعادة التحقق، ولا تُحفظ الوردية تلقائيًا ولا تُفتح بديلة بسبب الالتباس. لا إعادة كتابة أو نسبة للسجل القديم. |
| حماية السياق القائم | لا ينقل سقوط الوردية أثناء وجود سلة تلك السلة إلى وردية مؤهلة أخرى. الاختيار الصريح والتعافي من الاختيار القديم وبقاء الوردية بعد التاريخ الأحدث محفوظة. |

مسارات توافق الخادم القديمة واسترجاع المحاولات المالية ذات المفتاح والجسم
المحفوظين لم تُبنَ من جديد ولم تتغير. المنع الجديد يمنع الاستدلال التلقائي في
الواجهة، لا يختلق هوية قديمة أو صلاحية أو نتيجة تنفيذ. ظلت حدود الشركة والفرع
والكاشير والجهاز والمسؤولية قائمة.

### الملفات الأساسية

- `artifacts/erp-system/src/lib/pos-session-context.ts`
- `artifacts/erp-system/src/pages/pos-iconic.tsx`
- اختبارا الملفين، وثلاثة ملفات بيانات اختبار:
  `pos-iconic-discount.test.tsx` و`pos-iconic-scoped.test.tsx` و`pos-sellers.test.tsx`.
- تحديث قاعدة المنتج الدائمة بشأن استمرارية السياق وعدم استنتاج هوية الكاشير.
- هذا التقرير. لا ترحيل قاعدة بيانات ولا تعديل OpenAPI أو تبعية.

### نتائج جديدة فعلية — دون جمع الاختبارات الفرعية إلى الإجمالي

جميع الأوقات أدناه UTC بتاريخ **2026-11-04**؛ الرياض = UTC+3.

| التشغيل | البداية → النهاية | النتيجة |
|---|---|---|
| إثبات الانحدار قبل الإصلاح | 02:34:57، مدة 11.68ث | 3 فشل للحالات الجديدة، و24 مستبعدة بمرشح الاسم. |
| الاختبارات الموجهة النهائية | 02:36:53، مدة 17.81ث | 32/32 ناجحًا. |
| الشامل الأول على `9caad10` | 02:37:26 → 02:55:34 | خروج 1؛ 14/15 بوابة؛ API: 1252 نجاحًا وحالة متجاوزة؛ UI: 416 نجاحًا و16 فشلًا. |
| فحص تصحيح بيانات الاختبار | 02:56:10، مدة 20.65ث | 21/21 ناجحًا، دون تغيير أي توقع وظيفي. |
| الشامل على المصدر النهائي `2a3b7f0` | 02:56:41 → 03:14:37 | خروج 1؛ 14/15 بوابة؛ UI: 432/432 ناجحًا، API: 1251 نجاحًا وفشل واحد وحالة متجاوزة. |
| ملف الصلاحيات الخادمي كاملًا، دون تعديل | 03:15:04 → 03:16:01 | خروج 0؛ 35/35 ناجحًا. |
| إعادة بوابة API كاملة على المصدر النهائي نفسه | 03:16:41 → 03:31:05 | خروج 0؛ 1252 نجاحًا، صفر فشل، حالة متجاوزة مشروطة، في 100 ملف. |

الترقية المستقلة نجحت على المصدر النهائي: اختبار واحد ناجح و38 مستبعدة بمرشح
اسم الترقية. الحالة المتجاوزة في API هي الترقية المشروطة التي تُنفذ ببوابتها
المستقلة؛ ليست إخفاقًا مخفيًا.

فحص الأنواع واختبارات أدوات التحقق والبناءات والتدقيق الاعتمادي وثبات المصدر
نجحت في الشامل النهائي. بقيت نتائجها صالحة دون تغيير المصدر؛ أعيدت بوابة
الخادم الفاشلة فقط ثم نجحت. **لم يخرج التشغيل الشامل النهائي نفسه بصفر،
ولا نسميه تشغيلًا واحدًا ناجحًا 15/15.** استُكملت جميع معايير البوابات على
المصدر نفسه بنتيجة إعادة API المنفصلة، مع إبقاء الإخفاق والسجلات الأصلية.

### تفسير الإخفاقات دون إخفائها

1. اختبارات الخصم والبائع والصلاحيات القديمة أغفلت هوية صاحب الوردية في
   بياناتها. المنع المقصود للحالة مجهولة الهوية أوقف تلك الرحلات. أضيفت هوية
   الكاشير الفعلية إلى بيانات هذه الاختبارات فقط، ولم يُحذف اختبار أو يخفف
   توقع. اختبارات رفض الهوية المجهولة تبقى مستقلة ودائمة.
2. أخفق في الشامل النهائي اختبار `team-access.test.ts:321` في رصد انتظار
   `pg_advisory_xact_lock_shared` خلال حلقة رصد تقارب ثانيتين. لم يكن إخفاقًا
   في اختبار الحالات الثلاث الجديدة. نجح الملف كاملًا 35/35 ثم نجحت بوابة
   API كاملة دون تعديل المصدر أو الاختبار أو إطالة مهلته. لم يثبت سبب
   التذبذب على وجه القطع، ولم ندّع إصلاح عيب خادمي أو بيئي غير مثبت.
3. رحلة المتصفح نجحت، لكن أداة المصالحة الأولى افترضت رقم الذمم `1200`،
   بينما الحساب الفعلي هو المفتاح `ar` ورقمه `1130`. صححنا أداة الأدلة
   المستثناة من Git إلى المفتاح المحاسبي، وأعدنا القراءة فقط فنجحت.
   لم يتكرر البيع ولم تتغير بياناته. يحفظ تقرير المتصفح الإخفاق الأول
   وإضافة توضيحية لاحقة، بدل استبداله بصمت.

### رحلة الواجهة الأصلية والمصالحة

قاعدة PostgreSQL محلية اصطناعية منفصلة؛ الشركة 8 والفرع 9 والكاشير 11،
وورديتان 31 و32، والصنف 7. تجهيز الورديات ببيانات اختبار ليس دليل فتحها
من الواجهة؛ **لم نفتح وردية جديدة في هذه الرحلة**.

1. نقر الصنف قبل الاختيار: بقيت السلة فارغة، بلا معاينة، والقائمة متاحة.
2. اختيار الوردية **32 / CONTINUITY-B** صراحة، ثم إضافة وحدة ومراجعة 10.00.
3. إضافة وحدة ثانية أظهرت 20.00 وطلبت مراجعة جديدة وحجبت الدفع. أعيدت الكمية
   إلى واحدة ثم روجع مبلغ 10.00 صراحة.
4. استُخدم تأخير 4.5ث في وكيل الاختبار أمام القراءة الأصلية، لا ردود مصطنعة:
   سجل النقل ثلاثة GET ناجحة مؤخرة. خلال التحديث ظهر «جارٍ التحقق من الوردية»
   مع بقاء CONTINUITY-B و«تمت المراجعة» ومبلغ 10.00. أزيل التأخير؛ لم يلزم
   تأكيد إضافي بعد عودة الوردية نفسها.
5. اختيار النقد ثم ضغط زر الدفع الحقيقي مرة واحدة:
   `ORD-1793760198303-7ef40a74`، وسلة فارغة ونجاح ظاهر.

المصالحة المستقلة عند **02:45:01.510Z**:

- طلب POS واحد وفاتورة واحدة، كلاهما 10.00، مرتبطان بالوردية 32.
- صفر POST لفتح وردية وصفر إيصال محاولة فتح؛ POST بيع واحد وإيصال مالي محفوظ واحد.
- عدد الورديات لم يزد؛ الوردية 31 بقيت دون تغيير.
- مستودع 19: الكمية 20 → 19؛ FIFO بالقيمة 60 → 57 والتكلفة 3.
- حركة مخزون جديدة واحدة وثلاثة قيود جديدة متوازنة: بيع وقبض وتكلفة مبيعات.
- نقدية مدينة 10؛ مبيعات دائنة 10؛ ذمم مدينة 10 ودائنة 10؛ ضريبة 0 لمنشأة
  غير مسجلة؛ تكلفة مبيعات مدينة 3 ومخزون دائن 3.
- يحتفظ SQL بالأموال العشرية كنص عند القراءة للمقارنة، مع لقطات قبل/بعد
  أُخذ خط أساسها بعد مهيئات التطبيق.

### الأدلة والحدود

الحزمة: `generated-artifacts/pos-shift-continuity/Hasiba-Shift-Continuity-Evidence.zip`.
تسلم كملف قابل للتنزيل في المكتبة، لا على أنها ملف متتبع في Git؛ مجلد
`generated-artifacts/` مستثنى. تشمل السجلات المنقحة، توقيتات الخروج، تقارير
JSON الخام، إخفاقات التشغيلين، استكمال API، SQL، صور الرحلة وبصمات الملفات.
لا كلمات مرور أو كوكيز أو اتصالات قاعدة بيانات في الحزمة.

لم نحاك فقد رد مالي جديدًا في رحلة المتصفح هذه؛ نجحت اختبارات الاسترجاع
والمفتاح/الجسم الثابتين وإعادة التحميل ضمن الاختبارات الدائمة المعاد تشغيلها.
اختبار الغموض القديم/الكاشير المجهول والإقفال في هذه الجولة برمجي دائم، لا
رحلة جهاز حقيقي منفصلة. لا اختبار طباعة ورقية أو أجهزة دفع أو إنتاج.
ظل `TAX_POLICY_NOT_READY` دون تجاوز ولم نفعّل زاتكا.

لا إخفاق نهائي متبقٍ في الحالات الثلاث بعد استكمال API. يبقى سجل رصد القفل
المتذبذب معلنًا وحدّ الدليل موضحًا؛ ليس ادعاء ضمان أمن أو قبول ERP شامل.
لا تبدأ مهمة أو نطاقًا جديدًا تلقائيًا.

---

## English handoff

### Scope and implementation

The three requested POS defects are fixed without changing posting services,
server authorization, historical shifts, tax activation or the default branch.

- A background shift refetch retains the previously confirmed active shift and
  valid reviewed quote. New actions wait for verification. A real closure/error,
  quantity/context change or quote expiry still requires the appropriate checks.
- Product addition requires a confirmed selected shift. Clicking before an
  ambiguous shift choice cannot create an orphan cart or disable the picker.
- A null cashier identifier is not ownership evidence. An unidentified historical
  shift is not automatically selected/persisted; the UI explains the ambiguity
  and offers recheck/admin review, without creating a replacement or rewriting
  history. Existing server legacy and immutable recovery services are unchanged.
- A nonempty cart cannot silently follow another eligible shift when its original
  shift closes. Prior stale-choice, multiple-choice and reload protections remain.

### Source and verification provenance

Browser/API journey source: `9caad106601585a51ec97d603fc57d0d2fb7bf58`.
Final tested/pushed code: `2a3b7f0795f5400129723ccaa77590e8b58b6d11`.
Their fingerprints are recorded above. Only three test-fixture lines differ,
adding the actual cashier IDs; all 903 non-test runtime/config Git blobs and
the served POS module match. The browser journey was not repeated after those
test-only edits. Full-source fingerprints differ because they include tests.

New regression evidence: 3 failures before the fix, then 32/32 directed tests
passed. Existing fixture correction: 21/21 passed with unchanged assertions.
Do not add these subsets to suite totals.

Final full verify ran **02:56:41–03:14:37 UTC, 2026-11-04**, exit **1**:
14/15 gates; UI **432 passed**, API **1251 passed / 1 failed / 1 conditional skip**.
The API failure was an unchanged authority-lock observation assertion that did
not see its PostgreSQL waiter within its approximately two-second polling loop.
Its complete file subsequently passed **35/35** unchanged.

Only the failed API gate was rerun, on the same clean final source:
**03:16:41–03:31:05 UTC**, exit **0**, **1252 passed / 0 failed / 1 conditional
skip**, 100 files. All other successful final gates remain valid, including
typecheck, builds, dependency audit and source invariance. Independent legacy
upgrade passed (1 selected test, 38 title-filter exclusions).
**This is completion using a separately recorded API gate rerun, not a single
all-green full verify invocation.** Both full-run failures remain in the bundle;
no test was disabled, weakened or given a longer timeout. The exact cause of
the non-reproducing lock-observation failure was not conclusively established.

### Actual native journey and independent reconciliation

The original `/login` and `/pos` interfaces used isolated synthetic company 8,
branch 9, cashier 11 and selected shift **32**, with no production data.
Click-before-choice left the cart empty and picker enabled. Quantity 1→2
invalidated review; returning to one unit and reviewing restored a 10.00 quote.
Three real delayed successful shift reads preserved that reviewed quote and
selected context. Cash checkout was clicked once, without another confirmation
after the unchanged refresh, producing `ORD-1793760198303-7ef40a74`.

Independent PostgreSQL reads prove one order, one paid invoice, one saved sale
receipt, zero opening receipts, no new shifts, one stock move and three balanced
new journals. Quantity 20→19 and FIFO value 60→57 at cost 3; cash Dr10,
revenue Cr10, AR Dr10/Cr10, VAT0, COGS Dr3/inventory Cr3.

The first evidence helper failed by guessing AR code1200; the actual system key
`ar` maps to1130. Only the ignored helper was corrected, and read-only
reconciliation then passed. The tester retained its original failure and added
a dated clarification; the native sale was not repeated.

### Delivery and limitations

The bilingual report and sanitized ZIP include raw results, timestamps/exits,
before/after SQL, native screenshots, source attestations and SHA256 manifest.
Generated outputs are delivered through the Library and excluded from Git.
The code was pushed normally to the existing work branch and confirmed remotely;
the later documentation/asset handoff SHA is supplied in the final chat response.

No new native lost-response fault was injected; permanent recovery/reload tests
were rerun. No physical payment hardware, paper printing, production data or
production deployment was tested. `TAX_POLICY_NOT_READY` remains in force.
No final failure remains in the three requested behaviors after the API rerun;
the recorded intermittent lock-observation result is explicitly disclosed.
Do not infer whole-product security/compliance acceptance or start another scope.
