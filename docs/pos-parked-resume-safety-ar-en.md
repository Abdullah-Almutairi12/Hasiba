# تأمين فتح السلة المعلقة — Safe parked-basket resume

## النتيجة / Result

اكتمل الإصلاح والتحقق المحدد، دون تغيير main أو الإنتاج، مع حفظ `7edd66f`.
Completed within the requested scope; `7edd66f` and earlier deliveries are preserved.

- المستودع / Repository: `Abdullah-Almutairi12/Hasiba`.
- الفرع / Branch: `sync/hasiba-erp-20261023`.
- [الشيفرة المختبرة / Tested code](https://github.com/Abdullah-Almutairi12/Hasiba/commit/09f0fad719b8fe87492a2163c37e721df30e5a25).
- Source SHA-256: `b6527a36afa5048cab5b0014c013352276f15fe00826b8bb2d7c34dd60febc69`.
- API host and native browser used this source. No runtime changes followed verification.

## ما تغير / Changes

- حُفظت هوية الاستئناف ومحتواه قبل الإرسال، وتُستعاد النتيجة الأصلية بعد فقد الرد والتحديث.
- استُخدمت معاملات وإيصالات المحاولات القائمة لحفظ حذف المسودة ونتيجتها والتدقيق ذريًا.
- فُصل الإلغاء المتعمد عن الاستئناف. التنافس بمفتاحين لا يستهلك المسودة مرتين؛ المفتاح نفسه يعيد نتيجته؛ الجسم المختلف يرفض.
- السلة غير الفارغة تمنع إرسال طلب الاستئناف. الرد المتأخر لا يستبدل سلة أو عميلًا أحدث.
- التحقق الحي للشركة والفرع والكاشير والجهاز/المحطة والمسؤولية يطبق على القراءة والفتح والاسترجاع، ويعاد داخل التنفيذ بعد انتظار الأقفال.

The existing durable-attempt transaction now atomically records draft consumption and its
recoverable outcome. Explicit cancellation has a separate endpoint/state. Active or newer
baskets are not overwritten. Current source authority is checked server-side; knowing valid
draft/session IDs is insufficient. No schema migration, dependency or parallel permission/
accounting engine was introduced.

## اختبارات جديدة فعلية / Fresh execution

| Check | Result |
|---|---|
| Project gates, including types/builds/audit | 15/15 passed; exit 0 |
| API | 1271 passed, 0 failed, 1 skipped |
| UI | 479 passed, 0 failed |
| Independent historical upgrade | 1 passed; 38 filtered out |
| Targeted API subset | 26 passed |
| Targeted UI subset | 71 passed |
| Independent SQL reconciliation | 40 passed |

Full run: **2026-11-04 09:54:18.639–10:13:26.105 UTC**.
Source/fingerprint unchanged and tree clean at both ends. Subsets are not added to totals.
The single API skip is the historical-upgrade scenario run successfully by its separate gate;
the upgrade filter's 38 unselected scenarios are not 38 additional API skips.

قبل الإصلاح فشل اختبارا الواجهة لمنع استبدال A واستعادة B، واختبارا الخادم لإعادة
نتيجة الاستئناف وعزل الفرع. أثبتت POS الأصلية الحالتين. سجلات التطوير والأخطاء
الاختبارية والنوعية المصححة محفوظة منفصلة عن نتيجة التحقق النهائي.

Before-fix permanent regressions and native reproduction established both failures.
Development fixture/selector/type failures are retained separately from final acceptance.

## رحلة الواجهة والمصالحة / Native journey and reconciliation

- **A7×2 → B13:** صفر طلبات استئناف عند وجود A؛ بقيت السلة والعميل وB دون تغيير.
- **B13:** نقر مزدوج أرسل طلبًا واحدًا؛ إسقاط 200 بعد الحفظ، ثم تحديث واسترجاع بالمفتاح
  والجسم الأصليين، أعاد المسودة 13 للعميل 8 والصنف 11 بكمية 1.
- **B15:** تغيرت السلة إلى A أثناء تأخير الرد؛ بقيت A. بعد تعليقها استُرجعت B15.
- **B17:** تبويبان؛ تسليم واحد، ونتيجة عدم تسليم محفوظة للآخر، وظل فارغًا بعد التحديث.
- الشركة 13: الفواتير 2→2، الدفعات 2→2، الحركات 3→3، القيود 7→7، والأرصدة وبنود
  الأستاذ وطبقات التكلفة دون تغيير. لا أثر مالي أو مخزني جديد من الاستئناف.
- V2 الشركة 11: الأقسام المالية/المخزنية التسعة مطابقة للّقطة السابقة بقراءة مستقلة،
  والمخزون بقي 8. حُسم إنذار أولي لبصمات تمثيلات مختلفة بالمقارنة البنيوية، دون تعديل بيانات.

The native journey proved preservation, actual post-commit response-loss recovery,
late-response protection, and two-tab single delivery. Independent SQL found no new invoices,
payments, movements or journals. Existing company13 stock18×cost50=value900 was preserved;
V2 company11 remains at eight units.

## حدود الدليل / Evidence limits

- فقد الرد محاكاة في المتصفح بعد إثبات الحفظ، لا انقطاع شبكة مادي.
- الرفض خارج الشركة/الفرع/الكاشير وسحب السلطة بعد حاجز PostgreSQL حقيقي ثبت في API.
  لم تنفذ خطوة رفض إضافية من المتصفح لغياب هدف بديل آمن في بيانات رحلته.
- The browser tester's `unable` verdict concerns that additional alternate-scope browser step,
  not the successful core journey. PostgreSQL/API denial tests passed. Its initial V2 hash
  concern was subsequently resolved independently; the original tester record is preserved.
- لا أجهزة أو إنتاج أو دفع خارجي أو تفعيل ضريبي. يبقى `TAX_POLICY_NOT_READY`.
- No new hardware, production, external payment or tax acceptance is claimed.

## الأدلة / Evidence

`generated-artifacts/pos-resume-safe/` contains the AR/EN report, sanitized native records,
screenshots, raw before/after tests, final gate logs, run source/timestamps/exit, SQL snapshots,
`independent-assertions.json`, and `v2-independent-comparison.json`.
Generated evidence is ignored by Git and delivered separately as a downloadable ZIP;
the tracked report and code are synchronized to the branch above.
