# استكمال العمل بعد إقفال وردية سلة مسترجعة / Closed-shift resumed-edit recovery

## العربية

### النطاق والنسخة

مهمة واحدة مبنية على `941724e`، على `sync/hasiba-erp-20261023` في
`Abdullah-Almutairi12/Hasiba`. لا تعديل لـ`main`، ولا نشر أو دفع حقيقي.

- الشيفرة المختبرة والمرفوعة: [`7b387a08b547af42d7c58d1b9c5a629ca06aa3ef`](https://github.com/Abdullah-Almutairi12/Hasiba/commit/7b387a08b547af42d7c58d1b9c5a629ca06aa3ef).
- بصمة التنفيذ: `4010464616c1c7c02cdc79428b5dfdd56b3f0a30695602c7158e2be1ca41daef`.
- الخادم المعزول أُعيد تشغيله من هذه الشيفرة؛ الواجهة أُعيد تشغيلها بعد مجموعة التعديلات. لا تغييرات تنفيذية لاحقة لنجاح البوابات؛ تعديلات التسليم توثيقية.
- PostgreSQL اصطناعية معزولة، شركتا الاختبار 4 و2؛ لا كتابة على بيانات العملاء. لم يُتجاوز `TAX_POLICY_NOT_READY`.

### العيب والإصلاح

التحقق السابق أعاد إرسال طلب حفظ التعديل نفسه. إذا أُغلقت الوردية قبل الحفظ، بقي رفض التنفيذ ومحاولته المحفوظة يمنعان تحرير السلة.

أُعيد استخدام `financialTransaction` و`closeSaleIntent` وإيصالات المحاولات الدائمة، دون جدول أو ترحيل أو محرك جديد:

1. أول تأكيد يرسل طلب الحفظ المحفوظ. التحقق اللاحق يرسل مفتاحه وجسمه الأصليين إلى مسار حسم مستقل، وليس تنفيذًا جديدًا.
2. الحسم يأخذ قفل المحاولة الأصلية نفسه: يعيد النتيجة المحفوظة، أو يسجل إغلاقًا دائمًا بلا تنفيذ. الطلب القديم المتأخر لا يستطيع تجاوز الإغلاق.
3. يستمر تحقق القراءة ونطاق المصدر والجهاز والمسؤولية بعد انتظار الأقفال. رفض الوصول أو HTTP409 أو انقطاع الشبكة لا يمسح الدليل.
4. يظهر زر «إنهاء المتابعة وبدء سلة جديدة» بعد نتيجة مؤكدة فقط، مع منع استعماله أثناء محاولة حفظ/دفع معلقة. يزيل الربط المحلي ويبدأ سلة فارغة بلا عميل، ولا ينقل المسودة إلى وردية أخرى أو يعيد فتح المغلقة.
5. نتيجة متأخرة لا تستبدل سلة أحدث. بقيت حماية النسخة المؤكدة ومنع البيع النهائي المكرر كما هي. الدليل الأصلي والمراجعات ونتائجها باقية على الخادم.

### ما شُغّل فعليًا

تشغيل شامل واحد نهائي، لا إعادة تشغيل تلقائية بعد نجاحه:

| الفحص | النتيجة الجديدة |
|---|---|
| `pnpm run verify` | 15/15؛ رمز خروج 0 |
| البداية UTC | 2026-11-04 16:33:12.634 |
| النهاية UTC | 2026-11-04 16:54:41.430 |
| الخادم | 1282 ناجحًا، 0 فشل، 1 متجاوز؛ 102 ملف |
| الواجهة | 493 ناجحًا، 0 فشل؛ 76 ملف |
| الأنواع والبناء والتدقيق | ناجحة ضمن البوابات |
| الترقية المستقلة | ناجحة؛ اختبار واحد مستهدف و38 حالة مستبعدة بمرشح هذه البوابة |
| PostgreSQL الموجه | 7/7؛ جزء من إجمالي الخادم، وليس إضافة إليه |
| المصالحة المستقلة | 19/19؛ ليست اختبارات إضافية تُجمع مع API/UI |

الاختبار المتجاوز في الخادم هو اختبار الترقية التاريخية المشروط الذي يُشغّل في بوابة الترقية المستقلة؛ لم يُحتسب نجاحًا ضمن API.

الاختبارات الدائمة تغطي الحفظ قبل الإقفال والإقفال قبله، إعادة الحسم، وصول الأصل متأخرًا، وحاجزي PostgreSQL الحقيقيين بترتيبي الحفظ والحسم. وتغطي الواجهة بقاء المحاولة عند 409/403 وانقطاع الشبكة، والتحديث، وعدم مسح سلة أحدث، والحجب حتى الحسم، ثم سلة مستقلة بلا عميل.

اختبار تشخيصي شغّل دالة الواجهة الفعلية من `941724e` في الذاكرة: فشل توقع تحرير المحاولة لأن الدالة أعادت إرسال الحفظ المرفوض؛ نفس الاختبار نجح على `7b387a0`. هذا اختبار hook بمحاكاة النقل، وليس رحلة PostgreSQL قديمة كاملة. احتُفظ بخطأَي إعداد ذلك الاختبار منفصلين؛ لم يُحسبا عيبَي تطبيق.

### الواجهة وقاعدة البيانات

| الترتيب | الدليل |
|---|---|
| الإقفال قبل الحفظ | المسودة10/الوردية2: حفظ409، ثم حسم200 `closed_without_execution`. أُسقط الرد الحقيقي عمدًا؛ بعد تحديث الصفحة عاد الحسم بالمفتاح والجسم نفسيهما. الزر بدأ سلة فارغة على الوردية3؛ الأصل المتأخر409 بلا أثر. |
| الحفظ قبل الإقفال | المسودة13/الوردية4: حفظ200 للنسخة1، قطعتان/العميل4؛ أُسقط الرد. بعد إغلاق4 وفتح5 أعاد الحسم النسخة المحفوظة نفسها ثم أُنهِيت المتابعة. حدود سياق المتصفح موضحة أدناه. |
| استكمال دليل التحديث في التبويب نفسه | المسودة15/الوردية5: حفظ200 للنسخة1 ثم فقد الرد، وتحديثان حقيقيان في السياق نفسه مع بقاء بصمتي المفتاح والجسم كما هما. أُغلقت5 وفُتحت6؛ الحسم أعاد قطعتين/العميل4، ثم أُنهِيت المتابعة بسلة فارغة. SQL في `after17` يثبت صفر أثر مالي إضافي. |
| البيع المستقل الأول | البيع11، الوردية3، نقد100، قطعة واحدة، بلا عميل مسجل في الطلب. فقد رد201 ثم استُرجع البيع نفسه بالمفتاح والجسم الأصليين. |
| البيع المستقل الثاني | البيع14، الوردية5 الجديدة، نقد100، قطعة واحدة، طلب بلا عميل ولا ربط بالمسودة. إيصال `ORD-1793813455638-4a6bc85c`. |

المصالحة المنفصلة، بقراءات SQL للمنشأة نفسها وحسابات عشرية صحيحة:

- قبل الرحلة: 5 فواتير و5 دفعات، مخزون6 بتكلفة50، و16 قيدًا.
- بعد البيعين المقصودين: 7 فواتير و7 دفعات، مخزون4 وقيمة200، و22 قيدًا/44 سطرًا، مدين=دائن=5000.
- الفرق: نقد+200، ذمم بصافي0، تكلفة مبيعات+100، مخزون−100. كل بيع مستقل أصدر فاتورة ودفعة وحركة صرف واحدة، وثلاثة قيود متوازنة.
- الحفظ والحسم وإنهاء المتابعة: صفر فواتير أو دفعات أو حركات أو قيود. لا بيع على ورديتي المصدر2 أو4 بسبب التعافي؛ كل بيع جديد على ورديته الصحيحة.
- فواتير البيع النقدي تربط بعميل النقد النظامي5، لا بعميل المسودة أ/ب. `customer_id` في طلبي POS المستقلين فارغ.
- طبقات طريقة المتوسط لم تتغير؛ بيانات الشركة الأخرى والسجلات المالية السابقة بقيت كما كانت.

### حدود الأدلة والتعثرات

- محاولة BEFORE الأصلية جزئية: دخل الكاشير وعلّق واسترجع مسودة، لكن تغييرات HMR/مراجع أتمتة قديمة منعت توثيق سلسلة الرفض كاملة على واجهة قديمة مثبتة. لا تُعرض بوصفها قبولًا كاملًا قبل الإصلاح. إثبات الفشل السابق المستقل هو اختبار الدالة الفعلية المذكور أعلاه.
- إغلاق الوردية2 استُخدم له مساعد API مصرح على البيانات الاصطناعية بعد تعذر العثور على الإجراء في POS؛ إغلاق3 و4 وفتح4 و5 استُخدمت لها الواجهات الأصلية.
- انقطع سياق أتمتة المسودة12؛ حُفظ دليله ولم تُختلق سلتها أو تُحذف سجلاتها. اختُبرت بدلًا منها مسودة13 مصطنعة. فقد سياق المتصفح أيضًا مفاتيحها المحلية؛ استُعيد طلبها من إيصال الخادم بعد مطابقة بصمتيه ثم أُعيد تحميل السياق المستعاد. لذلك لا تُنسب رحلة13 إلى بقاء السياق الأصلي بلا انقطاع.
- أُغلق نقص دليل التحديث الأصلي برحلة15 المنفصلة: استمر التبويب نفسه حتى حفظ النتيجة، والتحديثين، والحسم وإنهاء المتابعة؛ لم يُعد تركيب الطلب من الخادم. انقطعت الأتمتة بعد صورة السلة الفارغة وقراءة SQL، قبل فحص DOM إضافي لحقل العميل؛ لا يُدّعى تنفيذ هذا الفحص الإضافي. عدم نقل العميل مثبت في الرحلات السابقة والاختبار الدائم، وفي طلبي البيعين المستقلين.
- سُجل تجميع SQL تشخيصي خاطئ في `after14-sql-diagnostic-unscoped-aggregate.json`، لا دليل قبول؛ صححت الأدلة نطاق الشركة والجداول، وأُجريت مصالحة مستقلة ثانية. لم يكن ذلك عيب حسابات في التطبيق.
- إسقاط الرد محاكاة داخل تبويب الاختبار بعد تأكيد HTTP200/201 حقيقي، وليس ادعاء اختبار عطل شبكة مادي. لا اختبار أجهزة أو دفع بنكي/بطاقة أو قبول ضريبي إنتاجي.

### الملفات والأدلة

الملفات الأساسية: `close-sale-intent.ts`، `routes/pos.ts`، `pos.resumed-revisions.test.ts`، `use-pos-resumed-version.ts` واختباره، نوع `use-pos-resumed-basket.ts`، `pos-iconic.tsx` واختباره، وعقد OpenAPI وملفاته المولدة.

الأدلة المنقحة في حزمة التسليم: سجلات البوابات، مصدرها وتوقيتاتها، نتائج hook قبل/بعد، ملفات `after00` وما بعدها، صور الواجهة، وقراءات `independent-*` و`control-*` ومدقق المصالحة. الأصول المولدة مستثناة من Git وتُسلّم كملف ZIP فعلي؛ لا كلمات مرور أو ملفات وصول أو مفاتيح محاولات خام في الحزمة.

## English

### Scope and implementation

One bounded POS recovery fix, preserving delivery `941724e`. Tested and pushed code:
`7b387a08b547af42d7c58d1b9c5a629ca06aa3ef`, executable SHA-256
`4010464616c1c7c02cdc79428b5dfdd56b3f0a30695602c7158e2be1ca41daef`.
No main-branch change, production deployment, real payment, migration, or tax-gate override.

An uncertain edit previously retried execution forever after its source shift closed.
The existing permanent intent engine now reconciles the exact saved key/body under
its original transaction lock: recover its committed result, or durably seal
nonexecution. A delayed original save cannot execute after sealing. Current
source/device/responsibility read authorization remains mandatory. HTTP denial
or a lost response alone never clears evidence.

Only a confirmed outcome enables explicit “end continuation and start a new
basket”. It clears working items/customer, without moving the old source to the
new shift. Pending payment/save evidence and newer baskets remain protected.
The original immutable claim, confirmed revisions, stale-version checkout fence,
and one-final-sale invariant are preserved.

### Fresh verification

One final full run: **15/15 gates, exit0**, UTC **2026-11-04
16:33:12.634–16:54:41.430**. API **1282 passed, 1 skipped, 0 failed**;
UI **493 passed, 0 failed**. Types, builds, audit and independent historical
upgrade passed. The upgrade gate selects one test and filters38; it is not39
additional successes. The seven targeted PostgreSQL tests are included in the
API total. Independent exact-decimal reconciliation passed19 checks separately.
No older acceptance is relabeled as this run and no further full run followed success.

Real PostgreSQL barriers exercise both edit/resolve arrival orders. Persistent
tests also cover closed-shift settlement, delayed original writes, reload,
denials/unknown outcomes, newer-basket preservation and explicit empty-cart release.
An isolated hook regression executing the actual accepted old function fails;
the same assertion passes on final code.

### Native journey and reconciliation

Draft10/source shift2 demonstrated rejection, lost real resolver reply, same-tab
reload/recovery, safe closure, empty-cart continuation and rejected late save.
Draft13/source shift4 demonstrated a genuinely committed version1 (quantity2,
customer4), dropped reply, closed-source result recovery and continuation on fresh
shift5, subject to the browser-context caveat above.

Two intentional independent native cash sales were made: order11/shift3 and
order14/shift5, each one unit for100. Order11's genuine201 reply was dropped and
the identical original request recovered the same receipt after reload. Order14
was paid once normally. POS requests had no selected customer; invoices use the
configured cash customer5, never draft customer3/4.

Company4 changed only by those intended financial sales: invoices/payments5→7,
stock6→4 at cost50, carrying value300→200, journals16→22. Delta:
cash+200, AR net0, COGS+100, inventory−100; all new journals balanced.
Save/resolve/end added no financial or inventory effects. Existing financial
records and company2 controls remained unchanged.

### Evidence limits

The native BEFORE attempt was partial and not attributable to a clean old frontend;
its failure proof is the separately executed old-hook regression, not a claimed
complete old-browser journey. Source shift2 was closed through an authorized
isolated API helper; subsequent closes/opens used original screens.

The automation context holding draft12 was lost and preserved as a limitation.
Replacement13's original context also expired: recovery used the matching server
receipt after verifying previously captured key/body hashes, then a real reload
of the recovered context. This is not claimed as uninterrupted original-tab
survival. A separate fresh draft15 subsequently completed the missing same-tab
proof: genuine200 save followed by dropped reply, two actual reloads with identical
stored key/body hashes, native closure of shift5/opening6, recovery of the original
version1 quantity2/customer4, and explicit empty-cart release. Its SQL snapshot
matches the preceding financial baseline exactly. The automation reset only after
that screenshot and SQL capture, before an extra final customer DOM assertion;
that extra assertion is not claimed. Customer separation is independently proved
by the earlier native sales and permanent component test.

A diagnostic unscoped SQL aggregate is retained but excluded from
acceptance; corrected tenant-scoped snapshots and independent reconciliation are
authoritative. Response loss is a test-tab simulation after genuine server success,
not physical network/device/production acceptance.

The downloadable sanitized evidence archive contains raw run logs, provenance,
browser stage records/screenshots, before/after hook results, SQL snapshots and
the standalone reconciliation checker. Generated evidence is intentionally not
in Git; private access files and raw intent secrets are excluded.
