# إدخال باركود الأصناف العادية في POS — تقرير عربي / English report

## النتيجة وحدود القبول — 5 نوفمبر 2026

اكتملت الشريحة برمجيًا وثبتت رحلة بيع أصلية ومصالحة مستقلة. الشيفرة
المختبرة والمرفوعة: [`0f81c5362986d7ec14e45bf2eb5ae992cdff62fe`](https://github.com/Abdullah-Almutairi12/Hasiba/commit/0f81c5362986d7ec14e45bf2eb5ae992cdff62fe).
الفرع `sync/hasiba-erp-20261023`، ونقطة البداية المحفوظة `a4aef560246a52d88c5f186d2b2fdb406dfe7031`.
بصمة التنفيذ `e32ffd47b45a00a0c3bd1ae934a75d04e9ee7a61fed8ed8a3d0a76df47b8eaaf`.
الشيفرة والخادم المعزول وواجهة رحلة القبول من المصدر نفسه؛ أي تسليم لاحق
لهذا التقرير توثيقي فقط، ولا ينسب إليه تشغيل اختبارات جديد.

**تمييز مهم:** التشغيل الشامل انتهى **14/15** لا 15/15، بسبب مهلة اختبار PDF
واحد خارج مسار الباركود. أعيد ملفه كاملًا بعد ذلك على المصدر نفسه ونجح
**11/11** دون تغيير الشيفرة أو زيادة المهلة أو إضعاف التحقق. لا نجمع هذه
الإعادة إلى إجمالي الخادم، ولا ندعي وجود تشغيل شامل جديد ناجح 15/15.
لا يوجد إخفاق وظيفي باقٍ مثبت ضمن شريحة الباركود؛ يبقى حد الدليل الشامل
المذكور أعلاه معلنًا.

## ما تغير وما أعيد استخدامه

- Enter في حقل البحث الأصلي يرسل قراءة مطابقة تامة للباركود/SKU كنص؛
  يحتفظ بالأصفار البادئة. البحث بالاسم يبقى قائمًا دون تحويله إلى حسابات جديدة.
- مسار POS مستقل للقراءة الآمنة `GET /api/pos/barcode-lookup` يستخدم
  هوية الصنف المشتركة مع البحث المخزني وحراسة مصدر POS القائمة.
  يتحقق من الشركة والفرع والكاشير والوردية والجهاز والمسؤولية الحالية؛
  لا يمنح إدارة مخزون أو صلاحيات مالية أو عرض التكلفة النقدية.
- الصنف المجهول 404، والالتباس 409، وغير النشط أو المتتبع أو المتغير
  422؛ لا اختيار لأول تطابق ولا إحلال للصنف الأب.
- كل إدخال مقصود يزيد وحدة واحدة، مع تحديث السلة من مرجعها الحالي
  لا من نسخة قديمة. الرد المعكوس لا يفقد زيادة. الرد المتأخر لا يضاف
  إلى سياق عميل/شركة/وردية/سلة تغير أو أثناء محاولة مالية/حفظ غير محسومة.
- الحقل يفرغ ويحتفظ بالتركيز عند الإرسال المقصود دون محو إدخال لاحق
  عند عودة الرد. الخطأ لا يضيف صنفًا أو يظهر نجاحًا ماليًا.
- صححت رسالة ثابتة قديمة كانت تصف قراءة الباركود بأنها غير متاحة
  للمسؤولية المحدودة؛ لم تتغير المنح لتحقيق ذلك.
- لا ترحيلات ولا اعتماديات جديدة، ولا تعديل لمحركات السعر والضريبة
  أو الدفع أو المسودات المسترجعة أو منع تكرار البيع.

الملفات الأساسية: `pos-iconic.tsx` واختباره، `use-pos-barcode.ts` واختباره،
`pos-barcode.ts`، `pos.barcode.test.ts`، مسارا `pos.ts` و`inventory.ts`،
`managed-access.ts`، وعقد OpenAPI ومخرجاته المولدة.
الارتباط بالنطاق الأصلي: 08.1 و08.3 و14.2 و14.3؛ ليس قبولًا لجميع POS أو ERP.

## الفحوص الجديدة — ليست أرقام التسليم السابق

| الدليل | النتيجة الفعلية |
|---|---|
| انحدار Enter على مكوّن `a4aef56` الأصلي المؤرشف | فشل متوقع: صفر طلبات بدل طلبين؛ `before.log` |
| الاختبارات الموجهة للواجهة أثناء التطوير | 56 نجاحًا؛ مجموعة فرعية، لا تضاف للشامل |
| باركود PostgreSQL في التشغيل الشامل النهائي | 3 نجاحات ضمن إجمالي الخادم |
| الشامل 03:14:17.880–03:35:37.421 UTC | خروج 1؛ 14/15 بوابة |
| خادم ذلك التشغيل | 1284 نجاحًا، فشل واحد بمهلة 20000ms، تجاوز واحد مشروط للترقية |
| واجهة ذلك التشغيل | 501 نجاحًا، صفر فشل وصفر تجاوز؛ 77 ملفًا |
| الترقية المستقلة | نجاح واحد؛ 38 حالة خارج مرشح الترقية |
| الأنواع وبناء API/ERP/docs/deck/sandbox وثبات المصدر | ناجحة في التشغيل الشامل نفسه |
| تدقيق الاعتماديات | صفر تنبيهات بكل درجات الخطورة؛ لا يعني خلو التطبيق من الثغرات |
| إعادة `sales-crm-tenants.test.ts` | 11 نجاحًا/صفر فشل/صفر تجاوز؛ الاختبار المتعثر نفسه نجح في 15871ms |
| توقيت إعادة الملف | بدء Vitest 05:22:18.478 UTC؛ آخر انتهاء مسجل 05:22:53.009 UTC؛ خروج الأمر 0 |
| المصالحة المستقلة | 7/7، دون تعديل بيانات التشغيل |

الحالة الوحيدة المتعثرة في الشامل كانت
`protects PDF, sending, history, retries, deletion, and reversal of foreign invoices`
في `sales-crm-tenants.test.ts:223`. انتهت بمهلة، لا بمخالفة عزل مثبتة.
نجاح الإعادة دون تعديل يدعم كونها مهلة تشغيل عابرة؛ لم نثبت سببًا
جذريًا إضافيًا، ولم نخفها أو نغير حدها. احتفظ بالسجل الأول والإعادة منفصلين.

تشمل اختبارات الباركود الأصفار البادئة، صنفًا خارج أول 500 صنف،
الاستدعاءات المتكررة والردود المعكوسة، سياقًا متغيرًا وحالة محجوبة،
الرموز المجهولة والملتبسة وغير النشطة والمتتبعة والمتغيرات،
عزل الشركة والكاشير، سحب المنح، وإغلاق الوردية.

## رحلة الواجهة والمصالحة

قاعدة PostgreSQL مؤقتة ببيانات مصطنعة، شركة 4 وفرع 2 ومستودع 3،
وكاشير بمسؤولية POS محدودة، دون صلاحية إدارة المخزون. لم تستخدم بيانات V2
أو تعدل نتائجها أو بيانات عملاء عاديين.

1. فتح وردية من الواجهة بافتتاحي نقدي 100.
2. إدخال `00001111` مرتين و`00002222` مرة؛ الأخير خارج صفحة الكتالوج الأولى.
   ظهرت كميتان للأول ووحدة للثاني؛ المجموع 27.
3. رمز مجهول أعاد 404 دون تغيير السلة. قبل البيع: صفر أوامر بيع وفواتير
   ودفعات؛ الحركات والطبقات والأستاذ مطابقة لخط الأساس.
4. مراجعة معاينة الخادم الفعلية: 27 وضريبة صفر لمنشأة الاختبار غير المسجلة.
   تحصيل نقدي مصطنع واحد، لا مزود دفع حقيقي.
5. الأمر `ORD-1793848584008-f3d54b77` والفاتورة `PINV-2026-00001`:
   بيع واحد وفاتورة واحدة ودفعة واحدة 27. المخزون في المستودع أصبح
   **18 و19** بدل 20 و20؛ مستودع الفرع الآخر بقي 20.
6. خصمان مخزنيان للبندين فقط؛ تكلفة بيع 9، وانخفاض قيمة المخزون 9،
   طبقات FIFO مطابقة للكميات، نقد +27 وذمم صافية صفر وإيراد 27.
   كل قيد جديد متوازن، والشركة الضابطة لم تتغير.

الأدلة: `browser-result.json` وصور الخطوات، `baseline.json` و`after-scans.json`
و`final.json` من معاملات قراءة فقط، و`reconciliation.json` بحسابات مستقلة دقيقة.
الاستجابة التشخيصية 403 خارج الاستدعاء الأصلي لا تحسب نجاحًا؛ أثبت طلب
قراءة إضافي أن اختيار الشركة والمسؤولية الصحيحين يعيد 200 دون `costPrice`
أو `cost_price`. نجحت تحققات هذا الفحص، لكن عمليته بقيت بسبب عمال التطبيق
بعد إغلاق تجمعه، فأوقفتها مهلة الأداة؛ ليس ذلك نتيجة بوابة جديدة أو إخفاق بيع.

## الحدود والتسليم

الإدخال محاكاة لوحة مفاتيح/Enter، لا اعتماد ماسح مادي. لم يحقن تأخير/عكس
للشبكة في المتصفح؛ أثبتته الاختبارات الحتمية. لم تختبر موازين أو USB أو أجهزة
حقيقية أو أصنافًا متتبعة للبيع. لم يختبر طبع ورقي أو قبول ضريبي إنتاجي.
يبقى `TAX_POLICY_NOT_READY` وحجب الحالات غير المثبتة؛ لا تعديل `main` أو نشر
أو دفع حقيقي أو نطاق تالٍ تلقائي. حزمة الأدلة منقحة ومستثناة من Git،
وتسلم منفصلة؛ التقرير والاختبارات والشيفرة محفوظة في الفرع.

---

# English delivery report

**Ordinary barcode entry is implemented and the native cashier sale is proved.**
Tested/pushed code: `0f81c5362986d7ec14e45bf2eb5ae992cdff62fe`, execution digest
`e32ffd47b45a00a0c3bd1ae934a75d04e9ee7a61fed8ed8a3d0a76df47b8eaaf`.
The final native UI and isolated API used that same clean source. Later report-only
commits do not constitute a new test run.

Enter performs an exact textual barcode/SKU read, preserving leading zeroes.
The specialized POS read reuses the existing identity predicate and POS source
authorization; it does not grant inventory management or monetary cost access.
Unknown, ambiguous, inactive, tracked and variant identifiers are rejected rather
than silently selecting a parent. Each intentional scan adds once, with current
basket references and delayed-response context checks. Existing server pricing,
tax review, checkout, resumed-basket binding and duplicate-sale guards are retained.
An obsolete scoped-role notice was also corrected without broadening grants.
No migration or dependency change was required.

**Verification is reported without conflating runs.** The archived old component
fails the Enter regression (zero requests instead of two). The full final-source
run, 03:14:17.880–03:35:37.421 UTC, exited 1: **14/15 gates**, API **1284 passed,
1 timeout, 1 conditional skip**, UI **501 passed**, independent upgrade **1 passed,
38 outside its filter**. Type checks, all builds, unchanged-source and dependency
audit passed (zero dependency advisories). The timed-out foreign-invoice PDF test
was rerun within its entire file: **11/11 passed**, including that exact test in
15871ms, with no source, timeout or protection change. Vitest started at
05:22:18.478 UTC; last recorded test end 05:22:53.009 UTC; command exit 0.
The original timeout remains in the evidence. This is not claimed as a fresh
single-run 15/15 or as 1295 API successes.

The limited native cashier opened a synthetic shift with 100 cash, scanned
`00001111` twice and off-page `00002222` once, rejected an unknown code without
mutation, reviewed the actual server quote and submitted exactly one cash sale
for **27** (zero VAT for this unregistered synthetic company). Direct independent
PostgreSQL reads prove one sale/invoice/tender, quantities **2 and 1**, warehouse
balances **18 and 19**, one stock issue per line, FIFO/physical agreement,
COGS **9**, inventory value reduction **9**, cash **+27**, net AR **0**, revenue
**27**, balanced new journals and unchanged control-company data. Lookup alone
changed none of the financial/inventory snapshots. Reconciliation passed **7/7**.

Keyboard input was simulated; no physical scanner, scales, hardware, paper print,
live payment or production tax acceptance was tested. Network reversal/context
cases are deterministic regressions, not browser fault injection. A supplemental
read proved correct company/responsibility selection yields 200 without cost
fields; its process outlived the assertions because application workers remained
after pool closure, and the shell timeout stopped it. That helper is not a gate.
No known functional barcode defect remains; the full-run timeout/retry limitation
above stays explicit. `main`, production, existing supermarket evidence and
`TAX_POLICY_NOT_READY` remain unchanged. No next scope is started.
