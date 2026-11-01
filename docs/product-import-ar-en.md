# استيراد الأصناف الأساسية — Basic catalogue import

## نطاق العمل وحالته / Scope and status

تنفيذ جارٍ على المشروع القائم وفرع `sync/hasiba-erp-20261023`.
نقطة البدء المحفوظة `0b0847f`؛ لا إعادة بناء لأوامر البيع أو الضرائب.
هذا سجل الشريحة الجديدة، وليس قبولًا عامًا للمتجر أو جميع المستوردات.

Implemented path: original Products → CSV/XLSX import → server parsing →
explicit column mapping → read-only preview → explicit atomic create-only
confirmation → durable receipt / recovery / safe closure.
Final native journey and full release gates are pending; historical results are
not attributed to this implementation.

## القرارات والحدود / Decisions and limits

- أصناف جديدة فقط، كل الصفوف أو لا شيء؛ لا تحديث صامت ولا مطابقة بالاسم.
- SKU والباركود نصيان؛ تُرفض الخلايا الرقمية لهما ولا تُخمّن أصفار مفقودة.
- كل عمود مربوط صراحة؛ لا تجاهل لأعمدة المخزون والضريبة والمتغيرات والتتبع.
- الأسعار غير السالبة مطلوبة صراحة؛ لا تحويل قيمة مجهولة إلى صفر.
- كميات ابتدائية صفر؛ حد أدنى5؛ تتبع none وطريقة average مثل إنشاء الصنف
  الأصلي. تكلفة الكتالوج ليست حركة تقييم مخزني.
- CSV UTF-8 أو ورقة XLSX واحدة؛256KiB،500صف،12عمودًا،128حرفًا للخلية.
  حد مستقل450000بايت لبيانات المعاينة الموقعة بعد الترميز.
- ZIP inflation is bounded before ExcelJS; formulas and unsupported cell types
  are rejected. No external file/resource service is used.
- يستخدم إذن إنشاء الأصناف الحالي؛ مسؤوليات حركة المخزون لا تمنحه ضمنيًا.
- SKU uniqueness is GLOBAL in the existing model. A hidden-company collision
  fails atomically with a generic unavailable-code error, without revealing
  the other company. This slice does not migrate that constraint.
- التصنيفات مرجع النظام المشترك القائم، وليست تصنيفًا مستقلًا جديدًا.
- لا أرصدة افتتاحية أو حركات مخزون أو قيود أو فواتير أو تحديث تاريخ التكلفة.
- `TAX_POLICY_NOT_READY` unchanged. No production, main, real mail/payment,
  device or ZATCA acceptance.

## دليل مختصر / Quick user guide

1. افتح «المنتجات» ثم «استيراد CSV / XLSX» بحساب مخوّل.
2. افتح مرجع أرقام الفئات والوحدات أو نزّل قالب CSV. اكتب أكواد SKU/الباركود
   كنص في Excel قبل إدخالها؛ التنسيق اللاحق لا يعيد الأصفار المفقودة.
3. ارفع الملف واربط كل عمود. احذف الأعمدة غير المدعومة من الملف نفسه.
4. عاين الصفوف والأخطاء. أرقام CSV تشير للسجلات لا أسطر محرر النص إذا احتوت
   الخلية سطرًا جديدًا. لا حفظ أثناء هذه الخطوة.
5. أكّد فقط بعد صلاحية جميع الصفوف؛ تعرض النتيجة معرّفات الأصناف المحفوظة.
6. إذا فُقد الرد لا تبدأ محاولة جديدة: أعد فتح النافذة واستعلم عن المحاولة.
   إعادة التنفيذ تستخدم جسم المحاولة ومعرّفها نفسيهما. الإغلاق الآمن يسترجع
   العملية المكتملة إن وجدت، أو يسجل منعًا دائمًا لتنفيذ طلبها المتأخر.
   رفض الوصول لا يثبت عدم التنفيذ. سجل متصفح غير قابل للقراءة لا يُحذف
   تلقائيًا؛ يحتاج معالجة أدلة، وليس مسحًا يدويًا أثناء محاولة مجهولة.

## تحقق التطوير / Development checks

22 targeted PostgreSQL tests and13 UI tests passed before the final two
execution/closure barrier cases were added. These are targeted results only;
the release counts will come from a new complete run.

The first concurrency harness awaited a membership writer while retaining
the catalogue blocker. The existing database authority trigger correctly
waited behind the execution reader, creating a test-induced cycle. Partial
and failed logs are preserved separately. The corrected tests exercise both
real linearization orders without weakening the authority fence.

UI review found and fixed recovery controls hidden behind revoked-create
options, old-scope asynchronous results, and overly permissive closure reply
handling. Permanent tests cover these cases. Final outcomes to be appended.
