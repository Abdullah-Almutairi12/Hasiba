export type Lang = "ar" | "en";

export interface Bi {
  ar: string;
  en: string;
}

export interface DocSection {
  heading: Bi;
  body: Bi;
}

export interface DocStep {
  /** Imperative action. Start with a verb. */
  action: Bi;
  /** What the user should see after the action (optional but recommended). */
  result?: Bi;
}

export interface DocFaq {
  q: Bi;
  a: Bi;
}

export interface DocCallout {
  kind: "note" | "tip" | "warning" | "best-practice";
  body: Bi;
}

export interface DocModule {
  slug: string;
  /** Stable position from the features-deck manifest. */
  position: number;
  title: Bi;
  summary: Bi;
  /** Path inside the ERP app this module documents (used by the screenshot capturer). */
  appPath: string | null;
  /** Role gating note shown next to the heading. */
  roles: string[];
  /** ISO date the module copy was last reviewed. */
  lastUpdated: string;
  /** "Before you begin" bullets. */
  prerequisites?: Bi[];
  /** Numbered, imperative procedure. Preferred over free-form sections. */
  steps?: DocStep[];
  /** Long-form sections for context that doesn't fit into steps. */
  sections?: DocSection[];
  /** Common real-world scenarios with their resolution. */
  scenarios?: { title: Bi; body: Bi }[];
  /** Callouts (note/tip/warning/best-practice) shown after the steps. */
  callouts?: DocCallout[];
  /** Quick troubleshooting / FAQ scoped to this module. */
  troubleshooting?: DocFaq[];
  /** Slugs of related modules. */
  related?: string[];
  /** Free-form tips kept for backward compatibility — renders as a tip callout. */
  tips?: Bi[];
  /**
   * Descriptive alt text for the module screenshot. Used by both the docs
   * UI (<img alt>) and the PDF export's accessibility tags. When omitted,
   * consumers should fall back to `summary`.
   */
  screenshotAlt?: Bi;
  /**
   * Numbered callouts overlaid on the module screenshot. Coordinates are
   * percentages (0–100) of the 1280×720 viewBox so the same data drives
   * the SVG generator, the docs legend, and the PDF legend.
   */
  hotspots?: DocHotspot[];
}

export interface DocHotspot {
  /** 1-based marker number drawn on the image. */
  n: number;
  /** 0–100 percentage along the X axis of the screenshot. */
  x: number;
  /** 0–100 percentage along the Y axis of the screenshot. */
  y: number;
  /** Short bilingual description of what this marker points at. */
  label: Bi;
}

export interface DocCategory {
  slug: string;
  title: Bi;
  modules: DocModule[];
}

export interface QuickStartStep {
  index: number;
  title: Bi;
  body: Bi;
  /** App path the user should be on at this step. */
  appPath: string;
  /** Estimated minutes to complete. */
  minutes: number;
}

export interface GlossaryTerm {
  /** Short anchor id (kebab-case). */
  id: string;
  term: Bi;
  definition: Bi;
  /** Optional links to related modules by slug. */
  seeAlso?: string[];
}

const M = (m: DocModule): DocModule => m;
const STAMP = "2026-05-27";

export const DOCS_VERSION = "2026.05.27";

// ───────────────────────────────────────────────────────────────────────────────
// QUICK START — 10-minute path from signup to first invoice.
// ───────────────────────────────────────────────────────────────────────────────
export const QUICK_START: QuickStartStep[] = [
  {
    index: 1,
    appPath: "/signup",
    minutes: 2,
    title: { ar: "أنشئ حساب الشركة", en: "Create the company account" },
    body: {
      ar: "املأ اسم الشركة، البريد الإلكتروني، كلمة سر قوية، ورقم الجوال. ستُنقل تلقائيًا إلى معالج الإعداد.",
      en: "Fill in the company name, email, a strong password, and a phone number. You will be moved to the setup wizard automatically.",
    },
  },
  {
    index: 2,
    appPath: "/onboarding",
    minutes: 3,
    title: { ar: "أنهِ معالج الإعداد", en: "Finish the setup wizard" },
    body: {
      ar: "اضبط الفرع الأول، طبيعة النشاط، حالة التسجيل الضريبي، وأضف منتجًا أو اثنين للبدء.",
      en: "Set the first branch, the business type, your VAT status, and add one or two products to get started.",
    },
  },
  {
    index: 3,
    appPath: "/products",
    minutes: 1,
    title: { ar: "أضف باقي المنتجات", en: "Add the rest of your products" },
    body: {
      ar: "افتح المنتجات وأضف ما يلزم بسرعة. يمكنك لاحقًا الاستيراد من CSV.",
      en: "Open Products and add what you need. You can bulk-import from CSV later.",
    },
  },
  {
    index: 4,
    appPath: "/pos",
    minutes: 2,
    title: { ar: "افتح جلسة بيع وسجِّل أول طلب", en: "Open a POS session and ring up the first order" },
    body: {
      ar: "اضغط «بدء جلسة جديدة»، اختر الفرع، أضف منتجًا للسلّة، ثم «دفع» — سيُطبع الإيصال مع رمز ZATCA QR.",
      en: "Click 'Start new session', pick the branch, add an item to the cart, then 'Pay' — the receipt prints with a ZATCA QR.",
    },
  },
  {
    index: 5,
    appPath: "/invoices",
    minutes: 2,
    title: { ar: "ارفع أول فاتورة مورد", en: "Upload your first supplier invoice" },
    body: {
      ar: "افتح الفواتير، التقط صورة الفاتورة، راجع الحقول المستخرجة بالذكاء الاصطناعي، ثم «تأكيد». ستُسجَّل القيود تلقائيًا.",
      en: "Open Invoices, capture an image, review the AI-extracted fields, then 'Confirm'. The accounting entries are posted automatically.",
    },
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// GLOSSARY
// ───────────────────────────────────────────────────────────────────────────────
export const GLOSSARY: GlossaryTerm[] = [
  {
    id: "zatca",
    term: { ar: "ZATCA / هيئة الزكاة", en: "ZATCA" },
    definition: {
      ar: "هيئة الزكاة والضريبة والجمارك السعودية. تُلزم المنشآت بإصدار فواتير إلكترونية متوافقة بالمرحلة الثانية وربط QR على الإيصال.",
      en: "Saudi Zakat, Tax and Customs Authority. Mandates Phase-2 e-invoicing compliance and a QR code on every receipt.",
    },
    seeAlso: ["accounting", "loyalty-zatca", "invoices"],
  },
  {
    id: "vat-threshold",
    term: { ar: "حد التسجيل في ضريبة القيمة المضافة", en: "VAT registration threshold" },
    definition: {
      ar: "إذا تجاوزت مبيعاتك خلال آخر 12 شهرًا 375,000 ر.س يجب التسجيل في ضريبة القيمة المضافة. يبدأ التسجيل الاختياري من 187,500 ر.س.",
      en: "If your rolling-12-month sales exceed SAR 375,000 you must register for VAT. Voluntary registration starts at SAR 187,500.",
    },
    seeAlso: ["vat-threshold", "vat-auto-hide"],
  },
  {
    id: "double-entry",
    term: { ar: "القيد المزدوج", en: "Double-entry bookkeeping" },
    definition: {
      ar: "كل عملية مالية تُسجَّل في حسابين على الأقل بقيمة متساوية: مدين ودائن. يضمن توازن الميزانية تلقائيًا.",
      en: "Every transaction posts to at least two accounts with equal debits and credits — keeping the books in balance automatically.",
    },
    seeAlso: ["accounting"],
  },
  {
    id: "vat-inputs",
    term: { ar: "ضريبة المدخلات", en: "Input VAT" },
    definition: {
      ar: "الضريبة التي دفعتها على مشترياتك ويمكن خصمها من الضريبة المستحقة على مبيعاتك عند تقديم الإقرار.",
      en: "The VAT you paid on purchases and can deduct from the VAT collected on sales when filing your return.",
    },
    seeAlso: ["invoices", "accounting"],
  },
  {
    id: "rolling-12",
    term: { ar: "Rolling 12 شهرًا", en: "Rolling 12 months" },
    definition: {
      ar: "نافذة متحركة تحسب آخر اثني عشر شهرًا اعتبارًا من اليوم الحالي. تستخدمها لوحة القيادة لمراقبة حدود الضريبة.",
      en: "A moving window covering the last twelve months from today. The dashboard uses it to track VAT thresholds.",
    },
  },
  {
    id: "nca-ecc",
    term: { ar: "ضوابط NCA ECC", en: "NCA ECC controls" },
    definition: {
      ar: "ضوابط الأمن السيبراني الأساسية الصادرة عن الهيئة الوطنية للأمن السيبراني. حاسبة.AI تطبّق منها سياسات كلمات السر، المصادقة الثنائية، وسجل التدقيق.",
      en: "Essential Cybersecurity Controls from the National Cybersecurity Authority. حاسبة.AI implements password policy, 2FA, and audit logging from this framework.",
    },
    seeAlso: ["branches-users", "roles-matrix"],
  },
  {
    id: "intercompany",
    term: { ar: "المعاملات بين الشركات", en: "Intercompany transactions" },
    definition: {
      ar: "عمليات بيع/شراء بين شركتين شقيقتين داخل المجموعة. النظام ينشئ مرآة تلقائية في الشركة المقابلة لضمان التطابق المحاسبي.",
      en: "Sales/purchases between two sibling companies in the same group. The system mirrors the document on the counterparty side automatically.",
    },
    seeAlso: ["intercompany"],
  },
  {
    id: "effective-discount",
    term: { ar: "الخصم الفعّال", en: "Effective discount" },
    definition: {
      ar: "مجموع كل أنواع الخصم على الطلب (يدوي + ولاء) كرقم واحد يُرسل للخادم ويُحفظ مع الطلب لضمان تطابق الإيصال مع الفاتورة.",
      en: "The total of all discounts on an order (manual + loyalty) as a single number sent to the backend, ensuring the receipt matches the persisted invoice.",
    },
    seeAlso: ["pos", "loyalty-zatca"],
  },
  {
    id: "audit-log",
    term: { ar: "سجل التدقيق", en: "Audit log" },
    definition: {
      ar: "سجل غير قابل للتعديل لكل عملية حساسة (تسجيل دخول، تغيير دور، إغلاق فترة، إلغاء قيد). يستخدمه المدقّق ودور auditor.",
      en: "An append-only log of every sensitive action (sign-in, role change, period close, journal void). Used by managers and the auditor role.",
    },
    seeAlso: ["branches-users", "admin-panel"],
  },
  {
    id: "parked-order",
    term: { ar: "طلب موقوف", en: "Parked order" },
    definition: {
      ar: "طلب في نقطة البيع تم وضعه جانبًا مؤقتًا (مثل عميل غادر السلسلة ليُحضر شيئًا) ويمكن استئنافه لاحقًا داخل نفس الجلسة.",
      en: "A POS order set aside temporarily (e.g. a customer stepped away). It can be resumed later within the same session.",
    },
    seeAlso: ["pos"],
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// FAQ (global)
// ───────────────────────────────────────────────────────────────────────────────
export const FAQ: DocFaq[] = [
  {
    q: { ar: "هل أحتاج إلى الاتصال بالإنترنت دائمًا؟", en: "Do I need a constant internet connection?" },
    a: {
      ar: "نعم لاستخدام نقطة البيع والفواتير الإلكترونية. تنبيهات انقطاع الإنترنت تظهر تلقائيًا، والطلبات المحلية تُحفظ ويعاد إرسالها عند عودة الاتصال.",
      en: "Yes for POS and e-invoicing. The app shows offline banners automatically, and local orders are buffered and re-sent when the connection returns.",
    },
  },
  {
    q: { ar: "كيف أبدّل اللغة بين العربية والإنجليزية؟", en: "How do I switch between Arabic and English?" },
    a: {
      ar: "اضغط زر اللغة في رأس الصفحة (يحوّل الواجهة وكامل الاتجاه RTL/LTR ويُحفظ اختيارك محليًا).",
      en: "Click the language button in the header. The whole UI flips RTL/LTR and your preference is stored locally.",
    },
  },
  {
    q: { ar: "هل بياناتي معزولة عن باقي العملاء؟", en: "Is my data isolated from other tenants?" },
    a: {
      ar: "نعم. كل صف في قاعدة البيانات مرتبط بـcompanyId، وكل استعلام يمرّ عبر scopedDb الذي يفرض العزل تلقائيًا. لا يمكن لمستخدمي شركة قراءة بيانات شركة أخرى.",
      en: "Yes. Every database row carries a companyId and every query passes through scopedDb, which enforces isolation automatically. Users in one company cannot read another company's data.",
    },
  },
  {
    q: { ar: "كيف أُصدّر تقريرًا إلى Excel؟", en: "How do I export a report to Excel?" },
    a: {
      ar: "من أي صفحة تقرير اضغط «تصدير» وتختار XLSX أو CSV. التصدير يحترم الفلاتر الحالية وتُحفظ السجلات في audit_logs.",
      en: "On any report page click 'Export' and pick XLSX or CSV. Export respects the current filters and the action is recorded in the audit log.",
    },
  },
  {
    q: { ar: "نسيت كلمة السر، ماذا أفعل؟", en: "I forgot my password. What do I do?" },
    a: {
      ar: "من /login اضغط «نسيت كلمة السر» وأدخل بريدك. سيُرسل النظام رابط إعادة تعيين صالحًا لمدة 30 دقيقة.",
      en: "On /login click 'Forgot password' and enter your email. The system sends a reset link valid for 30 minutes.",
    },
  },
  {
    q: { ar: "هل أستطيع تشغيل النظام على جوال؟", en: "Can I use the system on mobile?" },
    a: {
      ar: "نعم. كل الواجهات متجاوبة، والقائمة الجانبية تتحوّل إلى Drawer أقل من حجم md. POS يعمل أيضًا على التابلت بشكل ممتاز.",
      en: "Yes. Every screen is responsive — the sidebar becomes a Drawer below the md breakpoint. POS works particularly well on tablets.",
    },
  },
  {
    q: { ar: "كيف أضيف موظفًا جديدًا وأمنحه صلاحيات محدّدة؟", en: "How do I add a new employee with limited permissions?" },
    a: {
      ar: "من /users اضغط «مستخدم جديد»، أدخل البريد والاسم وحدّد الدور (cashier للكاشير، sales لفريق المبيعات، إلخ). الصلاحيات الافتراضية لكل دور موثَّقة في صفحة «الأدوار وحرّاس الصلاحيات».",
      en: "From /users click 'New user', enter email and name, and pick a role (cashier, sales, etc.). Default per-role permissions are documented in the 'Roles & Permission Guards' page.",
    },
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// MODULES (21)
// ───────────────────────────────────────────────────────────────────────────────
export const DOC_CATEGORIES: DocCategory[] = [
  {
    slug: "core",
    title: { ar: "المنصّة الأساسية", en: "Core Platform" },
    modules: [
      M({
        slug: "dashboard",
        position: 1,
        appPath: "/",
        roles: ["owner", "manager", "accountant"],
        lastUpdated: STAMP,
        title: { ar: "لوحة القيادة التنفيذية", en: "Executive Dashboard" },
        summary: {
          ar: "لوحة Glassmorphism داكنة تجمع مؤشرات المبيعات والتنبيهات الذكية ومؤشرات صحّة الأعمال وأداء الفروع في شاشة واحدة.",
          en: "A dark glassmorphism dashboard that surfaces AI insights, sales charts, business-health score, and per-branch performance in one view.",
        },
        prerequisites: [
          { ar: "تسجيل الدخول بدور مالك، مدير، أو محاسب.", en: "Signed in as owner, manager, or accountant." },
          { ar: "وجود بيانات مبيعات في آخر 7 أيام لظهور المخططات.", en: "Some sales data in the last 7 days for the charts to render." },
        ],
        steps: [
          {
            action: { ar: "افتح الجذر «/» — تفتح اللوحة افتراضيًا بعد تسجيل الدخول.", en: "Open '/' — the dashboard opens by default after sign-in." },
            result: { ar: "أربع بطاقات KPI أعلى الشاشة + رسم بياني للمبيعات.", en: "Four KPI cards at the top + the sales chart." },
          },
          {
            action: { ar: "اختر «أسبوعي»، «شهري»، أو «سنوي» من أعلى الرسم.", en: "Pick 'Weekly', 'Monthly', or 'Yearly' above the chart." },
            result: { ar: "يُعاد رسم المخطط بالفترة المختارة فورًا.", en: "The chart redraws for the selected window instantly." },
          },
          {
            action: { ar: "اضغط على أي تنبيه ذكي لعرض سببه ومصدر البيانات.", en: "Click any AI alert to see its underlying condition and data source." },
            result: { ar: "تظهر نافذة بتفاصيل التنبيه وزر «تجاهل مع تبرير».", en: "A drawer opens with alert details and a 'Dismiss with justification' button." },
          },
          {
            action: { ar: "مرّر للأسفل لمشاهدة بطاقة عدّاد ضريبة القيمة المضافة + جدول أداء الفروع.", en: "Scroll down to see the VAT threshold card + branch performance table." },
          },
        ],
        scenarios: [
          {
            title: { ar: "تنبيه مرتفع لكنه ليس مشكلة حقيقية", en: "An alert is firing but isn't a real problem" },
            body: {
              ar: "اضغط على التنبيه ← «تجاهل مع تبرير»، اكتب السبب وارفق PDF داعمًا. سيُسجَّل في audit_logs ولن يتكرر التنبيه نفسه لمدة 24 ساعة.",
              en: "Click the alert → 'Dismiss with justification', type the reason, and attach a supporting PDF. It's recorded in audit_logs and won't re-fire for 24 hours.",
            },
          },
        ],
        callouts: [
          {
            kind: "best-practice",
            body: {
              ar: "افتح اللوحة كل صباح خلال أوّل 5 دقائق من اليوم — مؤشّر صحّة الأعمال يظهر أكبر تغيّر مقارنة بأمس.",
              en: "Open the dashboard for 5 minutes every morning — the business-health indicator highlights the biggest change vs. yesterday.",
            },
          },
        ],
        troubleshooting: [
          {
            q: { ar: "الرسم البياني فارغ", en: "The chart is empty" },
            a: {
              ar: "تحقق من وجود طلبات POS أو فواتير مبيعات في الفترة المختارة. الرسم لا يظهر بيانات شركة أخرى.",
              en: "Verify there are POS orders or sales invoices in the selected period. The chart only shows your tenant's data.",
            },
          },
        ],
        related: ["pos", "reports", "vat-threshold", "smart-reports"],
      }),

      M({
        slug: "pos",
        position: 2,
        appPath: "/pos",
        roles: ["owner", "manager", "sales", "cashier"],
        lastUpdated: STAMP,
        title: { ar: "نقطة البيع (POS)", en: "Point of Sale (POS)" },
        summary: {
          ar: "واجهة كاشير سريعة بدعم الجلسات، الطلبات الموقوفة، نقاط الولاء، وعلامة ZATCA على الإيصال — متكيِّفة مع نشاطك (تجزئة/مطاعم).",
          en: "Fast cashier UI with sessions, parked orders, loyalty points, and a ZATCA receipt badge — adapts to your business type (retail / restaurant).",
        },
        prerequisites: [
          { ar: "فرع واحد على الأقل في /branches.", en: "At least one branch in /branches." },
          { ar: "منتجات بسعر بيع في /products.", en: "Products with sale price in /products." },
          { ar: "دور cashier أو أعلى.", en: "Role cashier or higher." },
        ],
        steps: [
          {
            action: { ar: "افتح /pos واضغط «بدء جلسة جديدة».", en: "Open /pos and click 'Start new session'." },
            result: { ar: "تفتح شاشة الكاشير مع رصيد افتتاحي للصندوق.", en: "The cashier screen opens with the till opening balance." },
          },
          {
            action: { ar: "أضف منتجات للسلّة بالمسح أو بالنقر من الشبكة.", en: "Add items to the cart by scanning or clicking the product grid." },
          },
          {
            action: { ar: "(اختياري) اربط عميلًا لتجميع نقاط الولاء.", en: "(Optional) Attach a customer to earn loyalty points." },
            result: { ar: "تظهر النقاط المتاحة وزر «استبدال».", en: "Available points appear with a 'Redeem' button." },
          },
          {
            action: { ar: "اضغط «دفع»، اختر طريقة الدفع، أكّد المبلغ.", en: "Click 'Pay', pick a payment method, confirm the amount." },
            result: { ar: "يُطبع الإيصال مع رمز ZATCA QR ويُرحَّل القيد تلقائيًا.", en: "The receipt prints with a ZATCA QR and the journal entry is posted automatically." },
          },
          {
            action: { ar: "لإيقاف طلب مؤقتًا، اضغط «إيقاف الطلب».", en: "To park an order temporarily, click 'Park order'." },
            result: { ar: "ينتقل الطلب إلى قائمة الموقوفة ويصبح الكاشير حرًّا لبدء طلب جديد.", en: "The order moves to the parked list and the cashier is free to start a new one." },
          },
          {
            action: { ar: "لاستئناف طلب موقوف، افتح «الطلبات الموقوفة» واضغط «استئناف».", en: "To resume a parked order, open 'Parked orders' and click 'Resume'." },
          },
        ],
        scenarios: [
          {
            title: { ar: "عميل يطلب فاتورة ضريبية باسم منشأته", en: "Customer asks for a tax invoice in their company name" },
            body: {
              ar: "اضغط «فاتورة ضريبية» قبل الدفع، أدخل اسم المنشأة والرقم الضريبي، ثم أكمل. ستُصدر فاتورة B2B مع QR وامتثال ZATCA المرحلة 2.",
              en: "Click 'Tax invoice' before paying, fill the company name and VAT number, then continue. A B2B invoice is issued with QR and ZATCA Phase-2 compliance.",
            },
          },
          {
            title: { ar: "خطأ في كميّة بنود الطلب بعد الدفع", en: "Wrong quantity on a paid order" },
            body: {
              ar: "اطلب من المدير «إلغاء الطلب». يُنشأ قيد عكسي تلقائيًا ويُسترجَع المخزون.",
              en: "Ask a manager to 'Void order'. A reversing journal is posted automatically and stock is restored.",
            },
          },
        ],
        callouts: [
          {
            kind: "tip",
            body: {
              ar: "اربط ماسح باركود USB — تُكشف تلقائيًا، ولا حاجة لإعدادات إضافية.",
              en: "Plug in a USB barcode scanner — it is detected automatically with no extra setup.",
            },
          },
          {
            kind: "warning",
            body: {
              ar: "لا يمكن إغلاق جلسة فيها طلبات موقوفة. أنهِها أو ألغِها أولًا.",
              en: "You cannot close a session that still has parked orders. Finish or void them first.",
            },
          },
        ],
        troubleshooting: [
          {
            q: { ar: "زر «دفع» معطَّل", en: "The 'Pay' button is disabled" },
            a: {
              ar: "السلة فارغة، أو الجلسة لم تُفتح، أو طريقة الدفع المحدّدة غير مفعّلة في إعدادات الفرع.",
              en: "The cart is empty, the session is closed, or the selected payment method is disabled for this branch.",
            },
          },
        ],
        related: ["inventory", "customers", "loyalty-zatca"],
      }),

      M({
        slug: "inventory",
        position: 3,
        appPath: "/products",
        roles: ["owner", "manager", "inventory"],
        lastUpdated: STAMP,
        title: { ar: "المنتجات والمخزون", en: "Products & Inventory" },
        summary: {
          ar: "إدارة كاملة للمنتجات والفئات ومستويات المخزون مع تنبيهات النقص وقواعد إعادة الطلب.",
          en: "Full product, category, and stock-level management with low-stock alerts and reorder rules.",
        },
        prerequisites: [
          { ar: "مستودع واحد على الأقل في /warehouses.", en: "At least one warehouse in /warehouses." },
        ],
        steps: [
          {
            action: { ar: "افتح /products واضغط «منتج جديد».", en: "Open /products and click 'New product'." },
          },
          {
            action: { ar: "عبّئ الاسم، الفئة، الباركود، سعر البيع، تكلفة الشراء، والمخزون الافتتاحي.", en: "Fill in name, category, barcode, sale price, purchase cost, and opening stock." },
          },
          {
            action: { ar: "حدّد «حد إعادة الطلب» لإطلاق التنبيه عند النقص.", en: "Set the 'Reorder threshold' to trigger a low-stock alert." },
          },
          {
            action: { ar: "اضغط «حفظ».", en: "Click 'Save'." },
            result: { ar: "يظهر المنتج في قائمة /products وعلى شاشة الكاشير فورًا.", en: "The product appears in /products and on the cashier screen immediately." },
          },
        ],
        scenarios: [
          {
            title: { ar: "استيراد كتالوج كامل من Excel", en: "Bulk-import a catalogue from Excel" },
            body: {
              ar: "افتح /products → «استيراد CSV». نزّل القالب، عبّئه، ثم ارفعه. ستظهر معاينة قبل التأكيد.",
              en: "Open /products → 'Import CSV'. Download the template, fill it, then upload. A preview appears before confirmation.",
            },
          },
        ],
        callouts: [
          {
            kind: "best-practice",
            body: {
              ar: "استخدم فئات (categories) متّسقة — لأنها تُستعمل في تقارير المبيعات وتحليلات Top-N.",
              en: "Use consistent categories — they drive sales reports and Top-N analytics.",
            },
          },
        ],
        troubleshooting: [
          {
            q: { ar: "المنتج لا يظهر في POS", en: "Product doesn't appear in POS" },
            a: {
              ar: "تأكد من وجود سعر بيع > 0 وأن المنتج ليس archived. تحقق أيضًا من تخصيصه للفرع/المستودع المرتبط بالجلسة.",
              en: "Verify a sale price > 0 and that the product is not archived. Also check it is allocated to the branch/warehouse linked to the session.",
            },
          },
        ],
        related: ["pos", "reports"],
      }),

      M({
        slug: "customers",
        position: 4,
        appPath: "/customers",
        roles: ["owner", "manager", "sales", "cashier"],
        lastUpdated: STAMP,
        title: { ar: "العملاء", en: "Customers" },
        summary: {
          ar: "ملف عميل موحَّد يجمع المعلومات الأساسية، سجل الطلبات، نقاط الولاء، وحدود الائتمان.",
          en: "Unified customer profile with contact info, order history, loyalty points, and credit limits.",
        },
        prerequisites: [
          { ar: "دور cashier أو أعلى.", en: "Role cashier or higher." },
        ],
        steps: [
          {
            action: { ar: "افتح /customers واضغط «عميل جديد».", en: "Open /customers and click 'New customer'." },
          },
          {
            action: { ar: "أدخل الاسم، الجوال، البريد، والرقم الضريبي إن وُجد.", en: "Enter name, phone, email, and VAT number if any." },
          },
          {
            action: { ar: "اختياري: اضبط حد الائتمان وتاريخ الميلاد للعروض.", en: "Optional: set a credit limit and date of birth for promos." },
          },
          {
            action: { ar: "اختياري: اربط شركة شقيقة لتفعيل الانعكاس بين الشركات.", en: "Optional: link a sibling company to enable the intercompany mirror." },
          },
          {
            action: { ar: "اضغط «حفظ».", en: "Click 'Save'." },
          },
        ],
        scenarios: [
          {
            title: { ar: "البحث عن عميل أثناء البيع", en: "Looking up a customer during a sale" },
            body: {
              ar: "من شاشة POS اضغط أيقونة «عميل» ثم اكتب الجوال أو الاسم — يظهر الاقتراح فورًا.",
              en: "From POS click the 'Customer' icon and type a phone or name — suggestions appear instantly.",
            },
          },
        ],
        callouts: [
          {
            kind: "note",
            body: {
              ar: "حقل الجوال يجب أن يبدأ بـ+966 ليُستخدم في رسائل واتساب التسويقية.",
              en: "The phone field must start with +966 to be usable in WhatsApp marketing messages.",
            },
          },
        ],
        related: ["pos", "loyalty-zatca", "intercompany"],
      }),
    ],
  },

  {
    slug: "accounting",
    title: { ar: "المحاسبة والتقارير", en: "Accounting & Reporting" },
    modules: [
      M({
        slug: "accounting",
        position: 5,
        appPath: "/accounting",
        roles: ["owner", "manager", "accountant"],
        lastUpdated: STAMP,
        title: { ar: "المحاسبة والامتثال", en: "Accounting & Compliance" },
        summary: {
          ar: "محاسبة بالقيد المزدوج، شجرة حسابات، فترات مالية، تكامل ZATCA المرحلة 2.",
          en: "Double-entry accounting, chart of accounts, fiscal periods, and ZATCA Phase 2 integration.",
        },
        prerequisites: [
          { ar: "شجرة حسابات منشأة (تُولَّد افتراضيًا في /onboarding).", en: "Chart of accounts initialised (auto-seeded in /onboarding)." },
          { ar: "فترة مالية مفتوحة.", en: "An open fiscal period." },
        ],
        steps: [
          {
            action: { ar: "افتح /accounting ← «قيود يومية» ← «قيد جديد».", en: "Open /accounting → 'Journal entries' → 'New entry'." },
          },
          {
            action: { ar: "اختر التاريخ والمرجع.", en: "Pick the date and reference." },
          },
          {
            action: { ar: "أضف أسطر مدين/دائن متوازنة (المجموع يجب أن يساوي صفرًا).", en: "Add balanced debit/credit lines (totals must net to zero)." },
          },
          {
            action: { ar: "اضغط «حفظ» للحفظ كمسودّة، ثم «ترحيل» للقفل النهائي.", en: "Click 'Save' for draft, then 'Post' to lock it." },
            result: { ar: "بعد الترحيل لا يمكن التعديل — أنشئ قيدًا عكسيًا للتصحيح.", en: "Once posted, edits are blocked — create a reversing entry to correct." },
          },
        ],
        scenarios: [
          {
            title: { ar: "إغلاق فترة محاسبية", en: "Closing a fiscal period" },
            body: {
              ar: "من /accounting-periods اختر الفترة، تحقق من القيود المعلّقة، اضغط «إغلاق». لا يمكن إعادة فتحها دون صلاحية owner.",
              en: "From /accounting-periods pick the period, verify pending entries, click 'Close'. Re-opening requires owner privileges.",
            },
          },
        ],
        callouts: [
          {
            kind: "warning",
            body: {
              ar: "لا تُلغِ قيدًا مُرحَّلًا يدويًا من قاعدة البيانات — استخدم زر «قيد عكسي» للحفاظ على مسار التدقيق.",
              en: "Never delete a posted entry directly from the database — use the 'Reverse' button to preserve the audit trail.",
            },
          },
        ],
        troubleshooting: [
          {
            q: { ar: "زر «ترحيل» معطَّل", en: "'Post' button is disabled" },
            a: {
              ar: "البنود غير متوازنة، أو الفترة المالية مغلقة، أو دورك ليس accountant فأعلى.",
              en: "Lines aren't balanced, the period is closed, or your role is below accountant.",
            },
          },
        ],
        related: ["invoices", "reports", "vat-threshold"],
      }),

      M({
        slug: "invoices",
        position: 6,
        appPath: "/invoices",
        roles: ["owner", "manager", "accountant"],
        lastUpdated: STAMP,
        title: { ar: "فواتير الموردين بالذكاء الاصطناعي", en: "Supplier Invoices (AI)" },
        summary: {
          ar: "وكيل مسح فواتير الموردين يلتقط الصورة، يستخرج الحقول بالذكاء الاصطناعي، ويرحّلها بنقرة واحدة.",
          en: "AI invoice-scanner agent: capture an image, extract fields with AI, and post in one click.",
        },
        prerequisites: [
          { ar: "كاميرا للجهاز أو ملف JPG/PNG/WEBP حتى 20MB.", en: "A device camera or a JPG/PNG/WEBP file up to 20MB." },
          { ar: "دور accountant أو manager.", en: "Role accountant or manager." },
        ],
        steps: [
          {
            action: { ar: "افتح /invoices ← «مسح بالكاميرا» أو ارفع صورة.", en: "Open /invoices → 'Scan with camera' or upload an image." },
          },
          {
            action: { ar: "انتظر بضع ثوانٍ بينما يستخرج الذكاء الاصطناعي البيانات.", en: "Wait a few seconds while the AI extracts the data." },
            result: { ar: "تظهر الحقول: اسم المورد، الرقم، التاريخ، البنود، الإجمالي، الضريبة.", en: "The fields appear: supplier, number, date, lines, total, VAT." },
          },
          {
            action: { ar: "راجع كل حقل وعدّل ما يلزم — انقر بند المنتج لربطه بمنتج موجود.", en: "Review each field and correct as needed — click a line to bind it to an existing product." },
          },
          {
            action: { ar: "اضغط «تأكيد».", en: "Click 'Confirm'." },
            result: {
              ar: "يُسجَّل القيد (مدين مخزون + ضريبة مدخلات / دائن موردين) ويُحدَّث المخزون.",
              en: "The entry (Dr Inventory + Dr VAT-In / Cr Suppliers) is posted and stock is updated.",
            },
          },
        ],
        scenarios: [
          {
            title: { ar: "بند جديد غير موجود في كتالوج المنتجات", en: "Line item not in your product catalogue" },
            body: {
              ar: "اترك «منتج جديد» محدّدًا — سيُنشَأ تلقائيًا تحت فئة «غير مصنّف» بسعر التكلفة من الفاتورة.",
              en: "Leave 'New product' checked — it will be auto-created under the 'Uncategorised' category at the invoice cost price.",
            },
          },
        ],
        callouts: [
          {
            kind: "tip",
            body: {
              ar: "جودة الإضاءة وعدم انعكاس الفلاش يرفعان دقة الاستخراج فوق 95٪.",
              en: "Good lighting and avoiding flash glare push extraction accuracy above 95%.",
            },
          },
          {
            kind: "note",
            body: {
              ar: "حد المسح: 15 طلبًا/15 دقيقة لكل مستخدم.",
              en: "Scan rate limit: 15 requests per 15 minutes per user.",
            },
          },
        ],
        troubleshooting: [
          {
            q: { ar: "الاستخراج أعاد قيمًا فارغة", en: "Extraction returned blank fields" },
            a: {
              ar: "الصورة ضبابية أو الفاتورة بلغة غير مدعومة. التقط صورة جديدة بإضاءة أوضح أو ارفع PDF ممسوح ضوئيًا.",
              en: "Image is blurry or the invoice is in an unsupported language. Re-shoot with better lighting or upload a scanned PDF.",
            },
          },
        ],
        related: ["accounting", "inventory"],
      }),

      M({
        slug: "reports",
        position: 7,
        appPath: "/reports",
        roles: ["owner", "manager", "accountant", "auditor"],
        lastUpdated: STAMP,
        title: { ar: "التقارير والتحليلات", en: "Reports & Analytics" },
        summary: {
          ar: "مكتبة تقارير جاهزة، باني تقارير مرن، وحفظ المفضّلة للوصول السريع.",
          en: "Ready report library, a flexible report builder, and saved-favorites for fast access.",
        },
        prerequisites: [
          { ar: "بيانات سابقة في الوحدات المرتبطة (POS، فواتير، قيود).", en: "Historical data in the related modules (POS, invoices, journal)." },
        ],
        steps: [
          {
            action: { ar: "افتح /reports — استعرض المكتبة الجاهزة.", en: "Open /reports — browse the ready library." },
          },
          {
            action: { ar: "لتقرير مخصّص: /reports-builder ← اختر مصدر البيانات.", en: "For a custom report: /reports-builder → pick a data source." },
          },
          {
            action: { ar: "أضف الأعمدة والفلاتر والترتيب.", en: "Add columns, filters, and sort." },
          },
          {
            action: { ar: "اضغط «تشغيل» للمعاينة، ثم «حفظ» لإعادة استخدامه.", en: "Click 'Run' to preview, then 'Save' to re-use." },
            result: { ar: "يظهر التقرير في /reports-saved مع زر تصدير XLSX/CSV/PDF.", en: "Appears in /reports-saved with XLSX/CSV/PDF export buttons." },
          },
        ],
        callouts: [
          {
            kind: "best-practice",
            body: {
              ar: "احفظ تقاريرك المتكرّرة كمفضّلة — سيحصل المدير على رابط مباشر بدلًا من إعادة بنائها كل مرة.",
              en: "Save recurring reports as favorites — managers get a direct link instead of rebuilding them each time.",
            },
          },
        ],
        related: ["accounting", "smart-reports", "dashboard"],
      }),
    ],
  },

  {
    slug: "ai",
    title: { ar: "الذكاء الاصطناعي", en: "Artificial Intelligence" },
    modules: [
      M({
        slug: "smart-reports",
        position: 8,
        appPath: "/anomalies",
        roles: ["owner", "manager", "accountant"],
        lastUpdated: STAMP,
        title: { ar: "التقارير الذكية وكشف الاحتيال", en: "Smart Reports & Fraud Detection" },
        summary: {
          ar: "مساعد ذكي يجيب على أسئلة الأعمال بلغة طبيعية + جدول كشف شذوذ يبرز الطلبات المشبوهة.",
          en: "An AI assistant that answers business questions in plain language + an anomaly table that highlights suspicious orders.",
        },
        prerequisites: [
          { ar: "بيانات مبيعات لآخر 30 يومًا على الأقل لتدريب z-score.", en: "At least 30 days of sales data for the z-score baseline." },
        ],
        steps: [
          {
            action: { ar: "افتح /admin ← تبويب «المساعد الذكي».", en: "Open /admin → 'AI Assistant' tab." },
          },
          {
            action: { ar: "اطرح سؤالًا (مثلاً: «أعلى 5 منتجات مبيعًا الشهر الماضي؟»).", en: "Ask a question (e.g. 'Top 5 best-selling products last month?')." },
            result: { ar: "تظهر إجابة نصّية مدعومة ببيانات شركتك الحيّة.", en: "A text answer grounded in your tenant's live data appears." },
          },
          {
            action: { ar: "افتح /anomalies للاطلاع على الطلبات المرشَّحة كاحتيالية.", en: "Open /anomalies to see orders flagged as suspicious." },
          },
        ],
        callouts: [
          {
            kind: "note",
            body: {
              ar: "حد المساعد: 30 طلب/15 دقيقة لكل IP. الإجابات لا تتجاوز بيانات شركتك.",
              en: "Assistant rate limit: 30 requests per 15 minutes per IP. Answers never cross tenant boundaries.",
            },
          },
        ],
        related: ["ai-models", "reports"],
      }),

      M({
        slug: "ai-models",
        position: 9,
        appPath: "/admin",
        roles: ["owner", "manager"],
        lastUpdated: STAMP,
        title: { ar: "نماذج الذكاء الاصطناعي الخمسة", en: "Five AI Models" },
        summary: {
          ar: "خمسة نماذج: تنبؤ المبيعات، تسرّب العملاء، كشف الاحتيال، توصيات المنتجات، المساعد الذكي.",
          en: "Five models: sales forecast, customer churn, fraud detection, product recommendations, AI assistant.",
        },
        prerequisites: [
          { ar: "دور manager أو owner.", en: "Role manager or owner." },
        ],
        steps: [
          {
            action: { ar: "افتح /admin ← تبويب «نماذج AI».", en: "Open /admin → 'AI Models' tab." },
          },
          {
            action: { ar: "اضغط «تدريب الكل» أو «تدريب» لنموذج واحد.", en: "Click 'Train all' or 'Train' on a single model." },
            result: { ar: "تُحدَّث المعاملات في ai_models.parameters ويُعرض timestamp جديد.", en: "Parameters in ai_models.parameters update and a new timestamp is shown." },
          },
          {
            action: { ar: "افتح صفحة التنبؤات لاختبار النموذج فورًا.", en: "Open the predictions page to test the model immediately." },
          },
        ],
        callouts: [
          {
            kind: "best-practice",
            body: {
              ar: "أعد التدريب أسبوعيًا للنماذج الإحصائية (forecast/churn/fraud). LLM لا يحتاج تدريبًا.",
              en: "Retrain the statistical models (forecast/churn/fraud) weekly. The LLM doesn't need training.",
            },
          },
        ],
        related: ["smart-reports", "admin-panel"],
      }),
    ],
  },

  {
    slug: "compliance",
    title: { ar: "الامتثال والأمان", en: "Compliance & Security" },
    modules: [
      M({
        slug: "branches-users",
        position: 10,
        appPath: "/branches",
        roles: ["owner", "manager"],
        lastUpdated: STAMP,
        title: { ar: "الفروع والمستخدمون والإعدادات", en: "Branches, Users & Settings" },
        summary: {
          ar: "إدارة متعددة الفروع، مستخدمين بصلاحيات، وإعدادات الأمان وفق ضوابط NCA ECC.",
          en: "Multi-branch ops, role-based users, and NCA-ECC-aligned security settings.",
        },
        prerequisites: [
          { ar: "دور manager أو owner.", en: "Role manager or owner." },
        ],
        steps: [
          {
            action: { ar: "افتح /branches ← «فرع جديد».", en: "Open /branches → 'New branch'." },
          },
          {
            action: { ar: "أدخل الاسم، العنوان، المستودع الافتراضي، ساعات العمل.", en: "Enter name, address, default warehouse, working hours." },
          },
          {
            action: { ar: "اضغط «حفظ» — سيظهر الفرع في خيارات جلسات POS.", en: "Click 'Save' — the branch appears in POS session options." },
          },
        ],
        scenarios: [
          {
            title: { ar: "نقل مخزون بين فرعين", en: "Moving stock between branches" },
            body: {
              ar: "افتح /transfers، اختر «نقل جديد»، حدّد الفرع المصدر والوجهة، أضف بنود ثم «إرسال». يُؤكَّد الاستلام من الفرع الآخر لاحقًا.",
              en: "Open /transfers, click 'New transfer', pick source and destination branches, add lines, then 'Send'. The destination branch confirms receipt later.",
            },
          },
        ],
        related: ["roles-matrix", "admin-panel"],
      }),

      M({
        slug: "roles-matrix",
        position: 11,
        appPath: "/users",
        roles: ["owner", "manager"],
        lastUpdated: STAMP,
        title: { ar: "الأدوار وحرّاس الصلاحيات", en: "Roles & Permission Guards" },
        summary: {
          ar: "ثمانية أدوار محميَّة بأربعة عشر حارسًا على الخادم ومرآة على الواجهة، وفق نموذج Odoo/Zoho/SAP.",
          en: "Eight roles protected by fourteen server guards and mirrored on the frontend, following Odoo/Zoho/SAP patterns.",
        },
        prerequisites: [
          { ar: "دور owner لإسناد دور owner لآخر؛ manager للأدوار الأخرى.", en: "Owner role to assign 'owner'; manager for any other role." },
        ],
        steps: [
          {
            action: { ar: "افتح /users، حدّد المستخدم.", en: "Open /users, pick a user." },
          },
          {
            action: { ar: "اختر الدور من القائمة: owner، manager، accountant، sales، cashier، inventory، marketing، auditor.", en: "Pick a role: owner, manager, accountant, sales, cashier, inventory, marketing, or auditor." },
          },
          {
            action: { ar: "احفظ.", en: "Save." },
            result: { ar: "تُحدَّث القائمة الجانبية والصلاحيات للمستخدم فور تسجيل دخوله التالي.", en: "Sidebar and permissions refresh for the user on next sign-in." },
          },
        ],
        scenarios: [
          {
            title: { ar: "مدقّق خارجي يحتاج وصولًا للقراءة فقط", en: "External auditor needs read-only access" },
            body: {
              ar: "أنشئ مستخدمًا بدور auditor — سيرى التقارير وسجل التدقيق دون أي زر «حفظ» أو «حذف».",
              en: "Create a user with role auditor — they will see reports and the audit log without any 'Save' or 'Delete' buttons.",
            },
          },
        ],
        callouts: [
          {
            kind: "warning",
            body: {
              ar: "لا يمكن إنزال آخر owner إلى دور أقل — يجب ترقية مستخدم آخر إلى owner أولًا.",
              en: "You cannot demote the last owner — promote another user to owner first.",
            },
          },
        ],
        related: ["branches-users", "admin-panel"],
      }),

      M({
        slug: "loyalty-zatca",
        position: 12,
        appPath: "/pos",
        roles: ["owner", "manager", "cashier"],
        lastUpdated: STAMP,
        title: { ar: "برامج الولاء وعلامة ZATCA", en: "Loyalty Programs & ZATCA Badge" },
        summary: {
          ar: "نقاط ولاء داخل السلة تُحوَّل إلى خصم، مع شارة توافق ZATCA على الإيصال ورمز QR صالح.",
          en: "In-cart loyalty points convert to discounts, with a ZATCA-compliant badge and a valid QR on the receipt.",
        },
        prerequisites: [
          { ar: "تفعيل برنامج الولاء من /settings.", en: "Loyalty program enabled in /settings." },
          { ar: "العميل مسجَّل في /customers.", en: "Customer registered in /customers." },
        ],
        steps: [
          {
            action: { ar: "في POS اربط العميل بالطلب.", en: "In POS, attach the customer to the order." },
            result: { ar: "تظهر النقاط المتاحة وزر «استبدال».", en: "Available points appear with a 'Redeem' button." },
          },
          {
            action: { ar: "اضغط «استبدال» وحدّد عدد النقاط.", en: "Click 'Redeem' and choose how many points to spend." },
          },
          {
            action: { ar: "أكمل الدفع — يُضاف الخصم إلى effectiveDiscount ويُحفظ مع الطلب.", en: "Complete payment — the discount is added to effectiveDiscount and persisted with the order." },
            result: { ar: "الإيصال يطابق ما عرضته الشاشة بالضبط، مع QR ZATCA صالح.", en: "The receipt matches the screen total exactly, with a valid ZATCA QR." },
          },
        ],
        callouts: [
          {
            kind: "note",
            body: {
              ar: "كل 100 نقطة = 1 ر.س افتراضيًا — يمكن تعديل المعدّل من /settings.",
              en: "Default: 100 points = SAR 1 — adjust the rate in /settings.",
            },
          },
        ],
        related: ["pos", "customers"],
      }),
    ],
  },

  {
    slug: "growth",
    title: { ar: "النمو والإدارة", en: "Growth & Administration" },
    modules: [
      M({
        slug: "intercompany",
        position: 13,
        appPath: "/intercompany",
        roles: ["owner", "manager", "accountant"],
        lastUpdated: STAMP,
        title: { ar: "المعاملات بين الشركات", en: "Intercompany Transactions" },
        summary: {
          ar: "انعكاس تلقائي لفواتير المبيعات وأوامر الشراء بين شركات شقيقة، مع روابط قابلة للإلغاء وإعادة المزامنة.",
          en: "Automatic mirroring of sales invoices and POs between sibling companies, with void/resync controls per link.",
        },
        prerequisites: [
          { ar: "شركتان منشأتان في نفس المجموعة، والمستخدم عضو في كلتيهما.", en: "Two companies in the same group, and the user is a member of both." },
          { ar: "دور accountant أو أعلى في الشركتين.", en: "Role accountant or higher in both companies." },
        ],
        steps: [
          {
            action: { ar: "افتح /customers، حدّد عميلًا، اضبط «الشركة المرتبطة».", en: "Open /customers, pick a customer, set 'Linked company'." },
          },
          {
            action: { ar: "أصدر فاتورة مبيعات لهذا العميل من الشركة الأولى.", en: "Issue a sales invoice to this customer from the first company." },
            result: { ar: "تُنشأ مرآة فاتورة شراء تلقائيًا في الشركة الشقيقة داخل نفس Transaction.", en: "A mirror PO is auto-created in the sibling company within the same transaction." },
          },
          {
            action: { ar: "افتح /intercompany لرؤية الروابط المُنشأة والحالة.", en: "Open /intercompany to see the created links and their status." },
          },
        ],
        scenarios: [
          {
            title: { ar: "إعادة مزامنة مرآة فاتورة معدَّلة", en: "Re-syncing a mirror after editing the original invoice" },
            body: {
              ar: "من /intercompany، اضغط على الرابط ← «إعادة مزامنة». ستُعاد كتابة المرآة بأحدث قيم.",
              en: "From /intercompany, click the link → 'Re-sync'. The mirror is re-emitted with the latest values.",
            },
          },
          {
            title: { ar: "إلغاء صفقة بين الشركات", en: "Voiding an intercompany deal" },
            body: {
              ar: "اضغط «إلغاء» على الرابط — تُحيَّد المرآة ويُسجَّل ذلك في audit_logs.",
              en: "Click 'Void' on the link — the mirror is neutralised and the action is recorded in audit_logs.",
            },
          },
        ],
        callouts: [
          {
            kind: "warning",
            body: {
              ar: "لا تُصدر فاتورة بين شركتين يدويًا — استخدم دائمًا الانعكاس التلقائي لتفادي عدم التطابق.",
              en: "Never issue an intercompany invoice manually — always rely on the automatic mirror to avoid mismatches.",
            },
          },
        ],
        related: ["customers", "accounting", "transfer-pricing-zakat"],
      }),

      M({
        slug: "transfer-pricing-zakat",
        position: 14,
        appPath: "/compliance",
        roles: ["owner", "manager", "accountant"],
        lastUpdated: STAMP,
        title: { ar: "تسعير التحويل والزكاة", en: "Transfer Pricing & Zakat" },
        summary: {
          ar: "تنبيهات تسعير التحويل بين الشركات الشقيقة وحساب الوعاء الزكوي السنوي.",
          en: "Transfer-pricing alerts between sibling companies and annual Zakat-base computation.",
        },
        prerequisites: [
          { ar: "إعداد ضوابط المجموعة في /intercompany.", en: "Group settings configured in /intercompany." },
        ],
        steps: [
          {
            action: { ar: "افتح /compliance ← تبويب «الزكاة».", en: "Open /compliance → 'Zakat' tab." },
          },
          {
            action: { ar: "اختر السنة المالية واضغط «احتساب».", en: "Pick the fiscal year and click 'Compute'." },
            result: { ar: "يعرض النظام الموجودات الزكوية ناقص المطلوبات قصيرة الأجل ثم يطبّق 2.5٪.", en: "The system shows zakatable assets minus short-term liabilities, then applies 2.5%." },
          },
          {
            action: { ar: "صدّر التقرير PDF لإرفاقه بإقرار الهيئة.", en: "Export the PDF to attach to the ZATCA filing." },
          },
        ],
        callouts: [
          {
            kind: "note",
            body: {
              ar: "تنبيهات تسعير التحويل تظهر تلقائيًا في /dashboard عند رصد سعر مخالف للسوق بين شركتين.",
              en: "Transfer-pricing alerts surface automatically on /dashboard when an intercompany price diverges from market.",
            },
          },
        ],
        related: ["intercompany", "accounting"],
      }),

      M({
        slug: "vat-threshold",
        position: 15,
        appPath: "/",
        roles: ["owner", "manager", "accountant"],
        lastUpdated: STAMP,
        title: { ar: "عدّاد التسجيل في ضريبة القيمة المضافة", en: "VAT Registration Threshold Meter" },
        summary: {
          ar: "بطاقة على /dashboard تعرض مبيعات آخر 12 شهرًا مقابل سقف 375,000 ر.س مع تنبيهات 80٪/100٪.",
          en: "A dashboard card showing rolling-12-month sales versus the 375,000 SAR threshold, with 80%/100% alerts.",
        },
        prerequisites: [
          { ar: "حالة التسجيل الضريبي معبّأة في /onboarding أو /settings.", en: "VAT status filled in /onboarding or /settings." },
        ],
        steps: [
          {
            action: { ar: "افتح /dashboard ومرّر إلى بطاقة «عدّاد ضريبة القيمة المضافة».", en: "Open /dashboard and scroll to the 'VAT meter' card." },
            result: { ar: "تظهر النسبة مقابل 375,000 ر.س مع تدرّج أخضر/كهرماني/أحمر.", en: "Percentage vs SAR 375,000 displays with a green/amber/red gradient." },
          },
          {
            action: { ar: "عند 80٪ ستصلك تنبيهات؛ اضغط «ابدأ التسجيل» للبدء.", en: "At 80% you receive alerts; click 'Start registration' to begin." },
          },
          {
            action: { ar: "بعد استلام شهادة ZATCA، حدّث الحالة من /settings ← «الضريبة».", en: "Once your ZATCA certificate is issued, update the status from /settings → 'Tax'." },
          },
        ],
        callouts: [
          {
            kind: "warning",
            body: {
              ar: "تأخير التسجيل بعد تجاوز السقف يعرّضك لغرامة من الهيئة — لا تتجاهل تنبيه 100٪.",
              en: "Delaying registration after crossing the threshold exposes you to ZATCA fines — never ignore the 100% alert.",
            },
          },
        ],
        related: ["vat-auto-hide", "accounting"],
      }),

      M({
        slug: "vat-auto-hide",
        position: 16,
        appPath: "/onboarding",
        roles: ["owner", "manager", "accountant", "sales", "cashier"],
        lastUpdated: STAMP,
        title: { ar: "إخفاء تلقائي لحقول الضريبة", en: "Auto-Hide VAT Fields" },
        summary: {
          ar: "إذا لم تكن منشأتك مسجَّلة في ضريبة القيمة المضافة، تختفي حقول VAT تلقائيًا من POS والفواتير والمشتريات.",
          en: "If your entity isn't VAT-registered, VAT fields are auto-hidden across POS, invoices, and procurement.",
        },
        steps: [
          {
            action: { ar: "في الخطوة 1 من /onboarding أجب «هل أنت مسجَّل في ضريبة القيمة المضافة؟».", en: "In step 1 of /onboarding answer 'Are you VAT-registered?'." },
          },
          {
            action: { ar: "لتغييره لاحقًا: /settings ← «الضريبة».", en: "To change later: /settings → 'Tax'." },
            result: { ar: "تظهر/تختفي الحقول تلقائيًا في كل الوحدات دون الحاجة لإعادة تسجيل الدخول.", en: "Fields appear/disappear across all modules without needing to sign in again." },
          },
        ],
        related: ["vat-threshold"],
      }),

      M({
        slug: "onboarding",
        position: 17,
        appPath: "/onboarding",
        roles: ["owner"],
        lastUpdated: STAMP,
        title: { ar: "التسجيل والإعداد الموجَّه", en: "Signup & Guided Onboarding" },
        summary: {
          ar: "تسجيل شركة جديدة من /signup ثم معالج إعداد من 5 خطوات: المنشأة، الفروع، المستخدمون، المنتجات، الإعدادات الضريبية.",
          en: "Create a company at /signup, then a 5-step wizard: business profile, branches, users, products, tax settings.",
        },
        steps: [
          {
            action: { ar: "افتح /signup وأنشئ حساب الشركة.", en: "Open /signup and create the company account." },
          },
          {
            action: { ar: "اتّبع المعالج خطوة بخطوة — لا يمكن تخطي خطوة.", en: "Follow the wizard step by step — you can't skip a step." },
          },
          {
            action: { ar: "اضغط «إنهاء» — ستُنقل للوحة القيادة جاهزًا للاستخدام.", en: "Click 'Finish' — you land on the dashboard ready to use the app." },
          },
        ],
        callouts: [
          {
            kind: "tip",
            body: {
              ar: "أضف موظف كاشير واحدًا على الأقل في خطوة المستخدمين لتفادي العودة لاحقًا.",
              en: "Add at least one cashier in the users step so you don't have to come back later.",
            },
          },
        ],
        related: ["branches-users", "vat-threshold"],
      }),

      M({
        slug: "landing",
        position: 18,
        appPath: "/welcome",
        roles: ["public"],
        lastUpdated: STAMP,
        title: { ar: "صفحة البداية", en: "Landing Page" },
        summary: {
          ar: "صفحة /welcome التسويقية العامة: عرض المنتج، شاشات نموذجية، المميزات، CTA إلى /signup و /login.",
          en: "Public marketing landing page at /welcome: hero, mockup screens, features, CTAs to /signup and /login.",
        },
        sections: [
          {
            heading: { ar: "للزوّار", en: "For visitors" },
            body: {
              ar: "صفحة قابلة للمشاركة دون تسجيل دخول. تُحوَّل المستخدمين المسجَّلين تلقائيًا إلى لوحة القيادة.",
              en: "A shareable page that requires no sign-in. Authenticated users are redirected to the dashboard automatically.",
            },
          },
        ],
        related: ["onboarding"],
      }),

      M({
        slug: "projects",
        position: 19,
        appPath: "/projects",
        roles: ["owner", "manager"],
        lastUpdated: STAMP,
        title: { ar: "المشاريع", en: "Projects" },
        summary: {
          ar: "إدارة مشاريع بلوحة Kanban أو عرض قائمة، مع ميزانيات لكل مشروع ومؤشر تقدّم.",
          en: "Project management with Kanban or list view, per-project budgets, and progress indicator.",
        },
        steps: [
          {
            action: { ar: "افتح /projects ← «مشروع جديد».", en: "Open /projects → 'New project'." },
          },
          {
            action: { ar: "أدخل الاسم، الميزانية، تاريخ البدء/النهاية.", en: "Enter name, budget, start/end dates." },
          },
          {
            action: { ar: "أضف مهامًا واسحبها بين أعمدة Kanban: مفتوح ← قيد العمل ← منجز.", en: "Add tasks and drag them between Kanban columns: Open → In progress → Done." },
          },
        ],
        callouts: [
          {
            kind: "tip",
            body: {
              ar: "اربط مشروعًا بفئة محاسبية لتتبع تكاليفه آليًا من فواتير الموردين.",
              en: "Link a project to an accounting cost-centre to track its costs automatically from supplier invoices.",
            },
          },
        ],
        related: ["accounting", "marketing"],
      }),

      M({
        slug: "marketing",
        position: 20,
        appPath: "/marketing",
        roles: ["owner", "manager", "marketing"],
        lastUpdated: STAMP,
        title: { ar: "التسويق", en: "Marketing" },
        summary: {
          ar: "حملات تسويقية مع قمع Leads ومتابعة معدل التحويل.",
          en: "Marketing campaigns with a leads funnel and conversion tracking.",
        },
        steps: [
          {
            action: { ar: "افتح /marketing ← «حملة جديدة».", en: "Open /marketing → 'New campaign'." },
          },
          {
            action: { ar: "اختر القناة (واتساب/SMS/إعلان)، الميزانية، الفترة.", en: "Pick a channel (WhatsApp/SMS/Ad), budget, period." },
          },
          {
            action: { ar: "اربط قائمة Leads ثم «إطلاق».", en: "Link a leads list, then 'Launch'." },
            result: { ar: "تظهر بطاقة الحملة مع معدّل التحويل المباشر.", en: "The campaign card appears with live conversion rate." },
          },
        ],
        related: ["customers", "projects"],
      }),

      M({
        slug: "admin-panel",
        position: 21,
        appPath: "/admin",
        roles: ["owner", "manager"],
        lastUpdated: STAMP,
        title: { ar: "لوحة تحكم المدير", en: "Admin Panel" },
        summary: {
          ar: "إشراف المنصّة في خمس تبويبات: نظرة عامة، الدعم الفني، الإعلانات، الميزات، السجلات.",
          en: "Platform oversight in five tabs: overview, support tickets, announcements, feature flags, audit logs.",
        },
        steps: [
          {
            action: { ar: "افتح /admin — تبويب «نظرة عامة» يعرض KPIs النظام وآخر الإعلانات.", en: "Open /admin — the 'Overview' tab shows system KPIs and latest announcements." },
          },
          {
            action: { ar: "لإعلان جديد: تبويب «الإعلانات» ← «إعلان جديد».", en: "For a new announcement: 'Announcements' tab → 'New announcement'." },
            result: { ar: "يظهر للمستخدمين فور النشر ويختفي تلقائيًا بعد انتهاء الصلاحية.", en: "Visible to users immediately after publish and auto-hidden after expiry." },
          },
          {
            action: { ar: "تشغيل/إيقاف ميزة: تبويب «الميزات» ثم استخدم المفتاح فوريًا.", en: "Toggle a feature: 'Features' tab, flip the switch — applies instantly." },
          },
          {
            action: { ar: "للمراجعة الأمنية: تبويب «السجلات» يعرض آخر إدخالات audit_logs.", en: "For security review: the 'Logs' tab lists the latest audit_logs entries." },
          },
        ],
        callouts: [
          {
            kind: "warning",
            body: {
              ar: "إيقاف ميزة قد يخفي عناصر في الواجهة لكل المستخدمين فورًا. اختبر أولًا في tenant تجريبي.",
              en: "Disabling a feature can hide UI elements for every user immediately. Test in a demo tenant first.",
            },
          },
        ],
        related: ["roles-matrix", "ai-models"],
      }),
    ],
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// SCREENSHOT ANNOTATIONS — per-module descriptive alt text + numbered hotspots.
// Coordinates are 0–100 percentages of the screenshot's 1280×720 viewBox, so
// the same numbers drive the SVG generator, the docs UI legend, and the
// exported PDF legend. The descriptive alt text is what assistive technology
// reads instead of the bare module title.
// ───────────────────────────────────────────────────────────────────────────────
interface ScreenshotMeta {
  alt: Bi;
  hotspots: DocHotspot[];
}

const SCREENSHOT_META: Record<string, ScreenshotMeta> = {
  dashboard: {
    alt: {
      ar: "لوحة القيادة التنفيذية مع بطاقات الإيرادات والمؤشرات الذكية وفهرس صحة الأعمال والرسوم البيانية للمبيعات وأداء الفروع.",
      en: "Executive dashboard showing revenue cards, AI insights, business health score, sales charts, and branch performance.",
    },
    hotspots: [
      { n: 1, x: 12, y: 18, label: { ar: "بطاقات المؤشرات الرئيسية", en: "Headline KPI cards" } },
      { n: 2, x: 70, y: 28, label: { ar: "مخطط المبيعات اليومية", en: "Daily sales chart" } },
      { n: 3, x: 12, y: 58, label: { ar: "أداء الفروع", en: "Branch performance" } },
      { n: 4, x: 70, y: 72, label: { ar: "تنبيهات وأفكار AI", en: "Alerts & AI insights" } },
    ],
  },
  pos: {
    alt: {
      ar: "شاشة نقطة البيع تعرض شبكة المنتجات على اليسار وعربة الطلب الحالي على اليمين مع زر الإغلاق وزر تطبيق نقاط الولاء.",
      en: "Point-of-sale screen showing the product grid on the left and the current order cart on the right, with close and loyalty buttons.",
    },
    hotspots: [
      { n: 1, x: 18, y: 22, label: { ar: "شريط البحث وفلتر الفئات", en: "Search bar & category filter" } },
      { n: 2, x: 28, y: 50, label: { ar: "شبكة المنتجات", en: "Product grid" } },
      { n: 3, x: 78, y: 35, label: { ar: "عربة الطلب الحالي", en: "Current order cart" } },
      { n: 4, x: 78, y: 78, label: { ar: "تطبيق نقاط الولاء وإغلاق الطلب", en: "Apply loyalty & close order" } },
    ],
  },
  inventory: {
    alt: {
      ar: "صفحة المنتجات والمخزون تعرض جدول المنتجات مع كميات المخزون وتنبيهات النقص وفلاتر الفئات.",
      en: "Products & inventory page showing the product table with stock levels, low-stock alerts, and category filters.",
    },
    hotspots: [
      { n: 1, x: 14, y: 22, label: { ar: "زر إضافة منتج", en: "Add product button" } },
      { n: 2, x: 50, y: 45, label: { ar: "جدول المنتجات", en: "Products table" } },
      { n: 3, x: 80, y: 30, label: { ar: "فلتر الفئات والفروع", en: "Category & branch filter" } },
      { n: 4, x: 50, y: 72, label: { ar: "شارات تنبيه المخزون المنخفض", en: "Low-stock alert badges" } },
    ],
  },
  customers: {
    alt: {
      ar: "صفحة العملاء تعرض قائمة العملاء مع سجل الطلبات وقيمة العميل مدى الحياة وأزرار إنشاء عميل جديد.",
      en: "Customers page showing the customer list with order history, lifetime value, and the new-customer button.",
    },
    hotspots: [
      { n: 1, x: 14, y: 22, label: { ar: "زر إضافة عميل", en: "Add customer button" } },
      { n: 2, x: 38, y: 50, label: { ar: "قائمة العملاء", en: "Customer list" } },
      { n: 3, x: 75, y: 45, label: { ar: "تفاصيل وسجل الطلبات", en: "Detail & order history" } },
      { n: 4, x: 75, y: 75, label: { ar: "قيمة العميل مدى الحياة (CLV)", en: "Customer lifetime value (CLV)" } },
    ],
  },
  accounting: {
    alt: {
      ar: "صفحة المحاسبة تعرض قيود اليومية، التدفق النقدي، أرصدة الحسابات، وحالة تكامل ZATCA.",
      en: "Accounting page showing journal entries, cash flow, account balances, and ZATCA integration status.",
    },
    hotspots: [
      { n: 1, x: 14, y: 22, label: { ar: "تبويبات: قيود/أرصدة/تدفق", en: "Tabs: journal / balances / cash flow" } },
      { n: 2, x: 45, y: 50, label: { ar: "جدول قيود اليومية", en: "Journal entries table" } },
      { n: 3, x: 80, y: 35, label: { ar: "شارة حالة ZATCA", en: "ZATCA status badge" } },
      { n: 4, x: 80, y: 72, label: { ar: "ملخص التدفق النقدي", en: "Cash flow summary" } },
    ],
  },
  invoices: {
    alt: {
      ar: "صفحة فواتير الموردين مع زر الماسح الذكي للفاتورة، جدول الفواتير، وأيقونة QR الخاصة بـ ZATCA.",
      en: "Supplier invoices page with the AI invoice scanner button, the invoices table, and the ZATCA QR icon.",
    },
    hotspots: [
      { n: 1, x: 14, y: 22, label: { ar: "زر ماسح الفواتير AI", en: "AI invoice scanner button" } },
      { n: 2, x: 50, y: 50, label: { ar: "جدول الفواتير", en: "Invoices table" } },
      { n: 3, x: 82, y: 45, label: { ar: "حالة الدفع", en: "Payment status" } },
      { n: 4, x: 82, y: 72, label: { ar: "أيقونة ZATCA QR", en: "ZATCA QR icon" } },
    ],
  },
  reports: {
    alt: {
      ar: "صفحة التقارير والتحليلات تعرض رسوم بيانية للمبيعات والمخزون والأرباح مع فلاتر الفترة.",
      en: "Reports & analytics page showing sales, inventory, and profit charts with period filters.",
    },
    hotspots: [
      { n: 1, x: 14, y: 22, label: { ar: "فلتر الفترة الزمنية", en: "Period filter" } },
      { n: 2, x: 35, y: 50, label: { ar: "رسم المبيعات", en: "Sales chart" } },
      { n: 3, x: 75, y: 50, label: { ar: "رسم الأرباح", en: "Profit chart" } },
      { n: 4, x: 55, y: 78, label: { ar: "زر التصدير", en: "Export button" } },
    ],
  },
  "smart-reports": {
    alt: {
      ar: "صفحة التقارير الذكية مع جدول كشف الاحتيال، توقعات المبيعات، وقيمة العميل المتنبأ بها.",
      en: "Smart reports page with the fraud detection table, sales forecast, and predicted customer lifetime value.",
    },
    hotspots: [
      { n: 1, x: 18, y: 22, label: { ar: "تبويبات الذكاء الاصطناعي", en: "AI tabs" } },
      { n: 2, x: 45, y: 50, label: { ar: "جدول كشف الاحتيال", en: "Fraud detection table" } },
      { n: 3, x: 80, y: 45, label: { ar: "رسم توقع المبيعات", en: "Sales forecast chart" } },
      { n: 4, x: 50, y: 78, label: { ar: "بطاقات CLV", en: "CLV cards" } },
    ],
  },
  "ai-models": {
    alt: {
      ar: "لوحة إدارة نماذج الذكاء الاصطناعي مع بطاقات نماذج التنبؤ، أزرار التدريب، وتبويب المساعد الذكي.",
      en: "AI models admin panel with model cards, training buttons, and the AI assistant tab.",
    },
    hotspots: [
      { n: 1, x: 16, y: 22, label: { ar: "تبويب نماذج AI / المساعد", en: "AI models / assistant tabs" } },
      { n: 2, x: 30, y: 48, label: { ar: "بطاقة نموذج (الدقة + آخر تدريب)", en: "Model card (accuracy + last trained)" } },
      { n: 3, x: 72, y: 48, label: { ar: "زر التدريب", en: "Train button" } },
      { n: 4, x: 50, y: 78, label: { ar: "محرر النتائج / المساعد", en: "Results / assistant pane" } },
    ],
  },
  "branches-users": {
    alt: {
      ar: "صفحة الفروع تعرض قائمة الفروع مع عنوان كل فرع وعدد المستخدمين النشطين وزر إضافة فرع.",
      en: "Branches page showing the branch list with each branch's address, active user count, and the add-branch button.",
    },
    hotspots: [
      { n: 1, x: 14, y: 22, label: { ar: "زر إضافة فرع", en: "Add branch button" } },
      { n: 2, x: 45, y: 50, label: { ar: "بطاقات الفروع", en: "Branch cards" } },
      { n: 3, x: 80, y: 50, label: { ar: "عدد المستخدمين النشطين", en: "Active user count" } },
      { n: 4, x: 50, y: 78, label: { ar: "حالة الفرع", en: "Branch status" } },
    ],
  },
  "roles-matrix": {
    alt: {
      ar: "صفحة المستخدمين تعرض جدول المستخدمين مع أعمدة الدور، الفرع، حالة 2FA، وآخر تسجيل دخول.",
      en: "Users page showing the user table with role, branch, 2FA status, and last login columns.",
    },
    hotspots: [
      { n: 1, x: 14, y: 22, label: { ar: "زر دعوة مستخدم", en: "Invite user button" } },
      { n: 2, x: 50, y: 50, label: { ar: "جدول المستخدمين", en: "User table" } },
      { n: 3, x: 80, y: 50, label: { ar: "شارة 2FA", en: "2FA badge" } },
      { n: 4, x: 50, y: 78, label: { ar: "اختيار الدور", en: "Role picker" } },
    ],
  },
  "loyalty-zatca": {
    alt: {
      ar: "نقطة البيع مع لوحة نقاط الولاء النشطة، خصم مطبق، وشارة ZATCA مرئية على الإيصال.",
      en: "POS with the active loyalty pane, applied discount, and visible ZATCA badge on the receipt.",
    },
    hotspots: [
      { n: 1, x: 78, y: 25, label: { ar: "ربط العميل بالطلب", en: "Attach customer to order" } },
      { n: 2, x: 78, y: 48, label: { ar: "رصيد نقاط الولاء", en: "Loyalty points balance" } },
      { n: 3, x: 78, y: 65, label: { ar: "تطبيق الخصم", en: "Apply discount" } },
      { n: 4, x: 30, y: 78, label: { ar: "شارة ZATCA على الإيصال", en: "ZATCA badge on receipt" } },
    ],
  },
  intercompany: {
    alt: {
      ar: "صفحة المعاملات بين الشركات تعرض جدول المستندات المرتبطة مع حالة المطابقة وزر إعادة المزامنة.",
      en: "Intercompany page showing the linked-documents table with match status and resync button.",
    },
    hotspots: [
      { n: 1, x: 14, y: 22, label: { ar: "فلتر الكيان", en: "Entity filter" } },
      { n: 2, x: 45, y: 50, label: { ar: "جدول الروابط (المصدر/المرآة)", en: "Links table (source / mirror)" } },
      { n: 3, x: 80, y: 50, label: { ar: "شارة الحالة (matched/void)", en: "Status badge (matched / void)" } },
      { n: 4, x: 50, y: 78, label: { ar: "أزرار إلغاء/إعادة المزامنة", en: "Void / resync actions" } },
    ],
  },
  "transfer-pricing-zakat": {
    alt: {
      ar: "صفحة الامتثال مع تبويبات الزكاة، تسعير التحويل، وأرشيف ZATCA.",
      en: "Compliance page with Zakat, transfer pricing, and ZATCA archive tabs.",
    },
    hotspots: [
      { n: 1, x: 18, y: 22, label: { ar: "تبويبات الامتثال", en: "Compliance tabs" } },
      { n: 2, x: 45, y: 50, label: { ar: "ملخص الزكاة المستحقة", en: "Zakat due summary" } },
      { n: 3, x: 80, y: 45, label: { ar: "حالة تسعير التحويل", en: "Transfer-pricing status" } },
      { n: 4, x: 50, y: 78, label: { ar: "زر تنزيل الأرشيف", en: "Download archive button" } },
    ],
  },
  "vat-threshold": {
    alt: {
      ar: "بطاقة عتبة VAT على لوحة القيادة مع شريط تقدّم متدرّج وزر بدء التسجيل.",
      en: "VAT threshold card on the dashboard with a gradient progress bar and 'start registration' CTA.",
    },
    hotspots: [
      { n: 1, x: 20, y: 30, label: { ar: "نسبة التقدم نحو الحد", en: "Progress toward the threshold" } },
      { n: 2, x: 50, y: 50, label: { ar: "إجمالي المبيعات Rolling 12 شهرًا", en: "Rolling 12-month sales total" } },
      { n: 3, x: 80, y: 55, label: { ar: "شارة الحالة (تحذير/خطر)", en: "Status badge (warning / danger)" } },
      { n: 4, x: 50, y: 80, label: { ar: "زر ابدأ التسجيل", en: "Start registration CTA" } },
    ],
  },
  "vat-auto-hide": {
    alt: {
      ar: "خطوة الإعداد التي تسأل المستخدم عن حالة التسجيل في ضريبة القيمة المضافة.",
      en: "Onboarding step that asks the user about their VAT registration status.",
    },
    hotspots: [
      { n: 1, x: 50, y: 22, label: { ar: "السؤال: هل أنت مسجل في VAT؟", en: "Question: are you VAT-registered?" } },
      { n: 2, x: 30, y: 50, label: { ar: "خيار: مسجل", en: "Option: registered" } },
      { n: 3, x: 50, y: 50, label: { ar: "خيار: تسجيل اختياري", en: "Option: voluntary" } },
      { n: 4, x: 70, y: 50, label: { ar: "خيار: غير مسجل", en: "Option: not registered" } },
    ],
  },
  onboarding: {
    alt: {
      ar: "معالج الإعداد ذو الخطوات الخمس مع شريط التقدم العلوي وخطوة إضافة الفرع.",
      en: "Five-step onboarding wizard with the top progress bar and the add-branch step active.",
    },
    hotspots: [
      { n: 1, x: 50, y: 14, label: { ar: "شريط تقدم الخطوات الخمس", en: "Five-step progress bar" } },
      { n: 2, x: 30, y: 48, label: { ar: "حقول الإدخال", en: "Input fields" } },
      { n: 3, x: 72, y: 48, label: { ar: "لوحة المعاينة", en: "Preview pane" } },
      { n: 4, x: 80, y: 82, label: { ar: "زر التالي/إنهاء", en: "Next / finish button" } },
    ],
  },
  landing: {
    alt: {
      ar: "صفحة البداية العامة مع قسم البطل، مكوّن المعاينة الواقعية، شبكة المميزات، ودعوة للتسجيل.",
      en: "Public landing page with the hero, live mockup preview, features grid, and signup CTA.",
    },
    hotspots: [
      { n: 1, x: 25, y: 20, label: { ar: "قسم البطل والعنوان", en: "Hero & headline" } },
      { n: 2, x: 75, y: 35, label: { ar: "معاينة المنتج", en: "Product preview" } },
      { n: 3, x: 50, y: 60, label: { ar: "شبكة المميزات", en: "Features grid" } },
      { n: 4, x: 50, y: 85, label: { ar: "دعوة التسجيل (CTA)", en: "Signup CTA" } },
    ],
  },
  projects: {
    alt: {
      ar: "صفحة المشاريع بعرض كانبان مع أعمدة الحالة، بطاقات المشاريع، ومؤشرات الميزانية والتقدم.",
      en: "Projects page in Kanban view with status columns, project cards, and budget/progress indicators.",
    },
    hotspots: [
      { n: 1, x: 18, y: 22, label: { ar: "مبدّل عرض كانبان/قائمة", en: "Kanban / list view toggle" } },
      { n: 2, x: 35, y: 50, label: { ar: "عمود حالة (قيد التنفيذ)", en: "Status column (in progress)" } },
      { n: 3, x: 60, y: 50, label: { ar: "بطاقة مشروع", en: "Project card" } },
      { n: 4, x: 85, y: 50, label: { ar: "شريط تقدم المهام", en: "Task progress bar" } },
    ],
  },
  marketing: {
    alt: {
      ar: "صفحة التسويق مع بطاقات الحملات النشطة، خط الأنابيب التحويلي، وتبويب العملاء المحتملين.",
      en: "Marketing page with active campaign cards, conversion pipeline, and leads tab.",
    },
    hotspots: [
      { n: 1, x: 18, y: 22, label: { ar: "تبويبات الحملات/العملاء المحتملين", en: "Campaigns / leads tabs" } },
      { n: 2, x: 35, y: 50, label: { ar: "بطاقة حملة", en: "Campaign card" } },
      { n: 3, x: 75, y: 45, label: { ar: "قُمع التحويل", en: "Conversion funnel" } },
      { n: 4, x: 50, y: 78, label: { ar: "تتبع العائد على الإنفاق", en: "ROAS tracking" } },
    ],
  },
  "admin-panel": {
    alt: {
      ar: "لوحة تحكم المدير مع تبويبات: نظرة عامة، الدعم الفني، الإعلانات، الميزات، والسجلات.",
      en: "Admin control panel with tabs: Overview, Support, Announcements, Features, and Logs.",
    },
    hotspots: [
      { n: 1, x: 18, y: 22, label: { ar: "تبويبات لوحة الإدارة", en: "Admin tabs" } },
      { n: 2, x: 45, y: 50, label: { ar: "بطاقات KPI وحالة النظام", en: "KPI & system-health cards" } },
      { n: 3, x: 80, y: 50, label: { ar: "تبديل علم الميزة", en: "Feature-flag toggle" } },
      { n: 4, x: 50, y: 78, label: { ar: "سجلات التدقيق الأخيرة", en: "Recent audit log" } },
    ],
  },
};

function withScreenshotMeta(m: DocModule): DocModule {
  const meta = SCREENSHOT_META[m.slug];
  if (!meta) return m;
  return {
    ...m,
    screenshotAlt: m.screenshotAlt ?? meta.alt,
    hotspots: m.hotspots ?? meta.hotspots,
  };
}

export function findModule(slug: string): DocModule | null {
  for (const cat of DOC_CATEGORIES) {
    for (const m of cat.modules) {
      if (m.slug === slug) return withScreenshotMeta(m);
    }
  }
  return null;
}

export function allModules(): DocModule[] {
  return DOC_CATEGORIES.flatMap((c) => c.modules.map(withScreenshotMeta));
}
