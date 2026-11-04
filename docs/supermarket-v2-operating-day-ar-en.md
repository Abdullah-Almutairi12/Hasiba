# حاسبة — يوم السوبرماركت V2 / Supermarket operating day V2

التاريخ: 4 نوفمبر 2026. النتيجة تخص تجربة برمجية مصطنعة محددة، وليست شهادة بأن كامل ERP أو الأجهزة أو القبول الضريبي الإنتاجي مكتمل.

## 1. المصدر والنطاق / Input and scope

- اعتمدت الحزمة الجديدة `Hasiba_Saudi_Supermarket_V2_1793765772872.zip`، وقرأت `START_HERE_AR.md` و`REPLIT_PROMPT_AR.txt`.
- استُخدمت ملفات `04_pilot` الثلاثة فقط؛ لم تُستورد بيانات الشهر أو أرصدته، ولم يُستخدم المصنف القديم في تنفيذ V2 أو تُحذف بياناته.
- شركة اختبار V2 مستقلة: الشركة 11، الفرع 13، المستودع 28. الصنف `RSD2-000001`، المنتج 9، رُبط بالتصنيف الفعلي 7 بدل `MAP_D01`، وبدأ بمخزون صفر.
- المورد المستورد 1 والعميل المستورد 4؛ لم يُستخدم عميل نقدي مجهول بدلاً منه.
- هويات مستقلة للمشتريات والاستلام والمحاسبة والكاشير؛ منشئ أمر الشراء 23 والمستلم 24 مختلفان. المالك الإداري 21 استُخدم للإعداد المصرح فقط، وليس لتنفيذ كل الرحلة.
- تهيئة الشركة والهويات وبعض منح الاختبار تمت بأدوات الإعداد القائمة في القاعدة المعزولة. **عمليات الاستيراد والشراء والاستلام وفاتورة المورد والبيع والمرتجع والاسترداد والإقفال تمت من الواجهات الأصلية، لا بكتابات API/SQL بدل النقرات.**

## 2. المتوقع والفعلي / Expected versus actual

| البند / Measure | المتوقع / Expected | الفعلي / Actual |
|---|---:|---:|
| مخزون البداية / Initial stock | 0 | 0 |
| بعد الاستلام / After receiving | 10 | 10 |
| بعد بيع 3 / After selling 3 | 7 | 7 |
| بعد إرجاع وحدة للبيع / After resalable return | 8 | 8 |
| المقبوض / Cash received SAR | 25.50 | 25.50 |
| المسترد / Cash refunded SAR | 8.50 | 8.50 |
| الافتتاح المصرح / Declared opening float SAR | 100.00 | 100.00 |
| النقد المتوقع والمعدود / Expected and counted cash SAR | 117.00 | 117.00 |
| فرق الإقفال / Closing difference SAR | 0.00 | 0.00 |
| قيمة المخزون / Inventory value SAR | 52.80 | 52.80 |
| صافي تكلفة المبيعات / Net COGS SAR | 13.20 | 13.20 |
| المستحق للمورد / Supplier payable SAR | 66.00 | 66.00 |
| ذمم العميل / Customer receivable SAR | 0.00 | 0.00 |
| الضريبة في البيع والمرتجع / Sale and return VAT SAR | 0.00 | 0.00 |

المعاينة الفعلية للخادم أثبتت سعر 8.50 بلا خصم أو ضريبة مضافة لأن **شركة الاختبار مصرح بأنها غير مسجلة**. ليس ذلك قراراً ضريبياً عن منشأة حقيقية، ولم تُفتح بوابة `TAX_POLICY_NOT_READY`.

النقد الختامي: **100.00 + 25.50 − 8.50 = 117.00**. أثر النقد في الأستاذ **17.00**؛ مبلغ الافتتاح 100 إعلان عهدة الوردية وليس إيراداً أو قيد تمويل مستحدثاً. لا يدّعي التقرير أن رصيد دفتر النقد المطلق 117 دون دليل تمويل الافتتاح.

الصنف عادي غير متتبع وطريقة التكلفة الفعلية **المتوسط**، لا FIFO. الطبقات الخالية لا تُقدم كإثبات FIFO. القيمة النقدية تُقارن بعد التقريب المحاسبي لهللتين؛ القيمة الخام `52.80000000000000400000` والمتوسط الخام `6.6000000000000005` محفوظان في الدليل، مع فرق حسابي تحت الهللة `4.00000E-15`، دون إعادة تقييم أو تصفير صامت.

## 3. مراجع المستندات / Document references

| المستند / Document | المرجع / Reference |
|---|---|
| أمر الشراء / Purchase order | PO-2026-00001 · 10 × 6.60 = 66.00 |
| استلام المورد / Goods receipt | GRN-2026-00001 · 10 units |
| فاتورة المورد / Supplier invoice | ID 1 · DAY-V2-UNIQUE · posted 66.00 |
| أمر POS / POS order | ORD-1793768419457-8c134256 · 25.50 |
| فاتورة العميل / Customer invoice | ID 3 · PINV-2026-00002 · customer 4 |
| سند القبض / Cash receipt | ID 2 · RCT-2026-00002 · 25.50 |
| إشعار دائن / Credit note | ID 1 · CN-2026-00001 · 8.50 |
| استلام المرتجع / Returned-goods receipt | RCV-CN-2026-00001 · 1 resalable unit |
| سند الاسترداد / Cash refund | ID 1 · RFD-82ff7b15-19d4-4ef7-9dc3-69bef75d6059 · 8.50 |
| الوردية الأصلية / Original shift | ID 33 · WRD-1793766758567-b020a19e |
| الإقفال / Closing | session 33 · approved · expected=counted 117.00 · difference 0 |

المصالحة المستقلة نجحت في **67/67** تحققاً باستخدام قراءات PostgreSQL وقيم Decimal، لا إجماليات الواجهة وحدها: وردية واحدة، بيع واحد، فاتورة عميل واحدة، مرتجع واحد، استرداد واحد، 3 حركات مخزون و7 قيود مرحلة متوازنة. لم تُضاعف فاتورة المورد المخزون؛ بقي حساب الاستلام غير المفوتر GR/IR صفراً بعد الترحيل. التفاصيل الخام في ملفات checkpoints و`independent-reconciliation.json`.

## 4. العيوب المثبتة وإصلاحها / Proven defects and fixes

1. زر العميل الأصلي في POS لم يفتح اختيار العميل. رُبط بمحدد حقيقي، وأُضيف العميل إلى جسم محاولة التحصيل الأصلي المحفوظ. لا تغيّر إعادة المحاولة العميل أو مفتاح المحاولة أو جسمها.
2. بوابة الوصول المحدد لم تصنف مسارات معاينة POS الأصلية، فأعادت 403 لكاشير لديه إذن البيع. أضيفت مطابقة **دقيقة**: قراءة السياق بـ`pos.read`، معاينة جديدة بـ`pos.sell`، واستعادة/إغلاق المحاولة بـ`pos.read`. بقيت فحوص المعاملة والخادم والحدود والعزل قائمة؛ لا wildcard أو دور موازٍ أو تجاوز ضريبي.
3. أثناء التطوير كشف فحص الأنواع مرجعاً إلى تسمية غير معرفة في grant؛ صُحح قبل نجاح الفحوص النهائية. لم يُضعف اختبار أو حماية.

ملفات التطبيق والاختبارات:
- `artifacts/erp-system/src/components/pos-customer-picker.tsx`
- `artifacts/erp-system/src/components/pos-customer-picker.test.tsx`
- `artifacts/erp-system/src/pages/pos-iconic.tsx`
- `artifacts/erp-system/src/pages/pos-iconic.test.tsx`
- `artifacts/api-server/src/middlewares/managed-access.ts`
- `artifacts/api-server/src/routes/team-access.test.ts`

### إعدادات أوقفت التجربة بأمان وليست عيوباً / Correct fail-closed setup

- الكاشير لم يمتلك قراءة دليل العملاء. مُنحت **مسؤولية قراءة مستقلة وصريحة**، دون أرصدة أو تحصيل أو تعديل. يستخدم المحدد منحته للبحث فقط ولا يستبدل مسؤولية POS الأساسية.
- إعادة المرتجع للبيع كانت غير مهيأة. فعل المالك من شاشة السياسات الأصلية السماح بها **للفرع التجريبي 13 فقط**، دون تغيير حد الموافقة.
- حدّا `sales.credit_note_amount` و`pos.refund_amount` لدور `scoped` كانا صفراً، فرفض الخادم الاسترداد دون أثر. ضُبطا صراحةً من الواجهة الأصلية إلى **8.50 فقط في شركة 11**، مع بقاء إذن الفعل والنطاق وحدود المسؤولية لازمة. لم تتغير شركات أو أدوار أو أفعال أخرى.
- زر الاستلام موجود داخل تفاصيل أمر الشراء؛ تعثر الوصول الأولي صُحح بالتنقل الأصلي دون إعادة بناء وظيفة صحيحة.
- حدّثت الواجهة بعض حالات المرتجع بعد إعادة التحقق/التحديث؛ تحققت الحالة المحفوظة قبل متابعة الخطوة التالية، دون تكرار إجراء.

## 5. نتائج جديدة لا سجلات قديمة / Fresh verification

- انحدار زر العميل قبل الإصلاح: **2 فاشل، 27 متجاوزاً بسبب مرشح التشغيل**؛ بعد اكتمال الإصلاح اختبارات POS والمحدد **32 ناجحاً، 0 فاشل**.
- انحدار الوصول للمعاينة PostgreSQL قبل الإصلاح: **1 فاشل، 35 ناجحاً**؛ بعده **36 ناجحاً، 0 فاشل**، بما يشمل رفض المسؤولية الخاطئة وسحب البيع مع بقاء استعادة القراءة وعدم الأثر المالي للمعاينة.
- التشغيل النهائي الكامل: **15/15 بوابة**، **API 1253 ناجح، 0 فاشل، 1 متجاوز**؛ **UI 437 ناجح، 0 فاشل**. اختبارات 32 و36 موجهة ومتداخلة مع المجموع وليست أعداداً تضاف إليه.
- حُفظ سجل أقدم باسم `prior-run-not-v2` من المصدر 2a3b7f، وفيه إخفاق اختبار انتظار قفل الصلاحية. ليس نتيجة التشغيل الحالي ولا قبولاً له، ولم يُعدّل الاختبار لإخفاء السجل القديم.
- بدأ: `2026-11-04T05:27:25.586Z` UTC؛ انتهى: `2026-11-04T05:45:39.514Z` UTC؛ رمز الخروج **0**.
- الترقية المستقلة وفحص الأنواع وبناء الوحدات وتدقيق الاعتماديات شُغلت فعلياً ضمن هذا التشغيل؛ لا ترحيل إنتاجي.
- المتجاوز في تشغيل API العادي: original POS invoice: independent linked return lifecycle upgrade preserves a pinned previous installation and its financial relationships. شرط المصدر `skipIf(!process.env.HASBA_MIGRATION_REFERENCE)` يحتاج مرجع تثبيت سابق؛ لذلك لا يوصف هذا الصف بالناجح في تشغيل API. **شُغّل الاختبار نفسه فعلياً ونجح في بوابة الترقية المستقلة** مع المرجع: اختبار واحد ناجح و38 متجاوزاً بمرشح `upgrade preserves`، كما يثبت `verification-final/migration-upgrade.log`. لا تُجمع هذه الأعداد مع مجموع API.

| Gate | Result | Exit | Duration ms |
|---|---|---:|---:|
| typecheck | PASS | 0 | 31208 |
| isolated-runner-tests | PASS | 0 | 3849 |
| invoice-cleanup-evidence-tests | PASS | 0 | 743 |
| receipt-cleanup-evidence-tests | PASS | 0 | 794 |
| return-cleanup-evidence-tests | PASS | 0 | 517 |
| migration-upgrade | PASS | 0 | 34557 |
| tests | PASS | 0 | 857701 |
| erp-ui-tests | PASS | 0 | 124360 |
| api-build | PASS | 0 | 3010 |
| erp-system-build | PASS | 0 | 14511 |
| docs-build | PASS | 0 | 3144 |
| features-deck-build | PASS | 0 | 1941 |
| mockup-sandbox-build | PASS | 0 | 1595 |
| dependency-audit | PASS | 0 | 795 |
| source-unchanged | PASS | 0 | 0 |

## 6. ربط المصادر والأدلة / Source attribution

- المصدر النهائي للبوابات: [`4fbe47cbd061c3874329576aedf456546ef8c6a1`](https://github.com/Abdullah-Almutairi12/Hasiba/commit/4fbe47cbd061c3874329576aedf456546ef8c6a1)؛ بصمة التنفيذ: `a93cc59c491b7e5f33bf018b6cfbc1c54b591b2d2894b99dcbd0bb493182aeda`.
- مصدر رحلة POS والمتصفح والخادم: `aaa377b9ff81c00383ee3e88b5817a1b394b6682`؛ بصمته الكاملة: `8cdc904b0afacd4048da6a1c9c5cf2bd5b3e64b160f2546f03c7629e38bafa4a`. إنشاء الأدلة موثق في `host-source.json` و`native-report.md`.
- الاستيراد والمشتريات والاستلام وفاتورة المورد نُفذت قبل إصلاحي POS على 354e2b6، ولم تُعد لإنشاء بيانات مكررة. فروق إصلاحات POS لا تغير خدمات المشتريات أو المخزون أو الحسابات الأصلية.
- الفرق بين مصدر رحلة POS والمصدر النهائي **الشريحة والتوثيق فقط**؛ المقارنة المستقلة لكود ERP وAPI والمكتبات والبرامج النصية وملف الاعتماديات خالية. لا تُنسب الرحلة إلى SHA آخر بصمت.
- الفرع `sync/hasiba-erp-20261023` والمستودع [https://github.com/Abdullah-Almutairi12/Hasiba](https://github.com/Abdullah-Almutairi12/Hasiba). تُحفظ مساواة المحلي وGitHub وآخر Commit التسليم في `delivery.json` بالحزمة بعد الرفع؛ لا تعديل main أو force push أو نشر إنتاجي.
- حدثت شريحة POS رقم 5 في **العرض الموجود نفسه** بعد نجاح الرحلة والمصالحة فقط. بقيت الشرائح 32 ومعرفاتها والتصميم العام. صُححت تسمية استلام البضاعة مقابل سند الاسترداد، وفُحص العرض بصرياً 1280×720.
- الأدلة المولدة والمرفق الأصلي وبيانات الوصول الخاصة غير مرفوعة إلى Git؛ الشيفرة والاختبارات والشريحة وهذا التقرير فقط جزء التسليم المصدري. الحزمة المنقحة تسلم كملف مستقل، بلا كلمات مرور أو DSN أو cookies أو بيانات عميل تشغيلي.

## 7. ما لم يُختبر / Limits and remaining scope

- لا دفع أو نقد حقيقي، ولا جهاز بنكي أو SDK أو بريد خارجي أو زاتكا إنتاجية. لم تُختبر ورقة مطبوعة أو قارئ باركود مادي؛ اختيار الصنف كان من الواجهة.
- جرى استيراد CSV الصغير فقط؛ لم تُختبر واجهة استيراد XLSX/JSON أو الكتالوج الكبير أو تاريخ الشهر في هذه الجولة.
- لم يُحقن فقد رد أو تسابق متزامن في يوم V2 اليدوي؛ اختبارات حماية المحاولات الآلية شُغلت ضمن البوابات، والانحدار المضاف يحفظ العميل والجسم الأصلي عند الاستعادة. عدد المستندات والحركات الفعلي لا يثبت وحده كل أعطال الشبكة الممكنة.
- إعداد الشركة التجريبية غير المسجلة ليس قبولاً ضريبياً عاماً. `TAX_POLICY_NOT_READY` باقٍ. لم يُعاد بناء إعداد المشترك أو محرر الفواتير أو يثبت اكتمال جميع ERP.
- القاعدة معزولة ومؤقتة مرتبطة بعملية الاختبار، وليست بيانات تشغيل أو نشر دائم. لا تُنشر بيانات دخولها في التقرير.
- **نطاق اليوم التجريبي أُغلق بنجاح بعد الفحوص المذكورة. لا عائق باقٍ مثبت داخل هذه الرحلة؛ لا يبدأ نطاق جديد تلقائياً.**

---

## English delivery summary

The single regular-API skip requires HASBA_MIGRATION_REFERENCE. That same pinned-installation upgrade test actually passed in the independent upgrade gate (1 passed, 38 filtered skips); those figures are not added to the regular API total. The historical unsuccessful run is preserved separately under prior-run-not-v2 and is not relabelled as this new result.

The new V2 ZIP replaced the old workbook for this execution. Only the three `04_pilot` CSV files were used, in a separate synthetic company (11), branch (13), warehouse (28). Product `RSD2-000001` was mapped to the real category ID 7 and started at zero. No monthly history/opening inventory was imported, and no old-workbook data was deleted or mixed into V2.

All business steps used the original application screens: supplier/customer/product import, purchase order, independent goods receipt, posted supplier invoice, cash sale, resalable return, cash refund and original-shift closing. The observed stock sequence was **0 → 10 → 7 → 8**. Received cash **25.50**, refunded cash **8.50**, declared opening float **100.00**, expected/count **117.00**, difference **0.00**. Inventory **52.80**, net COGS **13.20**, supplier AP **66.00**, customer AR **0.00**. Seven posted journals balance. Supplier invoicing did not receive the stock a second time.

Opening float is a till declaration, not revenue or a fabricated funding journal. The GL cash movement is **17.00**, not an asserted absolute cash balance of 117. Stock uses **average cost**, not FIFO; raw decimal residuals and cent-level monetary reconciliation are retained transparently.

Two actual defects were fixed narrowly: an inert native customer-selection button and missing exact delegated-route mappings for POS tax context/preview/intent recovery. Customer lookup requires an explicit independent directory-read responsibility and never switches the primary POS grant. Fresh previews require `pos.sell`; original intent recovery remains available with live source-read authority. Existing transaction checks and tax gates were not bypassed.

Other stops were valid setup denials, not application bugs: missing customer-directory authority, unconfigured branch resale policy, and default-zero scoped credit-note/refund caps. Existing authorized owner screens/configuration were used only for the new synthetic company, with caps **8.50** and unchanged approval thresholds. No owner identity was substituted for all operational roles.

New evidence: customer regression **2 failed before / 32 targeted passed after**; PostgreSQL route regression **1 failed + 35 passed before / 36 passed after**; independent Decimal/SQL reconciliation **67/67**. Final fresh verification on `4fbe47cbd061c3874329576aedf456546ef8c6a1`: **15/15 gates, 1253 API passed, 0 failed, 1 skipped, 437 UI passed**. Targeted counts overlap these suite totals and are not added. Run timestamps and exit code are recorded above and in `verification-run.json`; the independent upgrade was executed, not inferred from an older report.

The native POS journey ran on `aaa377b9ff81c00383ee3e88b5817a1b394b6682`. The final gate source differs only in the investor slide/documentation; ERP/API/library/script/lockfile comparison is empty. Earlier procurement steps predate the POS fixes and were preserved rather than duplicated. Repository, branch and final remote/local equality are recorded in `delivery.json`.

The existing investor POS slide was updated only after the journey and reconciliation passed. No real cash/payment/device, printed-paper, live email or production tax acceptance is claimed. `TAX_POLICY_NOT_READY` remains. The wider workbook, XLSX/JSON UI, physical scanner/printer, production operations and exhaustive network/concurrency faults were not part of this native pilot proof. The bounded pilot is complete; the whole ERP is not certified error-free.
