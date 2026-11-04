# حفظ تعديلات السلة المسترجعة / Durable edits to a resumed POS basket

## النتيجة العربية

أُنجز النطاق المطلوب، مع الحفاظ على تسليم `bbc14cf` وربط المسودة بورديتها ومنع بيع المصدر نفسه مرتين. لا تعديل على `main`، ولا نشر أو دفع حقيقي، ولا تغيير لمحرك الضرائب أو المخزون أو صلاحيات الخادم.

**المصدر المختبر والمرفوع:** [`94c053943ac086afec63fc340d971c40e7b17dbe`](https://github.com/Abdullah-Almutairi12/Hasiba/commit/94c053943ac086afec63fc340d971c40e7b17dbe)  
**الفرع:** `sync/hasiba-erp-20261023`  
**بصمة المصدر:** `1252ba83832c57496831fbd85d1daa740157bcf1ada1cfb16c7e8975bb2050c1`

### ما ثبت وما تغير

- قبل الإصلاح، أعادت الواجهة الأصلية بعد التحديث قطعتين للعميل أ، رغم تعديلها إلى ثلاث قطع لعميل آخر. أثبت طلب البيع الفعلي والقراءة المستقلة لقاعدة الاختبار القديمة صدور البيع بالقيم القديمة. أخفق اختبارا الانحدار للكمية/العميل وإزالة العميل قبل الإصلاح.
- أصبح كل تعديل مسموح للأصناف والكميات والعميل يُحفظ فورًا، مع إبقاء مرجع المسودة ووردية المصدر ودليل استرجاعها ثابتة. إزالة العميل تُحفظ صراحةً كبيع نقدي دون عميل مختار.
- عند فشل الكتابة أو عدم احتفاظ التخزين بالقيمة، تبقى أحدث التعديلات على الشاشة، وتظهر رسالة عربية، ويُحجب الدفع الجديد. زر «إعادة حفظ التعديلات» يحفظ أحدث نسخة. يظهر تحذير مغادرة أثناء وجود تعديلات غير محفوظة؛ لا نزعم إمكان استعادة بيانات رفض المتصفح كتابتها إذا فُرض إغلاقه.
- عند تحديث الصفحة، تستعاد السلة المعدلة، وتلزم معاينة الخادم ومراجعتها قبل التحصيل الجديد. أما محاولة دفع سبق إرسالها فتظل بمفتاحها وجسمها الأصليين، وتُعرض هوية عميلها، ولا تستبدلها نسخة عمل أحدث.

**الملفات البرمجية:** `artifacts/erp-system/src/hooks/use-pos-resumed-basket.ts` و`artifacts/erp-system/src/pages/pos-iconic.tsx`.  
**الاختبارات الدائمة:** `use-pos-resumed-basket.test.tsx` و`pos-iconic.test.tsx` في المجلدين نفسيهما؛ ست حالات جديدة. لم تُعد بناء خدمات الاسترجاع أو منع البيع المكرر.

### نتائج التشغيل الجديد

| الفحص | النتيجة الفعلية |
|---|---|
| بوابات المشروع، متضمنة الأنواع والبناء والتدقيق | 15/15؛ رمز الخروج 0 |
| API على PostgreSQL معزولة | 1275 ناجحًا، صفر فشل، اختبار واحد متجاوز |
| الواجهة | 487 ناجحًا، صفر فشل |
| الترقية المستقلة | اختبار ناجح؛ 38 حالة غير مختارة بمرشح الترقية |
| الفحوص الموجهة التمهيدية | 59 ناجحًا؛ مجموعة فرعية لا تُضاف للأعداد أعلاه |

الاختبار المتجاوز في مجموعة API هو اختبار الترقية التاريخية المشروط، وقد نُفّذ ونجح في بوابة الترقية المستقلة. صُحّحت أثناء إعداد اختبار الاسترداد عبارة متوقعة لتطابق الشارة القائمة «عميل العملية المحفوظة»؛ بقيت شروط الهوية والكمية وتطابق المفتاح والجسم وعدم التكرار صارمة.

التشغيل الكامل النهائي: **2026-11-04، 12:50:51.350–13:09:48.031 UTC**، أي **15:50:51–16:09:48 بتوقيت الرياض**. المصدر نظيف وثابت عند البداية والنهاية. API العرض والمتصفح والاختبارات تستخدم المصدر والبصمة أعلاه؛ ما يلي هذا المصدر من تقرير وذاكرة وأدلة ليس تعديلًا تنفيذيًا.

### الواجهة الأصلية والمصالحة المستقلة

بعد إعادة تشغيل بيئة العمل أُنشئت قاعدة اصطناعية جديدة، لا إعادة كتابة للتاريخ القديم. شركة الاختبار 4، الصنف 3، العميل أ=3، العميل ب=4، وردية المصدر=2. السعر 100 والتكلفة 50، والمنشأة غير مسجلة ضريبيًا في هذه التجربة.

| الحالة المستقلة | المصدر → البيع | الفاتورة / الدفعة | النتيجة |
|---|---|---|---|
| تعديل ثم تحديث، إزالة العميل ثم إعادته، فشل الحفظ، تبويب قديم | مسودة 1 → بيع 2 | فاتورة 2 / دفعة 1 | ثلاث وحدات لب، 300 ريال؛ المخزون 20→17 |
| فقد الرد بعد الحفظ ثم **تحديث حقيقي** واسترداد الطلب الأصلي | مسودة 3 → بيع 4 | فاتورة 3 / دفعة 2 | ثلاث وحدات لب، 300 ريال؛ المخزون 17→14 |

في الحالة الأولى لم يحدث تحديث بين فقد الرد والاسترداد؛ لذلك أُجريت الحالة الثانية المستقلة خصيصًا لإثبات ذلك، ولم يُعد وصف دليل الحالة الأولى. تغيّر `performance.timeOrigin` عند التحديث الحقيقي، وبقي سجل محاولة الدفع مطابقًا **بايتًا ببايت**، مع تطابق بصمتي المفتاح والجسم، وصفر إرسال تلقائي قبل الاسترداد.

التبويب القديم احتفظ بقطعتين للعميل أ وبمفتاح الاسترجاع نفسه؛ طلب دفعه بمفتاح مختلف أعاد البيع 2 مع `alreadyFinalized: true` ورسالة عدم التحصيل، دون بيع آخر. فشل حفظ تعديل الكمية إلى أربع وحدات أبقى الأربع ظاهرة، ومنع إرسال طلب تحصيل؛ نجحت إعادة الحفظ ثم استعادة الثلاث والعميل ب بعد التحديث. إزالة العميل بقيت `null` بعد التحديث.

القراءة المستقلة المباشرة أكدت **بيعًا وفاتورة ودفعة وصرف مخزون واحدًا لكل مصدر**، وعدم صدور فاتورة للعميل أ. لكل حالة: ضريبة صفر، نقد 300، ذمم صافية صفر، تكلفة 150، وثلاثة قيود متوازنة. بقيت الحالة الأولى ومستنداتها دون تغيير بعد الثانية. المخزون الختامي 14 بتكلفة 50 وقيمة 700، دون طبقات مكررة. نجح **34 تحققًا مستقلًا للحالة الأولى و33 للثانية**؛ لا تُجمع إلى أعداد API/UI.

لم تتغير بيانات الشركة الضابطة 2 ولا مجاميع الوردية الأخرى 3. **لم تُعد محاولة الدفع على الوردية الخطأ من المتصفح**؛ اختبارات PostgreSQL الدائمة `pos.resumed-sale.test.ts` نجحت مجددًا، بما فيها الوردية الأخرى، وتزامن مفتاحي دفع لنفس مفتاح الاسترجاع، والاسترداد بعد إغلاق وردية المصدر، ورفض دليل شركة أخرى.

### الأدلة والحدود

المجلد `generated-artifacts/pos-resumed-edits/` يحوي السجلات الخام ولقطات SQL والصور. الحزمة المنقحة `Hasiba-Resumed-Basket-Edits-Evidence.zip` تُسلّم عبر ملفات Replit/Library، **وليست ضمن Git**. التقرير والشيفرة موجودان في الفرع أعلاه.

- انقطع تشغيل أسبق بعد ست مراحل بسبب إعادة تشغيل بيئة العمل؛ لا رمز خروج أو نتيجة نهائية له. سُجل منفصلًا في `interrupted-20261104T1248/`، ثم نُفذ التشغيل الكامل الناجح أعلاه مرة واحدة، دون إعادة بعد نجاحه.
- فُقدت قاعدة الاختبار المؤقتة القديمة مع إعادة التشغيل؛ احتُفظ بأدلتها ولم تُختلق سجلاتها في القاعدة الجديدة. لم تُمس قاعدة تشغيلية أو بيانات عملاء.
- فقد الرد وفشل التخزين حُوكيا في المتصفح، بعد تثبيت البيع الحقيقي في PostgreSQL الاصطناعية. تحذير المغادرة اختُبر بحدث قابل للإلغاء، لا بانقطاع كهرباء. لا اختبار لأجهزة دفع أو طباعة ورقية أو إغلاق الجهاز؛ لا قبول ضريبي إنتاجي.
- رُصدت 502 في نافذة جانبية أثناء الأتمتة؛ لم يُثبت سببها. ظل تبويبا POS المستخدمان في الرحلة متاحين. لا يمثل هذا التسليم اختبار توفر شاملًا أو إعلان خلو النظام كله من الأخطاء.

## English summary

**Completed within scope.** Tested and confirmed code push: `94c053943ac086afec63fc340d971c40e7b17dbe`, branch `sync/hasiba-erp-20261023`, fingerprint `1252ba83832c57496831fbd85d1daa740157bcf1ada1cfb16c7e8975bb2050c1`. Baseline `bbc14cf` remains in its ancestry. Main and production were not changed.

The native pre-fix reproduction restored the original two units/customer A after the cashier had changed to three units/another customer. Two regression tests failed before the fix. Permitted cart/customer edits now persist synchronously while the draft identity, source shift and claim proof remain unchanged. Explicit customer removal survives reload. Failed or silently discarded writes retain the latest in-memory edits, show an Arabic warning, block fresh payment and offer a resave action. The browser warns before leaving unsaved work; rejected writes cannot be guaranteed to survive a forced browser shutdown.

A fresh server preview is reviewed before new payment. Once sent, the saved financial attempt—not a later working copy—remains authoritative with its exact original body/key. No backend accounting, tax, resume or source-finalization engine was replaced.

**New final verification:** 15/15 gates, exit 0; API 1275 passed/0 failed/1 skipped; UI 487 passed/0 failed. The conditionally skipped historical-upgrade case passed in the independent upgrade gate (1 selected pass, 38 filtered cases). The focused 59-pass set is a subset, not an additional total. Full run: **2026-11-04 12:50:51.350–13:09:48.031 UTC**. Source was clean and unchanged throughout, matching the isolated preview API and browser.

**Native acceptance on a fresh isolated PostgreSQL fixture:** company4, A3/B4, product3, source shift2:

1. Draft1 → order2/invoice2/payment1: three units/customer B survived reload, customer removal and storage-failure recovery. A stale two-unit/A tab, sharing the original resume proof but using a different payment key, received the existing order with an explicit no-new-collection notice.
2. Draft3 → order4/invoice3/payment2: an additional independent scenario explicitly covered a genuine reload **after** the committed 201 response was dropped. The authentic pending attempt remained byte-for-byte identical across reload, and recovery used the same body/key hashes. The first scenario did not reload between response loss and recovery; its evidence was not relabeled.

Independent read-only snapshots and exact-cent assertions confirmed one sale/invoice/tender/three-unit issue per source, no A invoice, 300 cash/zero net AR/150 COGS/zero VAT and three balanced journals per case. Stock moved 20→17→14 at unchanged average cost50; the first source's financial records remained unchanged. Company2 controls and the other shift's financial totals were unchanged. Separate assertion sets passed **34** and **33** checks; neither is added to API/UI totals.

The wrong-shift native denial was not repeated in this browser pass. Existing PostgreSQL regressions for wrong shift, same-claim concurrent payment keys, recovery after source closure and foreign-company proof all passed in the new full suite.

An earlier run lost its workspace after six completed stages and has no final exit status. Its partial logs remain separate from the successful new run. The old temporary browser database was not reconstructed; its evidence was preserved. Only synthetic databases were used. Fault injection simulated transport loss and storage failure; no real payments, hardware, power-loss recovery or production tax acceptance were tested. A side popup intermittently returned 502; its cause was not established, while the exercised POS tabs remained usable. No claim of whole-system defect freedom is made.

Sanitized logs, snapshots and screenshots are in the downloadable evidence ZIP in Replit/Library, excluded from Git. This bilingual report and the permanent regression tests are tracked in the stated branch.
