# حاسبة — إغلاق إصلاح اسم تعليق السلة والمحاولات القديمة

## العربية

**اكتملت المهمة ضمن نطاقها المثبت.** حُفظ تسليم `e68c8c3` على
`Abdullah-Almutairi12/Hasiba`، فرع `sync/hasiba-erp-20261023`.
لم يُعدّل `main` ولم يحدث نشر أو دفع خارجي أو تغيير للحجب الضريبي.

### المنفذ والمثبت

- الاسم اختياري؛ الفارغ وحتى 60 حرفًا مقبولان وفق قص الفراغات الطرفية نفسه في الخادم. الاسم الأطول يُرفض قبل حفظ محاولة أو إرسالها، برسالة عربية بجانب الحقل، دون قصه ودون فقد السلة أو العميل.
- المحاولة القديمة تُفحص تحت قفلها وبصمتها الأصليين باستخدام محرك المحاولات القائم: استرجاع المسودة المحفوظة، أو إغلاق دائم دون تنفيذ يمنع الطلب المتأخر، أو الاحتفاظ بالمحاولة إذا تعذر إثبات النتيجة. لا اعتماد على HTTP وحده.
- بعد الإغلاق المؤكد تعود السلة والعميل والاسم الأصلي إلى التحرير؛ التصحيح يستخدم معرفًا جديدًا. عولج عيب إضافي أثبته المتصفح: تصفير السلة عند تهيئة الهوية كان قد يطغى على استعادة اللقطة. ثبت فشله باختبار دائم ثم نجاح الإصلاح.
- الرحلة الأصلية أثبتت: 61 حرفًا = **صفر طلبات تعليق**؛ تصحيح إلى 60 ونقر مزدوج = **طلب واحد ومسودة 10 واحدة للعميل 7**؛ فقد الرد بعد حفظ 201 فعلي ثم تحديث واسترجاع المفتاح والجسم نفسيهما = **المسودة 10 نفسها**. استئنافها أعاد العميل والصنف، والزبون التالي كان بلا عميل مسجل.
- المصالحة المستقلة: **41 ناجحًا، صفر فشل**. بقيت الشركة الاصطناعية 13 عند مخزون 18×50=900، وفاتورتين ودفعتين و3 حركات و7 قيود كما كانت؛ **لا أثر مالي إضافي للتعليق أو التصحيح**. المسودة واحدة قبل الاستئناف وصفر بعده مع بقاء إيصالها. مقارنة شركة السوبرماركت V2 رقم 11 لم تتغير.
- اختبارات PostgreSQL تثبت ترتيبي سباق التنفيذ والإغلاق بقفل فعلي، ومنع إعادة استخدام المعرف بجسم مختلف ومنع تنفيذ طلب صالح متأخر بعد إغلاقه. لم يُبنَ محرك موازٍ أو ترحيل مخطط أو تبعية جديدة.

### المصدر والفحوص الجديدة

- المصدر المختبر والخادم والمتصفح: `f54af6b695800e5200b023d309d38ccaa1cbaf52`.
- SHA-256: `840ff3a1fe489e3cf659880454d4452cd67b7fa0f531436f754b28a4e6a90a6a`.
- `pnpm run verify`: **15/15**، رمز خروج **0**.
- بدأ `2026-11-04T08:45:44.158Z` وانتهى `2026-11-04T09:04:15.449Z`؛ 11:45:44–12:04:15 بتوقيت الرياض.
- API: **1263 ناجحًا / 0 فشل / 1 متجاوز**؛ UI: **464 ناجحًا / 0 فشل**.
- الأنواع والبناء والترقية المستقلة وتدقيق الاعتماديات وثبات المصدر: ناجحة. الحالة المتجاوزة اختبار ترقية مشروط شُغّل بنجاح في بوابة الترقية المنفصلة، لا حذف اختبار.
- الشجرة نظيفة والبصمة نفسها قبل التشغيل وبعده. التشغيلان المبدئيان الموقوفان محفوظان بأسبابهما ولا يحتسبان قبولًا. الاختبارات الموجهة مجموعات فرعية لا تضاف إلى الإجمالي.

### الملفات والأدلة والحدود

تغيرت `pos.ts` و`pos.park-resume.test.ts`، وامتد نوع المسار المسموح في `close-sale-intent.ts`،
و`use-pos-parking.ts` واختباره، و`pos-iconic.tsx` واختباره.
الأدلة الجديدة في `generated-artifacts/pos-park-name/`، وفي الحزمة المسلمة عبر قناة الملفات:
`verification-run.json`، `verification-final/`، سجلات الفشل قبل الإصلاح،
`independent-*.json`، تقرير المتصفح ولقطات SQL ومراجع الصور.
الأدلة المولدة مستثناة من Git عمدًا؛ التقرير هنا محفوظ في المستودع.

في إعادة اختبار المحاولة القديمة بقي مفتاحها وجسمها حرفيًا، لكن بيانات العرض المفقودة
`meta.cart/meta.customer` أُعيد بناؤها من بيانات الشركة الاصطناعية؛ ليست ادعاء حفظ بايتاتها القديمة.
فُقد رد التعليق فعليًا بعد حفظ الخادم؛ فقد رد resolver نفسه مغطى باختبار دائم لا حقن مستقل
في المتصفح. استعلم الفحص المستقل عن `stock_layers` الفعلي وأثبت صفر طبقات قبل/بعد؛
لا تُستخدم نتيجة بحث أسماء الجداول غير الشامل في تقرير المتصفح كدليل غياب الجدول.
صور المتصفح مراجع منصة لا ملفات JPEG داخل ZIP. لا تتضمن الحزمة بيانات الدخول أو الملفات الخاصة.
لا عيب مثبت متبقٍ يمنع قبول هذا النطاق؛ لا يُعد هذا ضمانًا لخلو ERP كله من الأخطاء.

## English

**Accepted within this task only.** The baseline, repository and branch were preserved; no
main/production/external-payment/tax-gate changes occurred. Optional/60-character labels
are accepted; 61 characters are rejected before storage/network with an inline Arabic error.
Legacy intents resolve through the existing original-key transaction fence: recover the
committed draft, permanently seal nonexecution, or retain uncertain evidence. Correction
restores the immutable basket/customer/name and uses a fresh key.

Native testing exposed and verified a fix for an identity-reset effect erasing a restored cart.
The final native flow proved zero sends for 61 characters, one request/draft 10 for double
clicks at 60, actual response loss after committed HTTP 201, exact same-key/body recovery,
anonymous next basket, and correct-customer resume. Independent SQL passed **41 checks**:
no new invoices, payments, stock movements or journals; supermarket V2 remained unchanged.

The new complete `pnpm run verify` on clean **f54af6b** ran from **08:45:44.158Z to
09:04:15.449Z, 2026-11-04**, exited **0**, and passed **15/15 gates**, **1263 API
tests (0 failures, 1 conditional upgrade skip)** and **464 UI tests**. Types, builds,
independent historical upgrade, audit and unchanged-source checks passed. The skipped
upgrade case passed in its separate upgrade gate. Interrupted preliminary runs and
development subsets are kept separate and are not aggregated into these totals.

Evidence/limits above apply equally in English: reconstructed legacy display metadata,
exact preserved original request identity/body, native committed park-response loss,
unit-covered resolver-response loss, direct `stock_layers` checks, and platform screenshot
references rather than embedded JPEGs. Private access captures are excluded. Later
documentation-only commits do not change the tested execution fingerprint.
