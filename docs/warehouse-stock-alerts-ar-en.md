# حدود المخزون والتنبيه الداخلي لكل مستودع / Warehouse stock limits and internal alerts

## النتيجة العربية — 5 نوفمبر2026

أُغلقت هذه الشريحة ضمن نطاقها المثبت، لا جميع وظائف المخزون أو ERP.
المشروع والمستودع نفسهما، والفرع `sync/hasiba-erp-20261023`.
حُفظ تسليم الباركود `77841f5` والتحديث المحلي الأحدث `9fade40` في التاريخ؛
ونقطة الرجوع السابقة للتعديل هي `safety/warehouse-alerts-before-20261105`.
لا تغيير لـmain أو نشر إنتاجي أو أمر شراء آلي أو تفعيل إرسال خارجي.

### المصدر والقبول الجديد

- الشيفرة المختبرة: [2ffb4abbadeb6298f3be779b91b4aedb362bf0e3](https://github.com/Abdullah-Almutairi12/Hasiba/commit/2ffb4abbadeb6298f3be779b91b4aedb362bf0e3).
- بصمة التنفيذ: `f253bd1d41a17dcaef9bc74828beef35e4dd69e81e0c3c7748f6babb31f2a6a5`.
- المصدر عند بداية التشغيل ونهايته مطابق، والشجرة نظيفة في المرتين.
  ومصدر الخادم والواجهة في أدلة الرحلة هو المصدر والبصمة نفسيهما.
- التشغيل النهائي الفعلي: **2026-11-05 11:54:28.903–12:19:51.008 UTC**
  (14:54–15:19 الرياض)، خروج **0**.
- **15/15 بوابة**؛ الأنواع والبناء وتدقيق الاعتماديات وحراسة ثبات المصدر ناجحة.
- الخادم: **1294 نجاحًا، صفر إخفاق، تجاوز واحد** في104 ملفات.
  التجاوز لمسار الترقية المشروط، شُغّل منفصلًا في بوابته ونجح.
- الواجهة: **515 نجاحًا، صفر إخفاق، صفر تجاوز** في79 ملفًا.
- الترقية المستقلة: **اختبار واحد ناجح** و38 اختبارًا مرشحًا خارج اختيار
  هذه البوابة؛ ليست38 إخفاقًا أو وظائف ادُّعي اختبارها هنا.
- الموجهة19/19 (9 للشريحة و10 للاحتفاظ)، و7/7 واجهة، وVAT3/3،
  مجموعات فرعية وليست أعدادًا تضاف إلى الإجماليات أعلاه.
- لا إعادة تحقق شاملة تلقائية بعد هذا النجاح. توثيق التسليم اللاحق لا يغيّر
  المصدر التنفيذي؛ آخر رفع مؤكد ورقم تسليم الوثائق في `sync-receipt.json`
  داخل الحزمة وفي رسالة التسليم.

### ما نُفّذ وأعيد استخدامه

1. استُخدمت صفحة وقواعد إعادة الطلب القائمة، وصلاحيات المسؤوليات والقوالب
   ومحرك المحاولات المالية والتدقيق وقناة `alerts` القائمة؛ لا محرك تنبيهات
   أو مخزون أو دفتر مالي موازٍ.
2. حد أدنى وهدف لكل صنف عادي غير متتبع ومستودع. التنبيه عند الكمية الفعلية
   **أقل من الحد أو مساوية له**، وليس مجموع الشركة أو صافي المحجوز/في الطريق.
   الهدف المحفوظ ليس توصية شراء مبنية على مهلة أو مورد.
3. تفعيل صريح؛ الترحيل لا يتبنى قواعد المنشآت القائمة ولا يفعّلها.
   تبقى إعدادات EOQ/النشاط القديمة محفوظة، ولا تنشئ الشريحة أمر شراء.
   تبني الصنف للتنبيه المستودعي يمنع جدولة نقصه عبر المسار الخارجي العام
   القديم؛ إيقاف التنبيه الجديد لا يعيد الإرسال الخارجي خفية.
4. دورة مفتوحة واحدة لكل قاعدة، تحديث للكمية في الدورة نفسها، وتعافٍ فوق
   الحد، ودورة جديدة عند الانخفاض التالي؛ الإيقاف يغلق الدورة ولا يمحوها.
   المتتبع والمتغير لا يُسطّحان إلى رصيد أصل.
5. طابور PostgreSQL داخل معاملة الحركة/الإعداد، ومعالج مستقل بعد الالتزام،
   ومصالحة عند البدء وبعده. لا اعتماد على بقاء عملية البيع مفتوحة لإيصال
   التنبيه. لا يعلن زمن تسليم مضمون أو قبول تشغيلي خارجي.
6. `inventory.read` للقراءة و`inventory.reorder.manage` للإدارة؛ النطاق
   للشركة والفرع والمستودعات المسموحة، مع إعادة الفحص داخل التنفيذ بعد
   انتظار الأقفال. لا صلاحيات بحسب المسمى الوظيفي، ولا منح جماعي ضمني.
   استجابات الأصناف/الحدود لا تتضمن حقول التكلفة بدل إخفائها بصفر.
7. مفتاح وجسم محاولة ثابتان، حراسة نقر متزامنة، وإبقاء المجهول عند الفشل
   أو الرد الناقص. لا تُمسح المحاولة إلا بنتيجة صحيحة أو رفض بلا كتابة
   محفوظ وموثوق؛ لا يعتبر403 أو انقطاع الاتصال دليلًا على عدم التنفيذ.

### رحلة الواجهة والمصالحة المستقلة

البيانات اصطناعية على PostgreSQL منفصلة، وليست بيانات العملاء.
من الواجهة الأصلية: اختيار مسؤولية مخولة، تفعيل، فقد رد الحفظ بعد الالتزام،
إعادة تحميل واسترجاع المفتاح والجسم نفسيهما، وبيعان نقديان أصليان.
انتقلت كمية المستودع أ21→20→19 وبقيت دورة تنبيه واحدة؛ المستودع ب100
لم يحجبها. أثبتت استجابات الصفحة حالة التعافي والدورة الجديدة والإيقاف.
حساب القراءة لم يجد أدوات التعديل، ورفض الخادم POST المباشر403 دون أثر.

الاستلام والصرف في بقية تسلسل الدورة نفذا عبر **متحكم اختبار يستخدم محرك
المخزون الأصلي**، لا عبر شاشة الاستلام؛ لا ندّعي رحلة مشتريات أصلية.
حصل خطأ ترتيب في الاختبار: أُوقف التنبيه عند21 قبل صرف كان ينبغي أن
يكون أثناء التفعيل. بقي الصرف محفوظًا بلا دورة جديدة، وهو سلوك صحيح.
أُضيف استلام تصحيحي+1 ضمن البيئة المصرح بها، ثم أُعيد التفعيل وصُرف1
ففتحت الدورة الثانية، ثم أُوقف وصُرف1 دون دورة إضافية. لم تُمح حركة أو
قيود لإخفاء التصحيح. عبارة `authorized_by_user` في ملف المتابعة تعني
هنا تصريح الوكيل الرئيسي ضمن نطاق الاختبار، لا قرار مستخدم جديدًا.

المصالحة المستقلة تقرأ SQL نصيًا وتحسب بـPython Decimal، دون حاسبات التطبيق:

| الدليل | النتيجة المثبتة |
|---|---|
|16 لقطة ومطابقة المصدر|كلها من2ffb4ab والبصمة النهائية، دون تعديل شيفرة|
|المستودع أ / ب / مستودع الفرع الآخر|19 /100 /20، والأخير خارج نطاق الموظف المحدود|
|إجمالي الشركة وقيمتها|139 وحدة؛ الكمية×التكلفة=طبقات FIFO=حساب المخزون بالأستاذ=417 ريالًا|
|الأثر التجاري الأصلي|طلبا بيع وفاتورتان ودفعتان فقط؛ تكلفة البيع6|
|الدورات في أ|دورتان محفوظتان: تعافت الأولى، وأُوقفت الثانية|
|القيود|15 قيدًا متوازنًا في كامل التجهيز والحركات والبيع؛ ليست15 قيدًا سببها التنبيه|
|الإعداد وحده|5 مقارنات قبل/بعد: صفوف المال والمخزون نفسها تمامًا|
|العزل|مستودع ب والشركة الضابطة لم يتغيرا بالعمليات خارج نطاقهما|
|الشراء|صفر أوامر شراء من التنبيه|

وأُثبت التعافي من **توقف عملية المعالج فعليًا**: أثناء توقف الخادم حُفظت
قاعدة مصطنعة لمستودع الفرع الآخر عند20/حد20؛ طابور1 ودورة0. بعد تشغيل
العملية نفسها بالشيفرة النهائية صار الطابور0 ودورة مفتوحة1، مع تطابق
كل صفوف المخزون والمالية الأصلية وحواشيها المستقلة دون تغيير.
الدورة الإضافية هنا تخص قاعدة اختبار أخرى، وليست تكرار دورتي المستودع أ.

الصور وآثار الطلبات ولقطات SQL هي دليل الأفعال؛ جمع الوكيل الرئيسي التقرير
منها بعد إيقاف تجميع مساعد المتصفح، عقب حفظ الأفعال والمصالحة وقبل إغلاق
خدمات الاختبار. لا ندعي نتيجة منفصلة مكتملة لمهمة تجميع ذلك المساعد.
لم يُفتح جرس صندوق التنبيهات العام من الحساب المحدود؛ عرض الحالة/التاريخ
في صفحة القواعد مثبت، ونطاق قناة التنبيهات القائمة اختُبر في الخادم.

### الإخفاقات التي كُشفت ومعالجتها

- كشف المتصفح أن بوابة المسار والقائمة لم تسمحا للمسؤولية المحدودة ببلوغ
  الصفحة رغم سماح API. عولج المسار والقائمة فقط، مع3 اختبارات انحدار فاشلة
  قبله وناجحة بعده، دون منح وصول عام للمخزون.
- حفظ ارتباط دورة التنبيه بتاريخها كشف تعارض تنظيف التنبيهات القديمة:
  كان FK يوقف دفعة التنظيف كلها. أصبح التنظيف يستثني المرتبط بالدورة،
  ويحذف القديم العادي المستحق؛ اختبار دائم فشل قبل الإصلاح ثم نجح.
- حُدّث سجل الترحيل المتوقع في اختبار الترقية ليشمل0074 مع إثبات عدم
  تفعيل/تبني القواعد التاريخية، لا حذف تحقق أو إضعافه.
- فشل تشغيل سابق14/15 بمهلة20 ثانية لاختبار VAT، مع1293 نجاحًا وإخفاق1
  وتجاوز1؛ لم يفشل تأكيد حسابي. نجح منفردًا3/3 دون تغيير المهلة أو المصدر،
  ثم نجح ضمن التشغيل النهائي الكامل أيضًا. السبب الدقيق للمهلة السابقة
  غير مثبت؛ لا نجزم بأنه ازدحام CPU.
- كانت قراءة مؤقتة لسجل المرحلة المشترك تعرض الإخفاق السابق قبل نشر نتيجة
  المرحلة الحالية؛ صُححت النسبة فور نشر النتيجة. **ليس إخفاقًا ثانيًا جديدًا**.
- تشغيل سابق انقطع بفقد البيئة بعد6 مراحل، بلا خاتمة أو رمز خروج؛ حُفظ
  بهذا الوصف منفصلًا، لا نجاحًا أو فشل تطبيق مختلقًا.
- أخطاء تجهيز متحكم إعادة التشغيل (اسم جدول قديم وrevision0 غير صالح)
  حُفظت منفصلة وصُححت وفق المخطط والعقد الحاليين، بلا تغيير منطق المنتج.

### الملفات والأدلة والحدود

الملفات الأساسية: `0074_warehouse_stock_alerts.sql`، خدمة
`warehouse-stock-alerts.ts` واختبارها، `inventory.ts` و`dashboard.ts`،
`stock-engine.ts` و`alerts-cleanup-cron.ts` و`team-catalog.ts` و
`managed-access.ts`، صفحة `reorder-rules.tsx` واختبارها، `App.tsx` و
`layout.tsx` و`pos-actions.ts` واختبار المدخل، وعقد OpenAPI وتوليداته.
القائمة الكاملة23 ملفًا في `source-file-list.txt`.
تحديث العرض اقتصر على وصف النقطة الثالثة بشريحة المخزون6؛ فُحصت بصريًا،
ولم يُعد تصميم العرض أو ادعاء قبول جميع صفحاته أو إصدار PDF جديد.

داخل ZIP المنقح: `verification-run.json` و`verification-final/`،
`browser/`، `independent-reconciliation.json`، `restart-*.json`،
`deck-inventory.jpg`، وملفات التشغيل الفاشل/المنقطع في مجلدات منفصلة،
مع manifest لبصمات الملفات. استُبعدت بيانات الدخول وملفات الحالة الخاصة
والمفاتيح؛ الملفات المولدة ليست موجودة في Git لمجرد حفظها محليًا، وتسلم
الحزمة مستقلة في قناة الملفات.

لا متبقٍ برمجي مثبت داخل هذه الشريحة بعد القبول النهائي. المتتبعات
والمتغيرات وتوصيات الشراء وAI والإرسال الخارجي والأجهزة والطباعة والاختبار
الإنتاجي خارجها؛ لم تُفعّل. يبقى `TAX_POLICY_NOT_READY` ونطاقه السابق.
الخادم وواجهة ERP والعرض أُعيدت إلى workflows التطوير؛ خدمات الاختبار
وقاعدتها أُغلقت بعد حفظ الأدلة. لا شريحة تالية تلقائية.

---

## English delivery

**Accepted within this bounded feature, not a claim that the entire ERP is complete.**
Repository/branch and prior barcode delivery are preserved. Tested implementation:
`2ffb4abbadeb6298f3be779b91b4aedb362bf0e3`; executable fingerprint:
`f253bd1d41a17dcaef9bc74828beef35e4dd69e81e0c3c7748f6babb31f2a6a5`.
Final run: **2026-11-05T11:54:28.903Z–12:19:51.008Z, exit0**.
All **15 gates passed**: API **1294 passed/0 failed/1 conditional skip**,
UI **515 passed/0 failed/0 skipped**; the separately selected historical-upgrade
case passed. Its38 filtered cases are selection exclusions, not extra successes.
Directed subsets are included in these totals, not added to them.

The existing reorder page/rules, responsibility engine, financial-intent/audit
mechanism and alerts inbox storage are reused. Explicit warehouse adoption is
off by default. Physical warehouse stock≤minimum creates/updates one open cycle;
above-minimum recovers it, a later fall creates a new cycle, and disabling
preserves history. Targets are configuration, not procurement advice.
No automatic PO, external delivery, cost disclosure or tracked/variant flattening.
An adopted product does not silently resume legacy external low-stock messages
when its warehouse alert is disabled.

Atomic PostgreSQL queue triggers capture only committed changes; a separate
worker reconciles on startup and drains independently of sale completion.
Read/manage are distinct and company/branch/warehouse scoped. Authority and
references are checked after locks. Stable request identity/body, duplicate
guards, authoritative no-write rejection receipts and reload recovery protect
configuration attempts; network/permission errors do not prove non-execution.

Native UI evidence covers scoped navigation/configuration, lost configuration
response and original-attempt recovery, two real synthetic cash sales21→20→19,
same-cycle updates and reader denial. Receipts/issues in the rest of the cycle
are controlled calls to the real stock engine, **not native receiving UI**.
One premature test disable was retained; a disclosed corrective receipt and the
intended re-enable/issue/disable/issue sequence completed without rewriting history.
Final A19/B100/other-branch20 gives139 units and **SAR417** independently equal
across physical quantities×cost, FIFO layers and inventory GL. There are exactly
two native sales/invoices/payments;15 journals across all setup/movement/sale
activities are balanced. Five configuration-only comparisons show identical
financial/stock rows, and the control company remains unchanged.

A real worker-process stop/restart independently proved durable queue1→0 and
one new cycle for a separate synthetic rule at stock20/min20, with original
stock/financial rows exactly unchanged. All16 native snapshots match the final
clean source. Main consolidated the saved native and database evidence after
stopping the helper's pending summary work; no separate completed helper-summary
result is claimed. The restricted user's general inbox bell was not opened;
native rule status/history and server inbox scoping are evidenced.

Regression fixes include scoped route/sidebar access and retention cleanup:
cycle-linked alerts survive while unrelated eligible old alerts are deleted.
Their permanent tests failed before and passed after the fixes. The upgrade
manifest includes0074 and asserts no automatic legacy adoption.
One earlier full run timed out an unchanged VAT PDF case; focused and final
full runs passed it without raising its20s deadline. The exact earlier cause is
not established. A stale shared stage log was briefly misattributed and corrected;
there was **no second new VAT failure**. Environment-loss evidence has no invented
end/exit. Harness table/revision mistakes are separately retained.

The existing deck's inventory-slide copy alone was updated and visually checked;
no PDF regeneration or whole-deck acceptance is claimed. No main changes,
production deployment, external payments/messages, AI/procurement extensions or
tax-policy activation occurred. Normal development workflows were restored and
isolated test services closed. Sanitized ZIP contains raw runs, snapshots,
screenshots, independent reconciliation, restart proof, hashes and final sync
receipt; it is delivered separately, not falsely described as tracked in Git.
No proven in-scope defect remains; no further scope starts automatically.
