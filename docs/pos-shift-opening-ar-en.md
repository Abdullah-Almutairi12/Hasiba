# حاسبة — فتح الوردية من واجهة POS الأصلية

تاريخ الجولة: 3 نوفمبر 2026. هذا التقرير يخص شريحة فتح الوردية وسياقها واسترجاعها فقط، وليس قبول ERP كاملًا.

## حالة التقرير أثناء التحقق

التنفيذ والرحلة الأصلية والمصالحة اكتملت. انتهى التشغيل الشامل الأول بخروج1:14/15؛1251 خادم ناجحة وحالة ترقية مشروطة، و421 واجهة ناجحة/فشل واحد. الفشل توقع نص قديم لا يشمل حالة الوردية الجديدة. أضيفت العبارة إلى التوقع الكامل، دون إزالة حالة الوردية أو إضعاف التحقق من الفرع والكاشير والمرجع. ستضاف نتيجة البوابات النهائية بعد إعادة التحقق.

## النسخة وحدود الحفظ

- المستودع: `Abdullah-Almutairi12/Hasiba`.
- الفرع: `sync/hasiba-erp-20261023`؛ لم يُعدل `main` ولم يحدث نشر إنتاجي.
- التسليم السابق المحفوظ في التاريخ: `96a9a52e3b076f5c82b71b2b8ba7f68d8b96ac7d`.
- المصدر التنفيذي الجديد: `e26afef820fa155838f9903aa475107d0b8402f7`.
- بصمة التنفيذ: `a6354f4e1ed32d0506a45632d16d5bd38fcea19cf6ba3c12c7d3b8e7d0145abc`.
- `source.json` و`host-source.json` و`browser-source.json` تربط المصدر بالخادم المعزول وملف الواجهة المخدوم. لا ندعي وجود SHA مضمن داخل حزمة المتصفح.
- أرقام قبول استيراد العملاء السابقة 15/1239/412 تخص مصدرها القديم، وليست نتائج هذه الجولة.

## العيب المثبت والتعديل

1. شرط إظهار فتح الوردية في `pos-iconic.tsx` كان يستبعد المستخدم القديم المخول غير المرتبط بفرع، رغم سماح صلاحية الواجهة له بفتحها. اختبار دائم على محتوى الصفحة من التسليم السابق أعاد الفشل، ثم نجح على التعديل.
2. اختيار أول وردية مفتوحة كان يفتقر إلى سياق فرع صريح لهذا الحساب. أصبح الفرع اختيارًا صريحًا؛ لا يتم اختيار أول فرع أو استعارة وردية كاشير آخر. تفضيل الوردية المؤكدة يحفظ مع المستخدم والشركة والمسؤولية، ولا يغير ارتباط المستخدم الدائم.
3. قائمة الفروع الجديدة تستخدم السلطة القائمة: الشركات النشطة، منح المسؤولية الحالية، نطاق الفرع، والجهاز. تغيير القائمة أو معرف الفرع في المتصفح لا يمنح سلطة تنفيذ.
4. لم يُنشأ محرك محاولات جديد. يحفظ معرف فتح الوردية وجسمه ونقده وفرعه قبل الإرسال؛ الاسترجاع يعيد الجسم والمعرف نفسيهما. ظهور وردية في القائمة لا يمحو طلبًا مجهولًا. يمنع بدء بيع جديد حتى استرجاع طلب الفتح المعلق.
5. مسار إنشاء الوردية الأصلي يعيد فحص التفويض بعد حاجز السلطة وقبل الكتابة. استرجاع إيصال محفوظ يحتاج قراءة المصدر الحالية؛ الإذن بالقراءة لا ينشئ وردية جديدة دون `pos.shift.open`.
6. اسم الكاشير للمستخدم القديم أصبح مثبتًا من سجل المستخدم في الخادم، كما كانت هوية الموظف المحدد مثبتة أصلًا من ملفه. لا يعتمد على اسم مزور في جسم الطلب.
7. النقد الافتتاحي غير سالب، بمنزلتين عشريتين، ضمن سعة العمود. رفض القيم غير الصحيحة لا يغير المخزون أو الفواتير أو القيود.

لا ترحيلات قاعدة بيانات أو تبعيات جديدة. أُعيد استخدام خدمات المسؤوليات والجهاز و`financialTransaction` و`Idempotency-Key` وطلبات POS والمعاينة الضريبية والبيع والمخزون والأستاذ.

## الملفات الأساسية

- `artifacts/api-server/src/routes/pos.ts`: قائمة الفروع المخولة، التحقق من النقد والفرع، الهوية الأصلية، واسترجاع الإيصال بقراءة المصدر.
- `artifacts/api-server/src/middlewares/managed-access.ts`: ربط المسار الجديد بالمسؤولية الحالية؛ التنفيذ الجديد لا يزال مفحوصًا داخل المعاملة.
- `artifacts/api-server/src/routes/pos-shift-opening.test.ts`: 12 اختبار خادم دائمًا على PostgreSQL معزولة.
- `artifacts/api-server/src/routes/pos-devices.test.ts`: تحقق أن اختيار فرع الجهاز لا يتجاوز ربطه.
- `artifacts/erp-system/src/pages/pos-iconic.tsx`: اختيار الفرع، فتح الوردية واسترجاعها، وربط الوردية المؤكدة بالسياق.
- `artifacts/erp-system/src/lib/pos-session-context.ts` واختباره: عدم استعارة وردية أخرى وعزل السياقات.
- `artifacts/erp-system/src/lib/pos-session-intent.ts`: منع تنظيف محاولة أحدث عند وصول رد أقدم.
- `artifacts/erp-system/src/components/pos-session-context.tsx`: إظهار حالة الوردية بجانب الفرع والكاشير.
- اختبارات `pos-iconic.test.tsx` و`pos-iconic-discount.test.tsx` و`pos-sellers.test.tsx`: تغطية الانحدار وتهيئة نطاقات الاختبار صراحة بدل الاعتماد على أول وردية.
- `lib/api-spec/openapi.yaml` ومخرجات العميل وZod الثلاثة: عقد المسار والحقول والقيود؛ ولدت بالأداة القائمة.

## أدلة التطوير والإخفاقات المحفوظة

- `baseline.*`: اختبار المالك غير المرتبط بفرع على محتوى صفحة التسليم السابق، مع هويته المخولة الصحيحة: فشل واحد، و18 حالة مرشحة خارج الاختيار. السبب: غياب اختيار الفرع. الخروج 1 مقصود لإثبات الانحدار.
- `before.*`: تجربة استكشافية أولى قبل تحسين هوية fixture؛ لا تستخدم دليلًا مستقلًا على الصلاحية. دليل المقارنة المعتمد هو `baseline.*`.
- `ui-directed.log`: إخفاقات تطويرية نتيجة fixtures كانت تفترض وردية بلا فرع/هوية، وخطأ أنواع في fixture البائع. صححت تجهيزات الاختبار لتذكر نطاقها، ولم يخفف منع استعارة وردية أخرى.
- `ui-directed-2.*`: 43/43 ناجحة، بما فيها فقد الرد وإعادة التحميل ونفس معرف فتح الوردية، والقيم غير الصحيحة، والمنع والفراغ والخطأ، وعزل السياق.
- `api-directed.*`: 27 نجاحًا وفشلان أثناء الربط؛ كُشف نقص إدراج المسار الجديد في بوابة المسؤوليات ونقص تمكين قراءة الإيصال المحفوظ بعد سحب الفتح. عولجا في البوابة والمسار مع استمرار منع التنفيذ الجديد.
- `api-directed-2.*`: 29 نجاحًا وفشل fixture واحد؛ تحديث صلاحيات الشخص يستبدل منحته، وكان الاختبار يرسل معرف المنحة القديمة. صحح الاختبار لقراءة المنحة البديلة الحالية، لا لتجاوز سحب الصلاحية.
- `api-final-directed.*`: 12/12 ناجحة على قاعدة PostgreSQL مستقلة. منها انتظار حقيقي لقفل PostgreSQL ثم سحب الإذن قبل التنفيذ، ورفض دون إنشاء وردية أو إيصال.
- هذه نتائج مجموعات موجهة، وليست أعدادًا تضاف إلى الإجمالي الشامل.

## رحلة المتصفح الأصلية الجديدة

نُفذت على بيانات اصطناعية فقط، من الدخول إلى `/pos`:

1. المالك غير مرتبط بفرع دائم. الشاشة تبدأ دون اختيار فرع أو استعارة وردية.
2. اختار الفرع 6 وأدخل 125.50 ونقر «فتح وردية» مرة واحدة. لا API أو SQL لفتحها في هذه الجولة.
3. أسقط وسيط الاختبار الرد بعد أن أكمل الخادم حفظ الوردية وأعاد 201، الساعة 14:04:52.686Z. احتفظت الواجهة بالمحاولة.
4. أعاد تحميل الصفحة ونقر الاسترجاع؛ عند 14:05:18.246Z عاد `Idempotency-Replayed: true` والوردية نفسها 3، بنفس المعرف والجسم والنقد والفرع.
5. أضاف منتجًا واحدًا بسعر 10.00، وراجع المعاينة الحقيقية وأكدها، ثم دفع نقدًا مرة واحدة. حالة المنشأة الاصطناعية `not_registered` والضريبة صفر، بلا تجاوز للسياسة.
6. أسقط الوسيط رد البيع بعد حفظه الساعة 14:05:49.273Z، ثم استرجعته الواجهة بعد إعادة التحميل الساعة 14:06:13.884Z، بنفس الطلب والبيع 2. الرقم: `ORD-1793714749134-d1833ee2`.
7. انتقل إلى الفرع 7: لم تُستخدم وردية الفرع 6 ولم تُفتح وردية أخرى. عاد إلى 6 فعاد سياق ورديته المؤكدة والسلة فارغة.

أدلة الطلبات الخام منقحة في `transport-events.json`؛ بصمات الرموز الموقعة بدل قيمها. دليل النقرات في `browser-observations.md` و`result.json`.

## المصالحة المستقلة الجديدة

`reconciliation.json`: 14/14، بتاريخ 14:07:12.294Z، مع لقطة قبل وبعد لـ228 جدولًا.

- وردية جديدة واحدة فقط، للفرع 6 والكاشير الأصلي 11، نقد افتتاحي 125.50، مبيعات 10.00 وطلب واحد، وارتباط المستخدم الدائم بالفرع ما زال فارغًا.
- بيع وفاتورة وحركة إصدار مخزون واحدة. لا مضاعفة عند استرجاع فتح الوردية أو البيع.
- إيصالا تنفيذ جديدان فقط: فتح الوردية والبيع؛ الاسترجاع لم ينشئ إيصالًا ثالثًا.
- مستودع البيع: 19 وحدة وقيمة 57؛ طبقات FIFO: 19/57. إجمالي مخزون الشركة 117 يطابق أستاذ المخزون 117.
- الإيراد 10، النقد من البيع 10، صافي الذمم صفر، الضريبة صفر، تكلفة المبيعات 3، وحركة قيمة المخزون -3. القيود الثلاثة الجديدة متوازنة.
- النقد الافتتاحي مسجل في الوردية وفق الخدمة الأصلية؛ لم يُحسب إيرادًا أو دفعة عميل أو قيد افتتاح جديد.
- الصفوف المالية التاريخية المحمية والعملاء والمحاولات والمستندات والسياسات القديمة بقيت مطابقة. لا تغيير سياسة ضريبية.
- الأموال تقرأ كنص SQL، ومساواة الأستاذ والذمم والضريبة محسوبة داخل PostgreSQL، لا بجمع أرقام JSON عائمة.

## الحدود وما لم يُختبر

- ثماني صور رحلة أصلية وصورة دخول عامة محفوظة فعليًا. ثلاث صور وسيطة ذكرتها ملاحظات المختبر لم تُصدّر كملفات؛ لا تعد ضمن المرفقات.
- لا رحلة تبديل شركة أصلية جديدة: لا يوجد مبدل شركة ظاهر داخل POS؛ جرى اختبار تبديل الفرعين بالنقر. عزل الشركات والمسؤوليات يغطيه اختبار الخادم واختبارات السياق، وليس ادعاء اختبار شاشة تبديل شركة جديدة.
- ربط أجهزة POS اختبر برمجيًا بمفاتيح اختبار وتوقيعات ونطاق محطة؛ لا جهاز أو طابعة أو USB/Bluetooth فعلية.
- لا إعادة رحلة استيراد الأصناف أو الموردين أو العملاء من المتصفح في هذه الشريحة. بقيت خدماتها دون إعادة بناء، وتغطي البوابات الجديدة اختبارات الانحدار القائمة.
- لا اختبارات كتابة على بيانات العملاء، ولا إرسال أو دفع خارجي أو نشر. `TAX_POLICY_NOT_READY` باقٍ.
- ملف Word يتحقق من بنيته وXML وZIP؛ لا ادعاء فتحه على Microsoft Word مكتبي.

## English report

Scope: native POS shift opening for an authorized legacy operator without a permanent branch assignment, preserving accepted imports and existing financial services.

The accepted baseline hid the opening action for that operator and could select the first open shift without an explicit branch context. The permanent regression test fails against the accepted page source and passes after the fix. The original POS now provides an explicit server-authorized branch choice; it does not rebind the account, infer a grant from a job title, or borrow another cashier's shift.

The existing opening endpoint, financial receipt engine, authority fence and device verification remain in use. New opening rechecks its live grant after locks. A saved result is recoverable with current source-read authority, without granting new execution. Cash is validated; legacy cashier identity is derived by the server. A persisted request freezes branch, cash, key and responsibility before sending; an unrelated open session cannot clear it.

Executable source: `e26afef820fa155838f9903aa475107d0b8402f7`, fingerprint `a6354f4e1ed32d0506a45632d16d5bd38fcea19cf6ba3c12c7d3b8e7d0145abc`. Reports and asset-registration commits may follow without changing executable bytes. Final GitHub equality is recorded separately, not inferred from a local checkpoint.

Fresh native browser evidence: login, explicitly select branch6, enter 125.50, click opening once, lose the response after a committed201, reload and replay the exact opening. Then explicitly confirm the real tax preview, sell one10.00 item for cash once, lose its response after commit, reload and replay the same sale. Switching to branch7 does not borrow branch6's shift; switching back restores the confirmed context. No API/SQL opening workaround was used.

Independent reconciliation passed14/14: one new shift, one sale/invoice/stock issue, two execution receipts only, original protected rows unchanged, warehouse and FIFO19 units/value57, company inventory117 equals GL117, revenue10/cash10/AR0/VAT0/COGS3/inventory-3, and all three new journals balanced.

Directed development results and failures remain separate in the evidence. Final corrected directed API tests passed12/12; directed UI tests passed43/43. These subsets are not added to the full suite total. The fresh full-gate run's actual terminal result will be recorded before delivery; previous15/1239/412 acceptance is not reused as a new result.

Boundaries: synthetic PostgreSQL only; no native company-switch journey, real POS hardware, production deployment/payment/tax integration, or new import-browser journey. Software device scope and company/responsibility isolation have automated coverage. `TAX_POLICY_NOT_READY` remains. No claim that the entire ERP is defect-free.
