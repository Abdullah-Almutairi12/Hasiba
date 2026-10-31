# حاسبة — تحديث عرض الشريك وحالة تطبيق التغييرات

31 أكتوبر 2026، لا نشر إنتاجي ولا تعديل لفرع `main`.

## ما أُنجز في هذه الجولة

- البداية المحفوظة: `23800471193718e5adb739e6d6b55fbd3618ef39` على فرع `sync/hasiba-erp-20261023`.
- استُخدم عرض «حاسبة.AI — عرض المميزات» القائم في `artifacts/features-deck`، لا دليل المستخدم ولا تقرير الاختبارات. بقيت الشرائح الـ32 ومعرّفاتها وترتيبها، والألوان والخط الأصلي IBM Plex Sans Arabic.
- صُححت الادعاءات القديمة عن التسجيل الضريبي التلقائي واعتماد الهيئة والأجهزة وكفاءة AI. تُفصل الميزات القائمة عن القبول المثبت والموانع التشغيلية.
- يتضمن العرض اتفاق أمر البيع 344 بعد تقدير غير ملزم 345، ومصدر الخصم، والتسليم الواحد، والفاتورتين 114.67 و229.33، واستعادة النتيجة دون تكرار، والذمم مقابل التحصيل، والشركات والفروع والمسؤوليات والهوية الضريبية المؤرخة.
- يبقى `TAX_POLICY_NOT_READY`، ولا ادعاء بقبول زاتكا إنتاجيًا أو الأجهزة أو الدفع والبريد الحيين.
- أعيد تشغيل واجهة ERP التي كانت متوقفة؛ الخادم المستخدم للعرض هو الخادم الاصطناعي المحفوظ، وليس تشغيل API العادي على البيانات الافتراضية.

## ملف PDF الأصلي

كان في المكتبة ملفان لنفس العرض: `Hasiba-AI-ERP.pdf` والاسم العربي المصدّر آليًا `------AI---------------.pdf`. ثبت تطابق النص في جميع صفحات النسختين القديمتين، رغم اختلاف بصمتي الملفين. حُفظت نسختاهما قبل التحديث في المخرجات المستثناة من Git.

أعيد التصدير من مصدر الشرائح نفسه إلى:

- `.local/outputs/Hasiba-AI-ERP.pdf`
- حُدّث الاسم البديل نفسه `.local/outputs/------AI---------------.pdf` بنفس البايتات، للمحافظة على مراجع المكتبة السابقة.

النسخة الجديدة: 32 صفحة، 446921 بايت؛ SHA-256:
`ced48ec677f3cebac2cc81a319c63da4aa5602e623ad454ccfefb4a38c73f2c1`.

حُوّلت كل الصفحات إلى صور وفُحصت لوحات الصفحات الأربع بصريًا. فحص الهندسة سجل صفر كتل نص خارج الصفحة، وكل الصفحات تحتوي نصًا. العربية وRTL والجداول والأرقام ظاهرة دون قص. لا ندعي اختبار تنزيل الملف عبر جلسة المستخدم المسجلة في موقع Replit؛ الملف نفسه فُتح محليًا وصُدّر وسُجّل للتنزيل في المكتبة، ومسار ملفه الأصلي محفوظ. العرض الحي في `/features-deck/`.

## الفحوص الجديدة، لا إعادة تسمية للقبول السابق

المصدر المفحوص للشرائح وخطوة ما بعد الدمج:
`180c3cde4121fb8d6cb268485aaa96f6770a5726`.

التشغيل المحدد بدأ 12:33:40 UTC وانتهى 12:33:53 UTC، أي 15:33 بتوقيت الرياض؛ نجحت الفحوص الأربعة برمز خروج 0:

1. اختبار أمان خطوة ما بعد الدمج.
2. تحقق بنية الشرائح الـ32.
3. فحص أنواع عرض الشرائح.
4. بناء عرض الشرائح، مع إعداد مساره الفعلي `/features-deck/`.

فشل أداة صور PDF الأول بسبب غياب Pillow كان عائق أداة فقط؛ أزيل اعتماد الأداة عليه واستُخدم PyMuPDF الموجود، ثم نجح التصوير. لا تغيير في حسابات المبيعات بسبب ذلك.

رحلة قراءة جديدة من الواجهة الأصلية تمت 12:29:01–12:33:55 UTC: نجح الدخول والخروج للحسابين المصطنعين وصفحات البداية والمبيعات والإعدادات، وبقيت الفاتورتان 114.67 و229.33 والملخص والذمم 344 والتحصيل صفرًا. ظهرت الهوية السارية والمستقبلية ووراثة الفرعين. لا حفظ إعدادات ولا إصدار مالي جديد. دليلها و7 صور في `generated-artifacts/meeting-update/browser/fresh-pass-20261031T122901Z/`.

ثبت تطابق sourcemaps المفكوكة بـUTF-8 مع ملفات المبيعات والإعدادات الحالية، ولا فرق في شيفرة API/ERP أو اعتمادياتها التنفيذية عن المصدر المقبول `2fdfe868`. إيصال بدء الخادم ما زال إيصال ذلك المصدر القديم؛ لم نسمّه توثيق بدء تشغيل جديد. هذا إثبات العرض الحالي، وليس إثبات ما بعد الدمج المعلق.

لم يُشغّل اختبار شامل مكرر أثناء انتظار الدمج. القبول السابق الكامل على `2fdfe868` (15/15 و1123 API و349 UI والترقية المستقلة) محفوظ، وليس قبولًا لدمج جديد. أدلة هذه الجولة في `generated-artifacts/meeting-update/`، ومنها `scoped-checks.json` و`pdf-review/inventory.json` والصور.

## مانع التطبيق الفعلي ونقطة الاستئناف

عند المراجعة المباشرة كانت المهمة #119 «تحقّق من تحديث ملخص المبيعات» في الدمج وتنتظر قفل الوكيل الرئيسي (`WAITING_FOR_LOCK`). لم يصل دمجها إلى الشجرة الحالية؛ لا نعتمد نجاحها في مساحة أخرى دليل تطبيقها هنا. لا يوجد مسار يدوي آمن موثق في الأدوات المستخدمة لتجاوز هذا القفل، ولم نعدل حالة المهمة اصطناعيًا أو نكرر شيفرتها.

قبل تحرير القفل عولج مانع أمان مثبت: كانت خطوة ما بعد الدمج تنفذ تلقائيًا `push-force` وترحيل شركات والتقاط دليل بمصادقة على القاعدة الافتراضية. اقتصرت الآن على تثبيت الاعتماديات؛ لا ترحيل أو backfill أو تصوير مصادق تلقائي. اختبار قبل/بعد بأداة pnpm وهمية أثبت الأوامر السابقة والمنع الجديد، دون اتصال بأي قاعدة.

**لم تُغلق حالة تطبيق جميع التغييرات بعد.** أول خطوة بعد تحرر القفل ووصول نتيجة الدمج: فحص commit وفروقه وتعارضاته، ثم مراجعة خطوة الإعداد ونسخة الخادم والواجهة. إذا تغير المصدر التنفيذي، تُعاد الاختبارات المتأثرة والبوابات المطلوبة ورحلة البيع والمصالحة على المصدر النهائي؛ لا ينسب قبول سابق إليه. لا تبدأ مرحلة ثالثة ولا تفتح مسارات ضريبية محجوبة.

ملفات PDF والصور والسجلات مستثناة عمدًا من Git، وتُسلّم عبر المكتبة. مصدر العرض والاختبار وخطوة الإعداد والتقرير ملفات محفوظة في المستودع.

---

## English handoff

The existing 32-slide partner presentation was updated in place, preserving manifest identity, palette and original font. Its PDF and the original Arabic filename alias now contain the same updated bytes; all pages were rendered and visually inspected, with no text blocks outside page bounds. The downloadable file is not a user guide or a replacement verification report.

The new scoped checks passed on `180c3cd` at 12:33:40–12:33:53 UTC: merge-hook safety, slide validation, slide types and slide build. These are not a new full ERP acceptance. The previously accepted `2fdfe868` results remain separate.

Task #119 was genuinely waiting for the main-agent workspace lock, not already applied. Do not claim the merge or post-merge ERP acceptance is complete. Preserve all changes, allow the platform merge after the active turn releases its lock, then inspect the actual merged diff before testing and restarting the isolated runtime as needed.

The inherited post-merge hook could automatically write schema/backfill changes to the default database. It is now dependency-only, with a stubbed-command before/after safety regression and no ordinary database access. Schema upgrades require explicit environment-specific authorization. `main`, production publishing and the global tax readiness gate remain unchanged.
