# منع تحصيل نسخة قديمة من سلة POS / Confirmed resumed-basket revisions

## النتيجة والنطاق — 2026-11-04

أُغلق الإصلاح ضمن هذه المهمة: أصبحت النسخة المؤكدة لدى الخادم مرجعًا للحفظ والتحصيل. لا يستطيع تبويب قديم الكتابة فوق تعديل أحدث أو تحصيل كميته وعميله القديمين. تبقى هوية المسودة ووردية المصدر وحماية البيع النهائي الواحد والمحاولة المالية الأصلية محفوظة.

- المستودع: `Abdullah-Almutairi12/Hasiba`؛ الفرع: `sync/hasiba-erp-20261023`.
- نقطة البداية المحفوظة: `179b477d1885ffcff884b3d0749f01e5a0eab5f5`.
- مصدر الشيفرة المختبر والمرفوع: [9ebb23e7c70e70240031fc04c9c9e8fef14ea883](https://github.com/Abdullah-Almutairi12/Hasiba/commit/9ebb23e7c70e70240031fc04c9c9e8fef14ea883).
- بصمة التنفيذ: `62663fd9ebb54f9f5e65f6efe3cd57b3bbf94763b6c15da03e7fa27eb0c52b11`.
- الخادم والمتصفح والبوابات النهائية على المصدر نفسه؛ بدأ الخادم المعزول عليه عند `14:41:48Z` والشجرة نظيفة. التغييرات اللاحقة للتسليم توثيقية فقط.
- لا ترحيل مخطط جديد، ولا تغيير `main` أو نشر أو دفع حقيقي. لم يُفتح نطاق آخر، ولم تُعد تجربة السوبرماركت V2 أو تُستبدل أدلتها.

## ما ثبت قبل الإصلاح

في الواجهة الأصلية فُتحت مسودة واحدة (#5) بقطعتين/العميل أ، ونُسخت هوية الاسترجاع نفسها إلى تبويب آخر. عدّل الأول إلى ثلاث/ب؛ لم يُرسل حفظ نسخة إلى الخادم. دفع التبويب القديم أولًا، وقَبِل الخادم `2/A` بطلب 201، فأنشأ البيع #6 والفاتورة `PINV-2026-00003` ونقص المخزون 14→12. حُفظت هذه العملية الاصطناعية ولم تُحذف لتجميل النتائج.

**حد إسناد المصدر السابق:** كان HEAD هو `179b477` وبدأ الفحص بشجرة نظيفة، لكن حدثت تحديثات HMR وتغييرات عمل أثناء الرحلة؛ لذلك لا يُقدَّم تصوير «قبل» كاختبار حزمة كاملة نظيفة لهذا SHA. ملفات `before-browser.json` و`before-sql.json` تحفظ هذا القيد والطلب الفعلي وآثاره. اختبار الخادم الأول قبل التنفيذ واجه المسار غير الموجود 404 وانتظار حواجز لاحقة؛ لا نعرض ذلك كنجاح اختبارات حسابية قديمة.

## التغيير

1. النسخة الابتدائية 0 تستند إلى إيصال الاسترجاع الأصلي، مع سجل نسخ لاحقة دائم في مخزن المحاولات القائم؛ لا استبدال لدليل الاسترجاع.
2. الحفظ والمبيع يتشاركان قفل المصدر. يرفض الخادم اختلاف النسخة أو اختلاف الأصناف/الكميات/العميل، حتى مع تخمين رقم النسخة الصحيحة.
3. الحفظ المتعارض يعطي نتيجة مؤكدة بلا تعديل. إعادة المفتاح نفسه تستعيد نتيجته؛ تغيير محتواه بالمفتاح نفسه يُرفض.
4. توضح الواجهة «محليًا فقط» حتى تأكيد الخادم، وتمنع الدفع أثناء حفظ غير محسوم. زر مستقل يعرض أحدث نسخة للمراجعة، ولا يدفعها تلقائيًا.
5. طلب التحصيل المجهول يبقى بجسمه ومفتاحه. بعد رفض النسخة القديمة يُتحقق من المحاولة ويُغلق طلبها القديم بالخدمة القائمة قبل مراجعة النسخة الأحدث.
6. إذا سبق البيعُ تعديلًا متأخرًا أُعيد الإيصال الأصلي دون تغيير الفاتورة. السلة المستقلة المماثلة لا ترتبط بهذا القيد.

أهم الملفات: `pos-resumed-sale.ts` و`pos-resumed-basket.ts` ومسارات `pos.ts`؛ اختبارات `pos.resumed-revisions.test.ts`؛ خطافات `use-pos-resumed-basket` و`use-pos-resumed-version`؛ `pos-iconic.tsx` واختباراته؛ عقد OpenAPI والملفات المولدة.

## الرحلة الجديدة والمصالحة

البيانات مصطنعة في PostgreSQL معزولة `hasba_test_verify`؛ الشركة4/الفرع3/المستودع3/الوردية2/الصنف3/أ3/ب4. المخزون عند بداية رحلة الإصلاح 12 بسبب العمليات السابقة المحفوظة.

| الترتيب | النتيجة المثبتة |
|---|---|
| استرجاع المسودة الجديدة #7 في تبويبين بهوية واحدة | 2/أ؛ تعديل الأول إلى3/ب محلي فقط، ثم تأكيد النسخة1 في الخادم دون أثر مالي |
| دفع التبويب القديم أولًا بعد التأكيد | رفض؛ صفر فواتير أو دفعات أو حركات أو قيود جديدة مقارنة بلقطة ما بعد الاسترجاع |
| إغلاق محاولة الدفع القديمة، ثم عرض أحدث سلة ومراجعتها | 3/ب، النسخة1، لا دفع تلقائي |
| دفع صحيح ثم إسقاط الرد بعد 201 وتحديث فعلي للصفحة | استُعيد الجسم والمفتاح الأصليان حرفيًا؛ الاسترجاع أعاد البيع نفسه #8 |
| تعديل متأخر إلى4/أ بعد البيع | الإيصال الأصلي فقط؛ لا تغيير مالي أو مخزني |
| تفريغ الربط ثم بيع مستقل مماثل3/ب | بيع مستقل #9 مسموح؛ ليس تكرارًا للمسودة |

- بيع المصدر #8: `ORD-1793804151938-154bab5c`، فاتورة `PINV-2026-00004`، العميل ب4، ثلاث وحدات، 300 ريال، ضريبة0 وفق اقتباس المنشأة غير المسجلة. فاتورة واحدة ودفعة نقدية واحدة وصرف مخزني واحد3 وحدات؛ المخزون12→9.
- البيع المستقل #9: `ORD-1793804627585-7e39752e`، فاتورة `PINV-2026-00005`، ثلاث وحدات/ب4/300 ريال؛ المخزون9→6.
- إجمالي الإضافتين المقصودتين: نقد +600، ذمم صافية0، تكلفة مبيعات +300، مخزون بالقيمة −300؛ ستة قيود جديدة متوازنة. التكلفة50 ثابتة والقيمة الدفترية600→300، والطبقات لم تتغير في طريقة المتوسط.
- لا فاتورة **جديدة** للعميل أ؛ فاتورة إعادة الإنتاج السابقة محفوظة. الوردية الأخرى والشركة2 الضابطة والوثائق السابقة لم تتغير.
- 38 تحقق مصالحة مستقلة ناجحًا، بقراءات فقط وقيم SQL عشرية نصية. لا تضاف إلى أعداد API/UI.

## نتائج التشغيل الفعلية

`pnpm run verify`: بدأ `2026-11-04T14:40:36.804Z` وانتهى `14:59:26.073Z`، رمز خروج0، بصمة وشيفرة البداية والنهاية متطابقتان والشجرة نظيفة.

| الفحص | النتيجة الجديدة |
|---|---|
| بوابات المشروع، ومنها الأنواع والتدقيق والبناء وثبات المصدر | 15/15، بلا بوابة فاشلة |
| API | 1278 ناجحًا، 0 فاشل، 1 متجاوز ضمن 1279 |
| UI | 490 ناجحًا، 0 فاشل |
| الترقية المستقلة | ناجحة؛ اختبار الترقية المنفصل مختار بمرشح، ولا تُجمع الحالات المرشحة معه كنجاحات |
| الاختبارات الموجهة | 7 API و51 UI ناجحة، **مدرجة** في أعداد التشغيل الشامل، وليست مضافة إليها |
| الحواجز الفعلية في PostgreSQL | حفظ أولًا ⇒ رفض الدفع القديم؛ دفع أولًا ⇒ نتيجة أصلية للتعديل المتأخر؛ النتيجة المالية لا تتضاعف |

التجاوز الوحيد في API هو اختبار ترقية دورة المرتجع الأصلية داخل Vitest؛ مسار الترقية المستقل شُغّل فعليًا ونجح. تبقى سجلات كل تشغيل منفصلة. صححت مراجعة أداة المصالحة الأولى هوية صفوف `financial_requests` المركبة بدل `id` غير الموجود؛ لم يتغير التطبيق ولم يُضعف أي شرط. تحفظ الحزمة التشخيص ونتيجة المصالحة النهائية.

## الأدلة والحدود

الجذر: `generated-artifacts/pos-resumed-revisions/`. أهم الملفات: `verification-run.json`، `verify.log`، `verification-final/`، لقطات مراحل `after-*.json`، `independent-before/final.json`، `independent-assertions.json`، وصور المتصفح. الحزمة المنقحة `Hasiba-Resumed-Basket-Revisions-Evidence.zip` متاحة ببطاقة تنزيل؛ نواتج التوليد مستثناة من Git وليست ملفات مرفوعة إليه.

ملحق `after-early-browser-supplement.json` يحفظ ترتيب التأكيد200 ثم الدفع القديم409 ثم عرض النسخة الأحدث200 وصور المراحل. لم تُحفظ البصمة الكاملة أو الجسم الخام لطلب الدفع القديم؛ الموجود بادئة بصمته وسجل الحدث وصورة الرفض ولقطة SQL. لا نعرض هذا كالتقاط خام كامل. أما طلب الدفع الصحيح المفقود الرد فقد طوبق جسمه ومفتاحه كاملين قبل الاسترجاع، مع نشر بصمتيهما فقط.

إسقاط الرد مُحاكاة متعمدة **بعد** تثبيت 201 حقيقي، وليس عطل شبكة ماديًا. السباق أُثبت بحواجز PostgreSQL في اختبارات API؛ الرحلة الأصلية أثبتت ترتيب التبويبين القديم أولًا والاسترجاع الفعلي بعد إعادة التحميل. لم تُختبر أجهزة أو بطاقات أو إنتاج أو طباعة ورقية أو جهات ضريبية. يبقى `TAX_POLICY_NOT_READY` دون تجاوز عام.

---

## English delivery

**Closed within this task's scope.** Server-confirmed revisions now fence both resumed-basket edits and checkout under the existing source lock. Stale revisions and stale contents are rejected, including a forged latest version with old contents. An explicit refresh/review never automatically charges. Local durability is labelled separately from server acknowledgement. Original resume identity, source shift, immutable pending payment body/key and single final sale are preserved.

Tested/pushed code: `9ebb23e7c70e70240031fc04c9c9e8fef14ea883`; executable SHA-256 `62663fd9ebb54f9f5e65f6efe3cd57b3bbf94763b6c15da03e7fa27eb0c52b11`. Native browser/API and final gates used this clean source. Subsequent delivery commits contain documentation only.

The old native flow demonstrably accepted two units/customer A after another tab locally changed to three/B. Its whole-source attribution is qualified because HMR/worktree changes occurred during that before run; it is not labelled a clean full-build acceptance of `179b477`.

The new native flow confirmed three/B as revision1, then submitted the **old tab first** with zero new financial/stock effects. The cashier safely sealed that original rejected attempt, explicitly reviewed the newer basket and paid. A genuine committed201 response was dropped; real reload and recovery replayed the exact original body/key and returned source sale8, invoice `PINV-2026-00004`, 3/B/300. One invoice, one tender and one three-unit issue; stock12→9. A late edit returned its original receipt without mutating the invoice. An intentionally independent identical sale9/invoice `PINV-2026-00005` remained possible, stock9→6.

Independent exact-decimal read-only reconciliation passed38 checks: combined cash+600, AR0, COGS+300, inventory−300; six new balanced journals, unchanged unit cost50 and average-cost layers. No new A invoice; deliberately reproduced historical A sale and other-company/shift controls preserved.

Fresh full verification ran **14:40:36.804–14:59:26.073UTC on2026-11-04**, exit0: **15/15 gates,1278 API passed/1 intentionally skipped,490 UI passed**, independent upgrade passed. Targeted7API/51UI are subsets, not additional totals. Real PostgreSQL barriers cover save-first and sale-first orderings. Initial evidence-checker composite-key handling was corrected without changing the application or weakening assertions.

The sanitized ZIP includes new logs, source metadata, browser/SQL evidence, screenshots and a checksum manifest; private access/pending records are excluded and proof/token values hashed. Dropped-response testing is simulated after real commit; physical devices, real tenders, production and tax-provider acceptance are not claimed. No main changes, deployment, accounting-engine rebuild or additional feature scope.

The early-browser supplement retains observed acknowledgement200 → stale checkout409 → explicit refresh200, screenshots and unchanged-financial-state SQL. The full stale-request hash/raw body was not retained; only its hash prefix and event evidence remain. This limitation is not presented as a full raw capture. The genuine lost-response payment's full body/key were privately compared exactly across reload/replay, with only hashes published.
