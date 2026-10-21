import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const load = (path) => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
};
export function writeVerificationReport(out, summary) {
  const tests = load(join(out, "tests.json"));
  const before = load(join(out, "audit-before.json"));
  const after = load(join(out, "audit-after.json"));
  const privacyBefore = load(join(out, "privacy-scan-before.json"));
  const privacyAfter = load(join(out, "privacy-scan-after.json"));
  const browser = load(join(out, "browser-results.json"));
  let modifiedFiles = "";
  try { modifiedFiles = readFileSync(join(out, "modified-files.txt"), "utf8"); } catch { /* Available after workspace diff capture. */ }
  const rows = summary.results.map((r) =>
    `<tr><td><code>${escape(r.name)}</code></td><td>${r.passed ? "نجح" : "فشل — يلزم مراجعة السجل"}</td><td>${escape(r.exitCode)}</td></tr>`).join("");
  const vulnerabilities = (data) => data?.metadata?.vulnerabilities ?? {};
  const counts = ["critical", "high", "moderate", "low"];
  const names = ["حرجة", "عالية", "متوسطة", "منخفضة"];
  const auditRows = counts.map((key, i) =>
    `<tr><td>${names[i]}</td><td>${escape(vulnerabilities(before)[key] ?? "غير متوفر")}</td><td>${escape(vulnerabilities(after)[key] ?? "غير متوفر")}</td></tr>`).join("");
  const advisories = Object.values(after?.advisories ?? {});
  const advisoryRows = advisories.map((a) =>
    `<tr><td><code>${escape(a.module_name)}</code></td><td>${escape(a.severity)}</td><td>${escape(a.title)}</td><td><a href="https://github.com/advisories/${escape(a.github_advisory_id)}">${escape(a.github_advisory_id)}</a></td><td><code>${escape(a.patched_versions)}</code></td></tr>`).join("");
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>حاسبة.AI — تقرير الإصلاح والتحقق</title>
<style>body{font:16px/1.9 system-ui,sans-serif;background:#f4f6fa;color:#162033;margin:0}main{max-width:1120px;margin:32px auto;background:white;padding:32px;border-radius:12px}h1,h2{line-height:1.5}h2{margin-top:36px;border-bottom:1px solid #ddd;padding-bottom:8px}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:14px}td,th{padding:9px;text-align:right;border:1px solid #ddd;vertical-align:top}th{background:#eef3fc}code{direction:ltr;unicode-bidi:embed;font-size:13px;overflow-wrap:anywhere}aside{padding:16px;border-right:4px solid #b76e00;background:#fff7e9}.scroll{overflow:auto}a{color:#184fc3}@media(max-width:700px){main{margin:0;padding:16px}}</style>
<main><h1>حاسبة.AI — تقرير الإصلاح والتحقق</h1><p>وقت إنشاء التقرير: <code>${escape(summary.at)}</code></p>
<aside><strong>هذا تقرير أدلة، وليس شهادة خلو من الأخطاء أو اعتمادًا أمنيًا أو تنظيميًا.</strong> فشل أي فحص مطلوب يمنع اجتياز بوابة التحقق. الفحوص المنفذة في بيئة تطوير معزولة، لا على بيانات الإنتاج.</aside>
<h2>1. الإصلاحات المنفذة وأسبابها</h2><ul>
<li><strong>ملكية الشركة:</strong> أُضيف معرّف الشركة الصحيح إلى أمر البيع المنعكس وبيانات الاختبارات، دون جعل الحقل اختياريًا. استعلامات مستندات المصدر والعملاء والموردين تقيد الشركة، مع استمرار التحقق من صلاحية مالية في الطرفين.</li>
<li><strong>المعاملات والتكرار:</strong> عمليات الانعكاس تستخدم معاملة عند غياب معاملة من المستدعي، وتقفل مستند المصدر لمنع إنشاء انعكاسين متزامنين. لا تُنسخ هوية منتج من شركة إلى أخرى؛ يحتفظ سطر الانعكاس بالوصف دون ربطه بمخزون شركة أخرى.</li>
<li><strong>تهيئة قاعدة فارغة:</strong> إصلاح إنشاء مستودع ووردية بلا معرّف شركة. إعدادات الشركة تُجهّز عند إنشاء الشركة بطلب مصرح، لا عند إعادة تشغيل التطبيق على كل الشركات الموجودة. استيراد المخزون القديم لا يعمل عبر الشركات بمجرد بدء الخدمة.</li>
<li><strong>عزل الاختبارات:</strong> لا يوجد رجوع تلقائي إلى DATABASE_URL في وضع الاختبار. الأمر test:isolated ينشئ عنقود PostgreSQL محليًا مؤقتًا، يبني المخطط ثم يزيل قاعدة الاختبار عند الانتهاء الطبيعي.</li>
<li><strong>تنظيف الاختبارات:</strong> إزالة الورديات الافتراضية التابعة للشركات التجريبية قبل حذف الشركات؛ لم تُضعف شروط الاختبارات.</li>
<li><strong>التسجيل الآمن:</strong> حجب حقول كلمات المرور والرموز والأجسام والقيم المالية المعروفة، وعدم تسجيل محتوى أخطاء SQL أو رسائلها الحرة. أُزيل طبع البريد من أداة التقاط الدليل. لكل طلب معرّف مولّد.</li>
<li><strong>الصحة:</strong> /api/healthz للحيوية و/api/readyz للوصول إلى قاعدة البيانات بعد التهيئة، مع عدم عرض تفاصيل الاتصال.</li>
</ul>
<h2>2. الأوامر ونتائجها الفعلية</h2>
<p><code>pnpm verify</code> يشغّل الفحص الكامل، و<code>pnpm test:isolated</code> الاختبارات المعزولة، و<code>pnpm typecheck</code> فحص الأنواع. لكل مرحلة سجل باسمها تحت <code>generated-artifacts/verification/</code>.</p>
<table><tr><th>المرحلة</th><th>النتيجة</th><th>رمز الخروج</th></tr>${rows}</table>
<p>نتائج تأكيدات الاختبارات: ${tests ? `الإجمالي <strong>${tests.numTotalTests}</strong>؛ ناجحة <strong>${tests.numPassedTests}</strong>؛ فاشلة <strong>${tests.numFailedTests}</strong>؛ معلقة/متجاوزة <strong>${tests.numPendingTests ?? 0}</strong>؛ مؤجلة TODO <strong>${tests.numTodoTests ?? 0}</strong>.` : "لا توجد نتيجة اختبارات كاملة لهذه الدورة؛ راجع tests.log."}</p>
<p>تتضمن الاختبارات الجديدة: رفض طرف غير مصرح، رفض شركة مصدر مزورة، صحة ملكية الانعكاس، تكرار طلبين متزامنين، التراجع عن معاملة فاشلة، حجب بيانات الأخطاء، ومسارات الصحة. نجاح تأكيدات الاختبار وحده لا يتجاوز فشل تجهيز أو تنظيف مجموعة اختبارات؛ حالة المرحلة هي المرجع.</p>
<h2>اختبار المتصفح بحسابات معزولة</h2>
<p>النتيجة المسجلة: <strong>${browser?.verdict === "success" ? "نجح الفحص المحدد" : "غير متوفر أو لم ينجح — راجع browser-results.json"}</strong>.</p>
<ul><li>دخول مالك تجريبي ثم فتح لوحة القيادة والمبيعات والمشتريات والمنتجات/المخزون والمعاملات بين الشركات.</li>
<li>إعادة تحميل صفحة محمية مع بقاء الجلسة، ثم الخروج والدخول بحساب مبيعات والتحقق من رفض الوصول المباشر إلى صفحة المعاملات بين الشركات.</li>
<li>الصفحات المالية المختبرة كانت في حالة بيانات فارغة؛ لم تُنشأ مبيعات أو مشتريات أو مرتجعات عبر المتصفح.</li>
<li>لم تُرصد استثناءات متصفح أو أخطاء خادم 5xx في هذه الجولة. ظهر مفتاح ترجمة غير مترجم <code>nav.intercompany</code> في القائمة، ولم يُصلح ضمن هذه الجولة.</li>
<li>أعيدت خدمة API إلى إعداداتها الأصلية بعد الاختبار؛ قاعدة المتصفح مؤقتة ولا تحتوي بيانات التطبيق.</li></ul>
<h2>3. مقارنة التنبيهات الأمنية</h2>
<p>الأرقام أدناه من فحص الاعتماديات قبل التغييرات وبعدها. لا تعني عدد طرق اختراق مؤكدة. توجد مهمة منفصلة لتحديث المكتبات؛ لا يُعتبر إصلاحها مطبقًا على هذا الفرع إلا بعد الدمج وإعادة الفحص.</p>
<table><tr><th>الخطورة</th><th>قبل</th><th>بعد</th></tr>${auditRows}</table>
<p>فحص الخصوصية: قبل ${escape(privacyBefore?.vulnerabilities?.length ?? "غير متوفر")}؛ بعد ${escape(privacyAfter?.vulnerabilities?.length ?? "غير متوفر")}. راجع static-scan-before.json لنتيجة الفحص الساكن الأولي؛ نتيجة بلا تنبيهات ليست إثباتًا لسلامة الصلاحيات.</p>
<details><summary>تفاصيل التنبيهات المتبقية ومراجعها الرسمية والإصدارات المصححة</summary><div class="scroll"><table><tr><th>المكتبة</th><th>الخطورة</th><th>الوصف</th><th>المرجع</th><th>الإصدارات المصححة</th></tr>${advisoryRows}</table></div></details>
<p>تمييز النطاق: Orval أداة توليد من مواصفات OpenAPI ويجب ألا تستقبل مواصفات غير موثوقة؛ Vite/Vitest/Babel أدوات تطوير وبناء. proxy-addr تصل إلى خادم Express، وNodemailer إلى البريد؛ يجب تقييم إعدادات الوكيل والمدخلات ومسارات التشغيل وعدم اعتبار كل تنبيه قابلًا للاستغلال تلقائيًا. إعداد الثقة بالوكيل الحالي قفزة واحدة؛ لم يُختبر مسار الوكيل الإنتاجي.</p>
<h2>4. آلية الفحص المستمر</h2><ul>
<li>verify ينفّذ كل المراحل المستقلة ويسجل الفشل؛ لا يتجاوز ثغرة أو اختبارًا فاشلًا.</li>
<li>GitHub Actions ينفذ الفحوص عند ربط المستودع وتشغيل أحداث PR/push؛ إعداد حماية الفرع مطلوب منفصلًا.</li>
<li>release:check هو أمر بوابة الإصدار، ومضاف إلى خطاف ما قبل بناء النشر. لا ينشر هذا العمل التطبيق.</li>
<li>تعليمات replit.md تلزم الوكيل بالتشخيص والإصلاح ثم إعادة الاختبار، والتوقف بعد ثلاث محاولات فاشلة للمشكلة نفسها. ليست خدمة إصلاح ذاتي مستمرة.</li>
</ul>
<h2>5. الملفات الأساسية المعدلة</h2><ul>
<li><code>artifacts/api-server/src/lib/intercompany-mirror.ts</code> واختباره الجديد؛ واختبارات consolidated-reports، tenant-http، vat-return، vat-threshold.</li>
<li><code>lib/db/src/index.ts</code>، <code>artifacts/api-server/vitest.config.ts</code>، وملفات <code>src/test/</code> وعمليات تنظيف الشركات في ملفات الاختبار.</li>
<li><code>artifacts/api-server/src/lib/inventory-init.ts</code> و<code>hr-init.ts</code>.</li>
<li><code>artifacts/api-server/src/lib/company-service.ts</code> لتجهيز إعدادات الشركة الجديدة صراحة بدل تعديل الشركات القائمة عند بدء الخدمة.</li>
<li><code>artifacts/api-server/src/lib/logger.ts</code> واختباره، <code>handle-error.ts</code>، <code>app.ts</code>، و<code>routes/health.ts</code> واختباره.</li>
<li><code>scripts/test-isolated.mjs</code>، <code>verify.mjs</code>، <code>verification-report.mjs</code>، <code>scripts/src/ensure-capture-user.ts</code>، <code>package.json</code>، <code>.github/workflows/verify.yml</code>، <code>.replit</code>، <code>replit.md</code> وملفات التجاهل.</li></ul>
${modifiedFiles ? `<details><summary>قائمة الملفات المعدلة والمضافة المسجلة في مساحة العمل</summary><pre dir="ltr" style="white-space:pre-wrap">${escape(modifiedFiles)}</pre></details>` : ""}
<h2>6. الحدود وما لم يُثبت بعد</h2><ul>
<li>سجل SQL وحده لا يجهز قاعدة فارغة: ظهر غياب products.company_id قبل ترحيل NOT NULL. تستخدم الاختبارات تعريف المخطط الحالي أولًا؛ هذه معالجة تجهيز للاختبار، وليست إصلاحًا أو إثباتًا لسلامة سجل الترحيلات المستقل.</li>
<li>تغطية اختبارات المتصفح تُوثّق في ملحق منفصل عند توفره. لا يُعد نجاح البناء أو صفحة الدخول اختبارًا للصفحات المحمية.</li>
<li>لم يُثبت اكتمال اختبار كل دورة البيع والشراء والمرتجعات والمخزون وتوازن جميع القيود. منع تكرار الانعكاس بين الشركات لا يثبت منع تكرار كل فواتير وقيود النظام.</li>
<li>لم تُختبر بوابات الدفع أو SMTP أو ZATCA أو الإنتاج أو الضغط أو استعادة بيانات فعلية. لم يتم نشر أو تعديل بيانات إنتاج.</li>
<li>فحوص SAST/الاعتماديات لا تغطي كل أخطاء التفويض؛ مهام عزل الشركات والصلاحيات المنفصلة ما زالت مهمة.</li></ul>
<h2>7. الاستعادة والتشغيل</h2><p>نسخة الكود المرجعية: <code>generated-artifacts/backups/code-before-repair.tar.gz</code>؛ ومعرّفها في <code>baseline-commit.txt</code>. تحتوي الكود المتتبع في نقطة البداية، لا قاعدة البيانات ولا أسرار البيئة ولا المرفقات غير المتتبعة. الملفات الناتجة مستبعدة من Git والنشر، وليست نسخة احتياطية دائمة خارج مساحة العمل.</p>
<p>للمقارنة الآمنة، استخرج الأرشيف في مجلد منفصل باستخدام <code>mkdir -p /tmp/hasba-code-review &amp;&amp; tar -xzf generated-artifacts/backups/code-before-repair.tar.gz -C /tmp/hasba-code-review</code>. لا تستخرج فوق مساحة عمل بها تغييرات. يمكن اختيار نقطة رجوع للكود من سجل نقاط الحفظ؛ استعادة البيانات إجراء منفصل يحتاج موافقة.</p>
</main></html>`;
  writeFileSync(join(out, "report-ar.html"), html);
}
