# تعليق طلب POS مرة واحدة — تقرير التسليم / Durable POS parking delivery

**التاريخ:** 2026-11-04. الأوقات أدناه UTC؛ الرياض UTC+3.
**المستودع والفرع:** `Abdullah-Almutairi12/Hasiba` — `sync/hasiba-erp-20261023`.
**مصدر الشيفرة المختبر والمتصفح والخادم:** [`4d3651ef17cbe88b5f564a453e4ce373a2981eda`](https://github.com/Abdullah-Almutairi12/Hasiba/commit/4d3651ef17cbe88b5f564a453e4ce373a2981eda).
**بصمة التنفيذ:** `201440fcce24dc7401331a5261182dd94fabe712ca0026a7ea5c49163d65aa4d`.
نقطة البداية المقبولة `dfe1504` محفوظة في التاريخ. أي Commit لاحق لهذا المصدر خاص بتقرير التسليم/الذاكرة/فهرسة الملف، ولا يمثل مصدرًا تنفيذيًا جديدًا.

## النتيجة ضمن النطاق

اكتمل إصلاح تعليق الطلب مرة واحدة واسترجاع نتيجته قبل تفريغ السلة، مع الحفاظ على فصل عميل المسودة عن الزبون التالي. لا ترحيلات ولا مكتبات جديدة، ولا تعديل `main` أو نشر إنتاجي أو دفع خارجي أو عمل أجهزة.

### ما ثبت قبل الإصلاح

شُغّلت حالتا انحدار دائمتان ضد مكوّن الصفحة الأصلي من `dfe1504`، دون إعادة شجرة المشروع إلى الوراء:

1. تأخير الرد والنقر مرتين: أُرسل طلبان بدل طلب واحد.
2. رد `204` بلا جسم: مُسحت هوية العميل رغم غياب معرّف مسودة مؤكد.

`before.log`: فشلان متوقعان، ورمز خروج 1؛ استُبعدت 32 حالة أخرى بمرشح هذا التشغيل الموجّه فقط، لا من بوابة الواجهة النهائية.

### ما تغير

- تُحفظ محاولة ثابتة بجسم الطلب ولقطة السلة والعميل قبل الإرسال في التخزين المحلي؛ فشل التخزين يمنع إرسال طلب غير قابل للاسترجاع.
- حاجز متزامن داخل الواجهة يمنع الإرسال المزدوج، وليس مجرد تعطيل الزر.
- الخادم يستخدم معاملات وإيصالات المحاولات القائمة: المسودة وإيصال نتيجتها يحفظان ذريًا. المفتاح والجسم نفسيهما يعيدان المسودة نفسها، واختلاف الجسم مع المفتاح نفسه يُرفض.
- يعاد فحص صلاحيات المستخدم والجهاز والنطاق داخل المعاملة بعد انتظار قفل المحاولة.
- لا تُمسح السلة والعميل إلا بعد رد صالح يحمل معرّف المسودة ومفتاح المحاولة والوردية والعميل المطابقين. `204` أو فقد الرد ليسا إثباتًا للحفظ أو عدمه.
- إعادة التحميل تستعيد اللقطة والمحاولة الأصلية، وإعادة التحقق ترسل المفتاح والجسم نفسيهما. لا يجدد هذا المسار محاولة دفع محفوظة أو يغير جسمها.
- حراسة النطاق/عمر المكوّن ومراجعة السلة والمقارنة قبل حذف التخزين تمنع ردًا قديمًا من مسح سلة أو محاولة أحدث.
- يبقى إيصال التعليق بعد استئناف المسودة وحذف رأسها؛ إعادة إرسال المحاولة القديمة لا تنشئ مسودة بديلة.

الملفات التنفيذية والاختبارات:

1. `artifacts/api-server/src/routes/pos.ts`
2. `artifacts/api-server/src/routes/pos.park-resume.test.ts`
3. `artifacts/erp-system/src/pages/pos-iconic.tsx`
4. `artifacts/erp-system/src/pages/pos-iconic.test.tsx`
5. `artifacts/erp-system/src/hooks/use-pos-parking.ts`
6. `artifacts/erp-system/src/hooks/use-pos-parking.test.ts`

## نتائج التحقق الجديدة — لا نتائج موروثة

| التشغيل | النتيجة الفعلية |
|---|---|
| `pnpm run verify`، 07:16:16.772–07:34:25.118 | خروج **1**: 14/15 بوابة ناجحة. الخادم 1255 ناجحًا، فشل واحد بمهلة PDF، وحالة متجاوزة واحدة. |
| تشخيص ملف `sales-crm-tenants.test.ts` دون تعديل | 11/11 ناجحة، خروج 0. الحالة التي انتهت بمهلة 20000ms نجحت في 4698ms. |
| إعادة بوابة الخادم كاملة، 07:37:25.193–07:51:46.303 | خروج **0**: **1256 ناجحًا، صفر فشل، حالة متجاوزة واحدة**. المصدر نظيف ومطابق قبل التشغيل وبعده. |
| بوابة الواجهة على المصدر نفسه | **452 ناجحًا، صفر فشل**. |
| الأنواع، الترقية المستقلة، البناء والتدقيق وبقية البوابات | ناجحة في التشغيل الشامل على المصدر نفسه؛ لم تُعَد بلا سبب. |
| المصالحة المستقلة للرحلة الأصلية | **97 تحققًا ناجحًا**، منفصلة عن أعداد اختبارات الخادم والواجهة. |
| المحافظة على البيانات الاصطناعية السابقة | **26 مقارنة مجموعات** ناجحة، مع فروق تهيئة موضحة أدناه. |

**النتيجة المجمعة:** أصبحت للبوابات الـ15 أدلة نجاح على المصدر نفسه بعد إعادة بوابة الخادم. هذا **ليس** ادعاءً بأن التشغيل الأول خرج بصفر أو بأن تشغيلًا شاملًا ثانيًا لـ`verify` قد حدث. حُفظ فشله وسجله منفصلين. سبب البطء العابر الدقيق غير محسوم؛ لم يثبت عيب برمجي في مسار PDF ولم تُغيّر مهلته أو اختباره.

الحالة المتجاوزة في تشغيل الخادم العادي تخص تثبيتًا سابقًا لرحلة ترقية المرتجع المرتبط؛ شُغّلت بوابتها المستقلة فعليًا ونجحت. لا تُجمع الفحوص الموجهة (11 خادمًا و44 واجهة أثناء التطوير) مع الإجمالي، ولا تستبدل نتيجة المصدر النهائي.

## رحلة الواجهة الأصلية والمصالحة

شركة اختبار مستقلة **13**، فرع **15**، مستودع **31**، كاشير **28**، وردية **35**، العميل أ **7**، صنف **11**. لا بيانات عملاء تشغيلية.

| المرحلة | المتوقع | المثبت |
|---|---|---|
| تأخير الرد والنقر مرتين | إرسال أولي واحد ومسودة واحدة | طلب أولي واحد؛ المسودة **7**، `POS-PARK-2026-00003`. |
| رد فارغ بعد حفظ فعلي | بقاء السلة والعميل | الخادم حفظ 201، وحوّل غلاف المتصفح الرد إلى 204؛ بقيت السلة والعميل ودليل المحاولة. |
| إعادة التحميل والتحقق مع فقد الرد | استرجاع النتيجة نفسها دون مسح غير مؤكد | الخادم أعاد المسودة 7 مع `replayed:true`، ثم رُمي خطأ شبكة اختباري بعد الرد؛ بقيت المحاولة. |
| إعادة التحميل والتحقق مرة أخرى | تأكيد المسودة الأصلية ثم التفريغ | المفتاح والجسم الأصليان؛ المسودة 7 نفسها؛ بعدها فقط أصبحت السلة فارغة بلا عميل. |
| بيع مستقل نقدي 100 | لا ينسب للعميل أ | الطلب **8** عميله `null`؛ الفاتورة **6** `PINV-2026-00005` للعميل النقدي **8**. |
| استئناف المسودة وبيعها نقدًا 100 | استعادة العميل أ | الطلب **9** للعميل **7**؛ الفاتورة **7** `PINV-2026-00006` للعميل **7**. |

المحاولة الأصلية: `86984411-11e3-4105-b4fd-f2e5f6f2ac21`. ثلاثة طلبات نقل إجمالًا: إنشاء واحد واسترجاعان صريحان، كلها أعادت معرّف المسودة نفسه.

في لقطات الرد الفارغ والفقد والاسترجاع المؤكد: مسودة واحدة وإيصال محاولة واحد؛ **صفر فواتير ودفعات وسندات قبض إضافية، وصفر تغير في المخزون أو الحركات أو القيود نتيجة التعليق**. كانت هناك حركة افتتاح مخزون وقيد افتتاح قبل الرحلة؛ لم يُوصف وجودهما بأنه صفر مطلق.

بعد البيعين الفعليين فقط: فاتورتان بمجموع **200**، دفعتان وسندا قبض بمجموع **200**؛ مخزون **18 × 50 = 900** بدل **20 × 50 = 1000**؛ حركتا صرف بكمية إجمالية **2**؛ تكلفة مبيعات **100**، إيراد **200**، نقدية دفترية من المقبوضات **200**، ذمم صافية **0** وضريبة **0** في منشأة الاختبار غير المسجلة صراحة. ستة قيود إضافية للبيعتين، وجميع القيود السبعة متوازنة ومرحّلة.

فحص PostgreSQL الدائم يمسك قفل المحاولة من اتصال مستقل، ويثبت وجود منتظرين اثنين على القفل نفسه قبل تحريره؛ النتيجة مسودة واحدة، وإعادة بنفس النتيجة، ورفض 409 للجسم المختلف. ويغطي بقاء الإيصال بعد استئناف المسودة وحذفها.

### المحافظة على التسليم السابق

نتيجة السوبرماركت V2 في الشركة **11** بقيت دون تغيير: **8 وحدات** والنقد الختامي **117**. قورنت 15 مجموعة بيانات قبل الرحلة وبعدها.

في شركة اختبار العميل السابقة **12**، بقيت حقائق المخزون والفواتير والمدفوعات والقيود والعملاء دون تغيير. يوجد فرق معلن، لا يُخفى في المقارنة: تهيئة الخادم القائمة في `sales-init.ts` جعلت الفاتورتين 4 و5 للقراءة فقط (`is_locked: false → true` ووقت قفل `2026-11-04T07:17:03.610Z`). هذا تحديث حماية للمستندات غير المسودة عند التشغيل، لا تعديل مالي أو إعادة إصدار. فُحصت هاتان الخاصيتان صراحة وقورنت بقية حقائق المستندات كاملة.

## الأدلة والحدود

الحزمة المنقحة تحتوي سجلات التشغيل الأصلي والإعادة، والنتائج الخام، ولقطات SQL الست، وفحص المصالحة المستقل، وتتبع النقل، وتقرير المتصفح، وبصمات الملفات. لا تحتوي بيانات الوصول الخاصة أو سجل الخادم الخاص أو حالة البيئة.
التقرير محفوظ في Git؛ الحزمة تُسلّم كملف قابل للتنزيل في Library، وليست ضمن ملفات Git المرفوعة لأن المخرجات المولّدة مستثناة.

ملفات المصدر المعروضة فعليًا في المتصفح:

- `/src/pages/pos-iconic.tsx`: SHA-256 `e16ab5a653d8f2efcaf96d9e72ea67e2ac27c29a3bbc1ab57a895b338d6d7ee0`.
- `/src/hooks/use-pos-parking.ts`: SHA-256 `8c95f8f3f7df90913824536b2d80be62173a777400d55cb5ec77205b64873c05`.

هذه بصمات وحدات Vite المحوّلة، وليست بصمة ملفات TypeScript الخام. مصدر الخادم والمتصفح والاختبارات هو Commit 4d3651e نفسه وبصمة التنفيذ المبينة أعلاه.

الحدود:

- فقد الرد و204 اختُبرا بغلاف نقل داخل المتصفح **بعد حفظ فعلي**، لا بقطع اتصال جهاز حقيقي.
- عند استئناف العميل، يعرض أحد مواضع الواجهة `عميل #7` بدل الاسم الكامل؛ الهوية المسترجعة والفاتورة صحيحتان. لم يُوسّع العمل إلى تحسين العرض.
- صور المتصفح التسع مراجع منصة في `browser-report.json` ومحادثة الاختبار؛ لا تحتوي ZIP على ملفات JPEG الأصلية.
- إذا استمر التعذر أو سُحبت الصلاحية فلا يُعامل رفض الوصول كإثبات لعدم التنفيذ، ولا تُحذف المحاولة تلقائيًا.
- لا قبول ضريبي إنتاجي أو دفع شبكي أو أجهزة أو ضمان شامل لخلو ERP من العيوب. `TAX_POLICY_NOT_READY` لم يُتجاوز.
- لا إخفاق وظيفي متبقٍ مثبت في معايير هذه الشريحة. لم تبدأ شريحة جديدة.

---

## English delivery report

**Scope closed:** durable, idempotent POS parking with confirmation-gated cart/customer clearing. The previously accepted walk-in versus parked-customer isolation remains intact.

**Tested code, native browser and backend:** `4d3651ef17cbe88b5f564a453e4ce373a2981eda`.
**Execution fingerprint:** `201440fcce24dc7401331a5261182dd94fabe712ca0026a7ea5c49163d65aa4d`.
Repository/branch remain `Abdullah-Almutairi12/Hasiba`, `sync/hasiba-erp-20261023`. Later delivery commits are documentation/catalog only.

### Defects reproduced and changes

Two permanent regression tests fail against the original `dfe1504` page: delayed double-click sends twice, and an empty 204 clears the customer without a confirmed draft ID. No working-tree reset was used.

The client persists one immutable intent and basket/customer snapshot before transport, uses a synchronous send fence, and recovers the exact request after reload. It only clears after a validated result matching the original key, session and customer. Scope/lifetime guards, basket revision checks and conditional storage removal protect newer work from stale replies.

The server reuses existing financial-request receipts and transactions. Same key/body returns the same draft; different body is rejected. Draft creation and its receipt commit atomically. Authority is checked again after waiting for the attempt lock. A resumed/deleted draft does not retire its receipt or permit recreation. Existing payment intents are not rebuilt or changed. No schema or dependency changes.

### Actual verification, including the unsuccessful first run

- Full `pnpm run verify`, **07:16:16.772–07:34:25.118 UTC**, exited **1**: **14/15** gates passed; API **1255 passed / 1 failed / 1 skipped**. The failure was an unchanged 20-second PDF tenancy test timeout, not a parking assertion.
- Its unchanged diagnostic file rerun passed **11/11**, including that test in **4698ms**.
- The **entire API gate** was rerun on the same clean source, **07:37:25.193–07:51:46.303 UTC**, exited **0**: **1256 passed / 0 failed / 1 skipped**.
- UI: **452 passed / 0 failed** on the final source. Types, independent historical upgrade, builds, audit and other gates passed in the original full run.
- All **15** required gates therefore have passing same-source evidence after the explicit API rerun. This does **not** change the original full-command exit or imply that a second complete `pnpm verify` ran.
- The ordinary API skip is the conditional historical linked-return upgrade, separately executed successfully by the independent upgrade gate. Targeted development subsets are not added to suite totals.
- Independent native reconciliation: **97 passing checks**; preservation: **26 group comparisons**. These are not API/UI test counts.

### Native journey and independent reconciliation

Fresh artificial company **13**, session **35**, customer A **7**. One actual initial POST after rapid double-click produced draft **7**, `POS-PARK-2026-00003`. A synthetic empty 204 after real persistence retained the basket/customer. Reload/recovery returned that same draft; deliberately losing this recovery response again retained the intent. A further reload/recovery confirmed the same result and only then cleared the basket/customer.

Parking checkpoints show **one draft, one receipt, no invoices/payments/customer receipts and no stock/journal delta from parking**. The persisted original key/body survived both reloads.

Walk-in order **8** has `customer_id = null`; invoice **6**, `PINV-2026-00005`, belongs to cash customer **8**, not A. Resuming draft 7 restored A; order **9** and invoice **7**, `PINV-2026-00006`, belong to customer **7**. Both actual sales are 100 each.

Final totals: invoices/payments/receipts **200**, stock **18 × 50 = 900**, two unit issues, COGS **100**, revenue **200**, cash ledger receipts **200**, net AR **0**, VAT **0** in this explicitly unregistered fixture. Six additional journals relate to the two real sales; all seven journals balance. The permanent PostgreSQL test proves two actual advisory-lock waiters resolve to one draft/receipt, with changed-body rejection and replay after resume.

V2 company **11** remains **8 units / closing cash 117**. Prior customer-isolation company **12** retains its financial facts. Its invoices 4/5 received only the pre-existing startup read-only backfill (`is_locked`/`locked_at`); those exact metadata differences are disclosed and checked, not silently ignored.

### Evidence and limits

The sanitized archive preserves the failed first full run, complete successful API retry, raw results, six SQL snapshots, independent assertions, transport trace, browser report and provenance. Private access/environment/private host logs are excluded.
The report is tracked in Git; the generated ZIP is delivered through Library and is not included in the pushed repository.

Nine browser screenshots are platform references, not JPEG binaries in the ZIP. Network faults were injected after real commits, not physical device outages. The resumed customer dock has an existing `customer #7` label fallback; its ID and invoice are correct. Persistent denial never proves non-execution or silently clears the intent.

No production deployment, `main` change, external payment, hardware work, tax-gate override, or broader ERP readiness claim. No demonstrated functional failure remains within this slice; no new slice was started.
