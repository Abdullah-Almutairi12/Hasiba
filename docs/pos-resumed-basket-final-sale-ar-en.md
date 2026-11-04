# ربط السلة المسترجعة بورديتها ومنع تحصيلها مرتين

## نتيجة التسليم — 4 نوفمبر 2026

**نجح النطاق المطلوب.** بُني على التسليم `92a9325` دون إعادة بناء الاستئناف، وبقيت تجربة السوبرماركت V2 محفوظة. لا تغيير لـ`main` أو الإنتاج أو وسائل دفع حقيقية.

- المستودع: `Abdullah-Almutairi12/Hasiba`.
- الفرع: `sync/hasiba-erp-20261023`.
- [الشيفرة المختبرة](https://github.com/Abdullah-Almutairi12/Hasiba/commit/db480412298f3697bb2dfc4b30e4f652fbd1a0ad): `db480412298f3697bb2dfc4b30e4f652fbd1a0ad`.
- بصمة التنفيذ: `fda067d28826c37db47afad13f5bf38b5829503fc61d0882e27339f80b679362`.
- مصدر خادم المتصفح يطابق مصدر الاختبارات والبصمة؛ أُعيد تشغيل خادم الاختبار المعزول وواجهة ERP بعد تثبيت الشيفرة. التعديلات اللاحقة لهذا المصدر توثيقية فقط.

## ما ثبت قبل الإصلاح

1. من الواجهة الأصلية، استئناف مسودة من الوردية 35 بعد اختيار 36 ملأ سلة الوردية الأخرى. لم يُنفّذ بيع في هذه الحالة.
2. استرجاع المسودة 20 في تبويبين **بمفتاح الاسترجاع والجسم نفسيهما**، ثم الدفع بمفتاحين مختلفين، أنتج البيعَين 21 و22 وفاتورتين ودفعتين وحركتي صرف. انخفض المخزون من 18 إلى 16. هذه سجلات اختبار اصطناعية سابقة للإصلاح ولم تُحذف لإخفاء النتيجة.
3. اختبارات الانحدار عند إضافتها أخفقت قبل الإصلاح: حالتا خادم (قبول الوردية الخطأ وبيعان للمصدر نفسه)، وحالة واجهة (وضع السلة في الوردية الأخرى). سجلات الإخفاق محفوظة منفصلة عن التشغيل النهائي.

## ما تغير

- تحفظ الواجهة هوية المسودة ووردية المصدر ومفتاح الاسترجاع مع سلتها قبل إنهاء تأكيد الاسترجاع، وتستعيد الربط بعد إعادة التحميل.
- تغير الوردية يحجب تحصيل السلة المرتبطة؛ الاسترجاع المتأخر لا يستبدل سلة أحدث. يوجد توضيح عربي واستعلام عن النتيجة السابقة لا يفتح وردية ولا يمسح السلة.
- ترسل عملية البيع `resumedDraft: {id, sessionId, requestId}`. يتحقق الخادم من دليل الاسترجاع وصاحبه والشركة والفرع والوردية والجهاز وفق الخدمات القائمة، ويعيد فحص السلطة بعد انتظار قفل المصدر.
- قفل مستقل بهوية **المسودة** ونتيجة دائمة داخل معاملة البيع يمنعان بيعها مرة ثانية ولو اختلف مفتاح الدفع. نتيجة البيع المحفوظة تُعاد للمخول دون تكرار الأثر أو إعادة تشغيل آثار ما بعد البيع.
- السلة المستقلة المماثلة تبقى بيعًا مشروعًا؛ لا إزالة تكرار على أساس الأصناف أو المبالغ.
- لا جداول أو ترحيلات جديدة؛ استُخدمت معاملات المحاولات والتخزين والتدقيق والمحاسبة القائمة.

### الملفات الأساسية

`artifacts/api-server/src/lib/pos-resumed-sale.ts`، `src/routes/pos.ts`، تصدير دوال اللقطات القائمة في `src/lib/financial-transaction.ts`، `artifacts/erp-system/src/hooks/use-pos-resumed-basket.ts`، `src/pages/pos-iconic.tsx`، واختبارات `pos.resumed-sale.test.ts` و`pos-iconic.test.tsx`. حُدّث عقد OpenAPI وولّدت منه ملفات العميل والتحقق.

## نتائج التشغيل الجديدة على المصدر النهائي

التشغيل الواحد `pnpm run verify` بدأ **11:36:16.074 UTC** وانتهى **11:55:48.847 UTC**، أي **14:36:16–14:55:48 بتوقيت الرياض**. رمز الخروج **0**؛ المصدر والبصمة ثابتان والشجرة نظيفة عند بداية التشغيل ونهايته.

| الفحص | النتيجة الجديدة |
|---|---|
| بوابات المشروع، بما فيها الأنواع والبناء وتدقيق الاعتماديات وثبات المصدر | 15/15؛ صفر فشل |
| الخادم، PostgreSQL معزولة | 1275 ناجحًا، صفر فشل، حالة واحدة متجاوزة |
| الواجهة الآلية | 481 ناجحًا؛ صفر فشل أو تجاوز |
| الترقية المستقلة | اختبار الترقية ناجح؛ 38 حالة أخرى مستبعدة بمرشح هذا التشغيل |
| المصالحة المستقلة بعد رحلة المتصفح | 42 تحققًا ناجحًا؛ صفر فشل |

الحالة المتجاوزة في تشغيل الخادم هي اختبار الترقية نفسه لأنه يحتاج مرجعه المثبت؛ **شُغّل ونجح في بوابته المستقلة**. لا تُضاف أعداد الفحوص الموجهة أو المصالحة إلى إجمالي API/UI. هذه نتائج جديدة، وليست إعادة استعمال لقبول `92a9325`.

## ما أثبتته الواجهة الأصلية وقاعدة البيانات

| الحالة | الواجهة | القراءة المستقلة |
|---|---|---|
| استرجاع المسودة 23، مصدرها 36، بعد اختيار 35 | لم تدخل سلة قابلة للتحصيل؛ صفر طلبات بيع. بقيت المحاولة الأصلية وسلة أحدث بكمية 2 دون استبدال، والاستعلام أوضح عدم وجود بيع نهائي | لا تغير في الفواتير أو الدفعات أو المخزون أو القيود؛ الوردية 35 لم تتأثر ماليًا |
| المسودة 24، العميل 7، الوردية 36، تبويبان بمفتاح استرجاع واحد ومفتاحَي دفع مختلفين عبر حاجز إرسال | استجابتا 201 بالبيع **25 نفسه**؛ الثانية `alreadyFinalized:true` ورسالة عدم تحصيل مبلغ جديد | نتيجة نهائية واحدة للمسودة 24؛ فاتورة **10 / PINV-2026-00009**، دفعة **9**، حركة صرف **25** لكمية 1، وثلاثة قيود متوازنة |
| فقد رد البيع بعد تثبيت 201 ثم إعادة التحميل والاسترجاع | عرض الإيصال الأصلي **ORD-1793793286782-4fc99749** والبيع 25 دون إعادة تحصيل | بقيت الأعداد نفسها؛ لا فاتورة أو دفعة أو حركة أخرى |
| بيع مستقل مماثل للعميل الآخر 8، الوردية 36 | طلب جديد بلا `resumedDraft`؛ بيع **26** بقيمة 100 | فاتورة **11 / PINV-2026-00010**، دفعة مستقلة وحركة **26** واحدة، وثلاثة قيود متوازنة |

خط الأساس بعد اختبارات الإخفاق كان مخزونًا 16. بيع المسودة 24 جعله 15، والبيع المستقل جعله **14**، بمتوسط تكلفة ثابت **50**. الزيادة الفعلية للنقد **200**، ونقص قيمة المخزون **100**، وتكلفة المبيعات **100**، وصافي الذمم صفر. طبقات التكلفة لم تتغير؛ هذا الصنف في رحلة المتصفح متوسط تكلفة، وليس تجربة FIFO جديدة. بقيت جميع الأقسام المالية والمخزنية المقارنة لشركة V2 دون تغيير، ومخزونها **8 وحدات**.

اختبارات PostgreSQL الدائمة تثبت أيضًا رفض المصدر المزور والوصول من شركة/فرع آخر، وقراءة نتيجة البيع بعد إغلاق وردية المصدر دون إعادة فتحها، ورفض تحصيلها على وردية بديلة.

## حدود الدليل والتشغيل

- انقطاع الشبكة وفقد الرد وحاجز التزامن **حقن اختبار في المتصفح** حول طلبات حقيقية إلى الخادم وPostgreSQL؛ ليست تجربة شبكة مادية أو جهاز دفع.
- سُحب حكم فحص مرحلي خاطئ زعم غياب هوية المصدر لأنه قرأ أسماء حقول عليا غير موجودة في العقد بدل الكائن المتداخل. الأدلة تدعم الربط من حالة المتصفح وبصمة مفتاح المصدر ونتيجة قفل الخادم وإيصال المصدر في القاعدة. الجسم الخام الكامل لطلبَي السباق لم يُحتفظ به، فلا ندّعي مراجعته حقلًا حقلًا. سُجل التصحيح دون تعديل التطبيق لهذا السبب.
- إغلاق وردية المصدر واختبارات العزل السلبية ثبتت باختبارات API/PG، لا بادعاء رحلة إغلاق جديدة من المتصفح.
- المسودة 23 تبقى استرجاعًا غير مباع مربوطًا بورديته؛ لا إكمال أو إلغاء مصطنع له. لا تُفتح وردية مغلقة لمعالجة الاسترجاع.
- إعادة تعليق سلة مسترجعة مرتبطة محجوبة برسالة واضحة، حتى لا تنشأ نسخة تفقد هوية المصدر؛ تعليق السلال العادية وإصلاح اسمها السابق محفوظان.
- `TAX_POLICY_NOT_READY` والحجب الآمن القائم لم يتغيرا. لا ادعاء اكتمال ERP أو قبول ضريبي إنتاجي أو اختبار دفع/طابعة فعلية.

الأدلة المنقحة في `generated-artifacts/pos-resume-sale/`: `verification-run.json`، `verification-final/`، سجلات الإخفاق قبل الإصلاح، نتائج المتصفح وتصحيح حكم الفحص، صور الرحلة، لقطات القراءة المستقلة و`independent-assertions.json`. تُسلّم في ZIP لأن هذا المجلد مستثنى من Git؛ التقرير والشيفرة في المستودع.

---

# Resumed POS basket: source-shift binding and one final sale

**Accepted within this task's scope.** The implementation preserves delivery `92a9325`; tested source is `db480412298f3697bb2dfc4b30e4f652fbd1a0ad`, execution fingerprint `fda067d28826c37db47afad13f5bf38b5829503fc61d0882e27339f80b679362`. Browser/API and automated tests used the same executable source. Subsequent delivery changes are documentation only.

Before the fix, native recovery injected a source-shift basket into another selected shift. Two tabs recovering the **same resume key/body** then paid with different checkout keys and produced orders21/22 and duplicate financial/stock effects. Two API regression cases and one UI regression failed before the fix; their logs are retained.

The existing attempt engine now retains draft/source-shift identity through reload and checkout. A server-side source lock and permanent final outcome are committed atomically with the existing sale. Replays return the original sale under current source-read authority. Source authorization is rechecked after lock waits. Independent identical baskets remain valid; there is no content-based sale deduplication. No migration or parallel financial engine was introduced.

## Fresh final-source verification

One full run: **2026-11-04 11:36:16.074–11:55:48.847 UTC**, exit **0**. **15/15 gates**, **1275 API passed / 0 failed / 1 skipped**, **481 UI passed / 0 failed / 0 skipped**, independent pinned upgrade passed. The API skip is that upgrade case, executed separately; the upgrade-only run filters out38 unrelated cases. Independent reconciliation: **42 passed**. Subset counts are not added to API/UI totals.

Native acceptance recovered draft24/session36/customer7 in two tabs sharing one resume key. Distinct checkout keys raced; both returned order25, the second already finalized. Dropping the successful response after commit and reloading recovered that same order. PostgreSQL independently proves one invoice10, one tender9, one stock issue25 and balanced journals. An intentional independent identical sale to customer8 created order26/invoice11/issue26 once.

Stock16→15→14, unchanged unit cost50; new cash200, inventory reduction100, COGS100, net AR0. Wrong shift35 totals remained unchanged. V2 company's compared financial/inventory records were unchanged and its stock remains8. The later session35 quantity2 basket and unsold draft23 claim were preserved.

Limits: response loss and concurrency were injected browser faults against real isolated PostgreSQL, not physical network/payment devices. A temporary test verdict incorrectly projected nonexistent top-level metadata fields; it was withdrawn after checking the nested contract, source state/key hashes and durable server outcome. Full canonical raw race bodies were not retained, so field-by-field wire inspection is not claimed. Closed-shift outcome recovery and negative tenant/branch checks are API/PG evidence, not a new native shift-closing journey. Re-parking a source-bound recovered basket is explicitly blocked rather than dropping its binding. Ordinary parking remains covered by the passing suite.

No production deployment, main-branch change, real payment, or tax-gate activation. No assertion that the entire ERP is error-free. The sanitized evidence ZIP contains new gate logs, before/after evidence, screenshots, browser verdict correction and independent snapshots/assertions.
