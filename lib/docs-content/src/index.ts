export type Lang = "ar" | "en";

export interface DocSection {
  heading: { ar: string; en: string };
  body: { ar: string; en: string };
}

export interface DocModule {
  slug: string;
  /** Stable position from the features-deck manifest. */
  position: number;
  title: { ar: string; en: string };
  summary: { ar: string; en: string };
  /** Path inside the ERP app this module documents (used by the screenshot capturer). */
  appPath: string | null;
  /** Role gating note shown next to the heading. */
  roles: string[];
  sections: DocSection[];
  tips?: { ar: string; en: string }[];
}

export interface DocCategory {
  slug: string;
  title: { ar: string; en: string };
  modules: DocModule[];
}

const M = (m: DocModule): DocModule => m;

export const DOCS_VERSION = "2026.05.26";

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
        title: { ar: "لوحة القيادة التنفيذية", en: "Executive Dashboard" },
        summary: {
          ar: "لوحة Glassmorphism داكنة تجمع مؤشرات المبيعات والتنبيهات الذكية ومؤشرات صحّة الأعمال وأداء الفروع في شاشة واحدة.",
          en: "A dark glassmorphism dashboard that surfaces AI insights, sales charts, business-health score, and per-branch performance in one view.",
        },
        sections: [
          {
            heading: { ar: "ماذا تظهر اللوحة؟", en: "What it shows" },
            body: {
              ar: "أربعة بطاقات KPI (المبيعات اليومية، الفواتير، العملاء النشطون، تنبيهات AI)، رسم بياني للمبيعات (أسبوعي/شهري/سنوي)، شريط مؤشرات للمدير، ومقارنة أداء الفروع.",
              en: "Four KPI cards (today's sales, invoices, active customers, AI alerts), a sales chart (weekly/monthly/yearly), a manager KPI bar, and branch performance comparison.",
            },
          },
          {
            heading: { ar: "خطوات الاستخدام", en: "How to use it" },
            body: {
              ar: "1. سجّل دخولك من /login. 2. ستفتح اللوحة افتراضيًا. 3. اضغط على أي تنبيه لمشاهدة سببه. 4. استخدم الفلتر (أسبوعي/شهري/سنوي) لتغيير نافذة الرسم.",
              en: "1. Sign in at /login. 2. The dashboard opens by default. 3. Click any alert to see its underlying condition. 4. Use the period filter (weekly/monthly/yearly) to change the chart window.",
            },
          },
        ],
        tips: [
          {
            ar: "يمكن للمحاسب إخفاء تنبيه مع تبرير وملف PDF داعم للحفاظ على مسار التدقيق.",
            en: "Accountants can dismiss an alert with a justification and a supporting PDF to preserve the audit trail.",
          },
        ],
      }),
      M({
        slug: "pos",
        position: 2,
        appPath: "/pos",
        roles: ["owner", "manager", "sales", "cashier"],
        title: { ar: "نقطة البيع (POS)", en: "Point of Sale (POS)" },
        summary: {
          ar: "واجهة كاشير سريعة بدعم الجلسات، الطلبات المقسّمة، نقاط الولاء، وعلامة ZATCA على الإيصال.",
          en: "Fast cashier UI with sessions, split payments, customer loyalty points, and a ZATCA-compliant receipt badge.",
        },
        sections: [
          {
            heading: { ar: "فتح جلسة بيع", en: "Opening a session" },
            body: {
              ar: "افتح /pos، ثم اضغط «بدء جلسة جديدة» وحدد الفرع والصندوق. لا يمكن البيع قبل فتح جلسة.",
              en: "Open /pos, click 'Start new session', and pick the branch and till. You cannot sell before opening a session.",
            },
          },
          {
            heading: { ar: "إنهاء طلب", en: "Closing an order" },
            body: {
              ar: "أضف المنتجات للسلّة، اربط العميل (اختياري لإكساب نقاط ولاء)، اختر طريقة الدفع، اضغط «دفع» — سيُطبع الإيصال مع رمز ZATCA QR ويُسجَّل القيد المحاسبي تلقائيًا.",
              en: "Add items to the cart, attach a customer (optional for loyalty points), pick a payment method, hit 'Pay' — the receipt prints with a ZATCA QR and the journal entry is posted automatically.",
            },
          },
        ],
      }),
      M({
        slug: "inventory",
        position: 3,
        appPath: "/products",
        roles: ["owner", "manager", "inventory"],
        title: { ar: "المنتجات والمخزون", en: "Products & Inventory" },
        summary: {
          ar: "إدارة كاملة للمنتجات والفئات ومستويات المخزون مع تنبيهات النقص وقواعد إعادة الطلب.",
          en: "Full product, category, and stock-level management with low-stock alerts and reorder rules.",
        },
        sections: [
          {
            heading: { ar: "إضافة منتج", en: "Adding a product" },
            body: {
              ar: "افتح /products، اضغط «منتج جديد»، عبّئ الاسم، الفئة، الباركود، السعر، تكلفة الشراء، والمخزون الافتتاحي. اضغط «حفظ».",
              en: "Open /products, click 'New product', fill in name, category, barcode, price, purchase cost, and opening stock. Click 'Save'.",
            },
          },
          {
            heading: { ar: "تنبيه نقص المخزون", en: "Low stock alerts" },
            body: {
              ar: "حدد «حد إعادة الطلب» لكل منتج — سيظهر تنبيه على /dashboard عند الوصول إليه، ويمكنك إعداد قاعدة شراء تلقائية من /reorder-rules.",
              en: "Set 'Reorder threshold' per product — a dashboard alert appears when stock drops below it, and you can automate purchase orders from /reorder-rules.",
            },
          },
        ],
      }),
      M({
        slug: "customers",
        position: 4,
        appPath: "/customers",
        roles: ["owner", "manager", "sales", "cashier"],
        title: { ar: "العملاء", en: "Customers" },
        summary: {
          ar: "ملف عميل موحَّد يجمع المعلومات الأساسية، سجل الطلبات، نقاط الولاء، وقيم العمر الدائنة.",
          en: "Unified customer profile with contact info, order history, loyalty points, and credit limits.",
        },
        sections: [
          {
            heading: { ar: "إضافة عميل", en: "Adding a customer" },
            body: {
              ar: "افتح /customers، اضغط «عميل جديد»، أدخل الاسم والجوال والرقم الضريبي (إن وُجد). يمكن ربط العميل بشركة شقيقة لتفعيل الانعكاس بين الشركات.",
              en: "Open /customers, click 'New customer', enter name, phone, and VAT number (if any). You can link the customer to a sibling company to enable the intercompany mirror.",
            },
          },
        ],
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
        title: { ar: "المحاسبة والامتثال", en: "Accounting & Compliance" },
        summary: {
          ar: "محاسبة بالقيد المزدوج، شجرة حسابات، فترات مالية، تكامل ZATCA المرحلة 2.",
          en: "Double-entry accounting, chart of accounts, fiscal periods, and ZATCA Phase 2 integration.",
        },
        sections: [
          {
            heading: { ar: "إنشاء قيد يدوي", en: "Manual journal entry" },
            body: {
              ar: "افتح /accounting → «قيود يومية» → «قيد جديد». أضف بنود مدين/دائن متوازنة، اختر التاريخ والمرجع، ثم «حفظ»، ثم «ترحيل».",
              en: "Open /accounting → 'Journal entries' → 'New entry'. Add balanced debit/credit lines, pick the date and reference, then 'Save', then 'Post'.",
            },
          },
          {
            heading: { ar: "إغلاق فترة", en: "Closing a period" },
            body: {
              ar: "من /accounting-periods، اختر الفترة، تحقق من القيود المعلّقة، ثم «إغلاق». لا يمكن إعادة فتح الفترة دون صلاحية مالك.",
              en: "From /accounting-periods, pick a period, verify pending entries, then 'Close'. Re-opening requires owner privileges.",
            },
          },
        ],
      }),
      M({
        slug: "invoices",
        position: 6,
        appPath: "/invoices",
        roles: ["owner", "manager", "accountant"],
        title: { ar: "فواتير الموردين بالذكاء الاصطناعي", en: "Supplier Invoices (AI)" },
        summary: {
          ar: "وكيل مسح فواتير الموردين يلتقط الصورة، يستخرج الحقول بالذكاء الاصطناعي، ويرحّلها بنقرة واحدة.",
          en: "AI invoice-scanner agent: capture an image, extract fields with AI, and post in one click.",
        },
        sections: [
          {
            heading: { ar: "مسح فاتورة", en: "Scan an invoice" },
            body: {
              ar: "افتح /invoices → «مسح بالكاميرا» أو ارفع صورة (JPG/PNG/WEBP حتى 20MB). سيستخرج النظام اسم المورد، رقم الفاتورة، التاريخ، البنود، الإجمالي والضريبة.",
              en: "Open /invoices → 'Scan with camera' or upload an image (JPG/PNG/WEBP up to 20MB). The system extracts supplier name, invoice number, date, lines, total, and VAT.",
            },
          },
          {
            heading: { ar: "المراجعة والترحيل", en: "Review & post" },
            body: {
              ar: "راجع النتائج، عدّل عند الحاجة، ثم اضغط «تأكيد». سيُضاف القيد المحاسبي (مدين مخزون + ضريبة مدخلات / دائن موردين) ويُزاد المخزون تلقائيًا.",
              en: "Review the result, adjust where needed, then 'Confirm'. The journal entry (Dr Inventory + Dr VAT-In / Cr Suppliers) is posted and stock is incremented automatically.",
            },
          },
        ],
        tips: [
          {
            ar: "حد المسح: 15 طلبًا كل 15 دقيقة لكل مستخدم. تأكد من جودة الإضاءة لرفع الدقة.",
            en: "Rate limit: 15 scans per 15 minutes per user. Good lighting dramatically improves accuracy.",
          },
        ],
      }),
      M({
        slug: "reports",
        position: 7,
        appPath: "/reports",
        roles: ["owner", "manager", "accountant", "auditor"],
        title: { ar: "التقارير والتحليلات", en: "Reports & Analytics" },
        summary: {
          ar: "مكتبة تقارير جاهزة، باني تقارير مرن، وحفظ المفضّلة للوصول السريع.",
          en: "Ready report library, a flexible report builder, and saved-favorites for fast access.",
        },
        sections: [
          {
            heading: { ar: "إنشاء تقرير مخصّص", en: "Build a custom report" },
            body: {
              ar: "افتح /reports-builder، اختر المصدر (مبيعات، فواتير، قيود)، أضف الأعمدة والفلاتر، اضغط «تشغيل»، ثم «حفظ» إذا أردت تكراره لاحقًا من /reports-saved.",
              en: "Open /reports-builder, pick a source (sales, invoices, journal), add columns and filters, hit 'Run', then 'Save' to re-use it later from /reports-saved.",
            },
          },
        ],
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
        title: { ar: "التقارير الذكية وكشف الاحتيال", en: "Smart Reports & Fraud Detection" },
        summary: {
          ar: "مساعد ذكي يجيب على أسئلة الأعمال بلغة طبيعية + جدول كشف شذوذ يبرز الطلبات المشبوهة.",
          en: "An AI assistant that answers business questions in plain language + an anomaly table that highlights suspicious orders.",
        },
        sections: [
          {
            heading: { ar: "استخدام المساعد", en: "Using the assistant" },
            body: {
              ar: "افتح /admin → تبويب «المساعد الذكي»، اطرح سؤالك (مثلاً: «أعلى 5 منتجات مبيعًا الشهر الماضي؟»). الإجابة مبنية على بيانات شركتك الحيّة.",
              en: "Open /admin → 'AI Assistant' tab, ask your question (e.g. 'Top 5 best-selling products last month?'). Answers are grounded in your company's live data.",
            },
          },
        ],
      }),
      M({
        slug: "ai-models",
        position: 9,
        appPath: "/admin",
        roles: ["owner", "manager"],
        title: { ar: "نماذج الذكاء الاصطناعي الخمسة", en: "Five AI Models" },
        summary: {
          ar: "خمسة نماذج مسجَّلة: تنبؤ المبيعات، تسرّب العملاء، كشف الاحتيال، توصيات المنتجات، المساعد الذكي.",
          en: "Five registered models: sales forecast, customer churn, fraud detection, product recommendations, AI assistant.",
        },
        sections: [
          {
            heading: { ar: "تدريب النماذج", en: "Training the models" },
            body: {
              ar: "من /admin → تبويب «نماذج AI» اضغط «تدريب الكل» أو «تدريب» لنموذج واحد. يتم التدريب الذاتي عند أول استخدام إن لم تكن المعاملات محفوظة.",
              en: "From /admin → 'AI Models' tab, click 'Train all' or 'Train' on a single model. Auto-training kicks in on first use if parameters aren't saved.",
            },
          },
        ],
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
        title: { ar: "الفروع والمستخدمون والإعدادات", en: "Branches, Users & Settings" },
        summary: {
          ar: "إدارة متعددة الفروع، مستخدمين بصلاحيات، وإعدادات الأمان وفق ضوابط NCA ECC.",
          en: "Multi-branch ops, role-based users, and NCA-ECC-aligned security settings.",
        },
        sections: [
          {
            heading: { ar: "إضافة فرع", en: "Adding a branch" },
            body: {
              ar: "افتح /branches → «فرع جديد»، أدخل الاسم، العنوان، والمستودع الافتراضي. يمكن لاحقًا تحويل المخزون من /transfers.",
              en: "Open /branches → 'New branch', enter name, address, and default warehouse. Stock can later be moved via /transfers.",
            },
          },
        ],
      }),
      M({
        slug: "roles-matrix",
        position: 11,
        appPath: "/users",
        roles: ["owner", "manager"],
        title: { ar: "الأدوار وحرّاس الصلاحيات", en: "Roles & Permission Guards" },
        summary: {
          ar: "ثمانية أدوار (owner, manager, accountant, sales, cashier, inventory, marketing, auditor) محميَّة بأربعة عشر حارسًا على الخادم ومرآة على الواجهة.",
          en: "Eight roles (owner, manager, accountant, sales, cashier, inventory, marketing, auditor) protected by fourteen server guards and mirrored on the frontend.",
        },
        sections: [
          {
            heading: { ar: "تعيين دور لمستخدم", en: "Assigning a role" },
            body: {
              ar: "افتح /users، حدّد المستخدم، اختر الدور من القائمة، احفظ. ستتحدّث القائمة الجانبية والصلاحيات فور تسجيل الدخول التالي.",
              en: "Open /users, pick the user, choose a role, save. The sidebar and permissions refresh on next login.",
            },
          },
        ],
      }),
      M({
        slug: "loyalty-zatca",
        position: 12,
        appPath: "/pos",
        roles: ["owner", "manager", "cashier"],
        title: { ar: "برامج الولاء وعلامة ZATCA", en: "Loyalty Programs & ZATCA Badge" },
        summary: {
          ar: "نقاط ولاء داخل السلة تُحوَّل إلى خصم، مع شارة توافق ZATCA على الإيصال ورمز QR صالح.",
          en: "In-cart loyalty points convert to discounts, with a ZATCA-compliant badge and a valid QR on the receipt.",
        },
        sections: [
          {
            heading: { ar: "تفعيل النقاط في الطلب", en: "Redeeming points on an order" },
            body: {
              ar: "بعد ربط العميل في POS، ستظهر النقاط المتاحة وزر «استبدال». يُضاف الخصم إلى effectiveDiscount ويُحفظ مع الطلب.",
              en: "After attaching a customer in POS, available points appear with a 'Redeem' button. The discount is added to effectiveDiscount and persisted with the order.",
            },
          },
        ],
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
        title: { ar: "المعاملات بين الشركات", en: "Intercompany Transactions" },
        summary: {
          ar: "انعكاس تلقائي لفواتير المبيعات وأوامر الشراء بين شركات شقيقة، مع روابط قابلة للإلغاء وإعادة المزامنة.",
          en: "Automatic mirroring of sales invoices and POs between sibling companies, with void/resync controls per link.",
        },
        sections: [
          {
            heading: { ar: "ربط شركتين", en: "Linking two companies" },
            body: {
              ar: "افتح /customers، حدّد عميلاً، اضبط «الشركة المرتبطة». بعدها أي فاتورة لهذا العميل ستُنشئ مرآة فاتورة شراء في الشركة الشقيقة تلقائيًا.",
              en: "Open /customers, pick a customer, set 'Linked company'. Any subsequent invoice for that customer will auto-create a mirror PO in the sibling company.",
            },
          },
          {
            heading: { ar: "إلغاء أو إعادة مزامنة", en: "Voiding or re-syncing" },
            body: {
              ar: "من /intercompany، اضغط على الرابط ثم «إلغاء» لتحييد المرآة أو «إعادة مزامنة» لإعادة إصدارها.",
              en: "From /intercompany, click a link then 'Void' to neutralise the mirror or 'Re-sync' to re-emit it.",
            },
          },
        ],
      }),
      M({
        slug: "transfer-pricing-zakat",
        position: 14,
        appPath: "/compliance",
        roles: ["owner", "manager", "accountant"],
        title: { ar: "تسعير التحويل والزكاة", en: "Transfer Pricing & Zakat" },
        summary: {
          ar: "تنبيهات تسعير التحويل بين الشركات الشقيقة وحساب الوعاء الزكوي السنوي.",
          en: "Transfer-pricing alerts between sibling companies and annual Zakat-base computation.",
        },
        sections: [
          {
            heading: { ar: "الوعاء الزكوي", en: "Zakat base" },
            body: {
              ar: "محرّك الزكاة يجمع الموجودات الزكوية ويطرح المطلوبات قصيرة الأجل ثم يطبّق 2.5٪. التقرير متاح من /compliance.",
              en: "The Zakat engine sums zakatable assets, subtracts short-term liabilities, then applies 2.5%. Available from /compliance.",
            },
          },
        ],
      }),
      M({
        slug: "vat-threshold",
        position: 15,
        appPath: "/",
        roles: ["owner", "manager", "accountant"],
        title: { ar: "عدّاد التسجيل في ضريبة القيمة المضافة", en: "VAT Registration Threshold Meter" },
        summary: {
          ar: "بطاقة على /dashboard تعرض مبيعات آخر 12 شهرًا مقابل سقف 375,000 ر.س مع تنبيهات 80٪/100٪ ودي-باوس لمنع التكرار.",
          en: "A dashboard card showing rolling-12-month sales versus the 375,000 SAR threshold, with 80%/100% alerts and debounce to prevent repeats.",
        },
        sections: [
          {
            heading: { ar: "كيف يعمل العدّاد", en: "How the meter works" },
            body: {
              ar: "يحسب النظام مجموع (subtotal-discount) من pos_orders و customer_invoices للحالات issued/partially_paid/paid آخر 12 شهرًا. تنبيه أصفر عند 80٪ وأحمر عند 100٪.",
              en: "The system sums (subtotal-discount) from pos_orders and customer_invoices for issued/partially_paid/paid in the last 12 months. Amber at 80%, red at 100%.",
            },
          },
          {
            heading: { ar: "بدء التسجيل", en: "Starting registration" },
            body: {
              ar: "اضغط «ابدأ التسجيل» على البطاقة، ثم حدّث الحالة من PATCH /vat/registration بعد استلام شهادتك من هيئة الزكاة.",
              en: "Click 'Start registration' on the card, then update status via PATCH /vat/registration once your ZATCA certificate is issued.",
            },
          },
        ],
      }),
      M({
        slug: "vat-auto-hide",
        position: 16,
        appPath: "/onboarding",
        roles: ["owner", "manager", "accountant", "sales", "cashier"],
        title: { ar: "إخفاء تلقائي لحقول الضريبة", en: "Auto-Hide VAT Fields" },
        summary: {
          ar: "إذا لم تكن منشأتك مسجَّلة في ضريبة القيمة المضافة، تختفي حقول VAT تلقائيًا من POS والفواتير والمشتريات.",
          en: "If your entity isn't VAT-registered, VAT fields are auto-hidden across POS, invoices, and procurement.",
        },
        sections: [
          {
            heading: { ar: "ضبط الحالة", en: "Setting the status" },
            body: {
              ar: "في الخطوة 1 من /onboarding أجب على «هل أنت مسجَّل في ضريبة القيمة المضافة؟». يمكن تعديل ذلك لاحقًا من /settings.",
              en: "On step 1 of /onboarding, answer the 'Are you VAT-registered?' question. You can change it later from /settings.",
            },
          },
        ],
      }),
      M({
        slug: "onboarding",
        position: 17,
        appPath: "/onboarding",
        roles: ["owner"],
        title: { ar: "التسجيل والإعداد الموجَّه", en: "Signup & Guided Onboarding" },
        summary: {
          ar: "تسجيل شركة جديدة من /signup ثم معالج إعداد من 5 خطوات: المنشأة، الفروع، المستخدمون، المنتجات، الإعدادات الضريبية.",
          en: "Create a company at /signup, then a 5-step wizard: business profile, branches, users, products, tax settings.",
        },
        sections: [
          {
            heading: { ar: "إنشاء حساب", en: "Creating an account" },
            body: {
              ar: "افتح /signup، أدخل اسم الشركة، البريد، كلمة السر القوية، رقم الجوال. ستُنقل تلقائيًا إلى /onboarding.",
              en: "Open /signup, enter company name, email, strong password, and phone. You will be moved to /onboarding automatically.",
            },
          },
        ],
      }),
      M({
        slug: "landing",
        position: 18,
        appPath: "/welcome",
        roles: ["public"],
        title: { ar: "صفحة البداية", en: "Landing Page" },
        summary: {
          ar: "صفحة /welcome التسويقية العامة: عرض المنتج، شاشات نموذجية، المميزات، CTA إلى /signup و /login.",
          en: "Public marketing landing page at /welcome: hero, mockup screens, features, CTAs to /signup and /login.",
        },
        sections: [
          {
            heading: { ar: "للزوّار", en: "For visitors" },
            body: {
              ar: "تُحوَّل المستخدمين المسجَّلين تلقائيًا إلى / (لوحة القيادة).",
              en: "Authenticated users are redirected automatically to / (the dashboard).",
            },
          },
        ],
      }),
      M({
        slug: "projects",
        position: 19,
        appPath: "/projects",
        roles: ["owner", "manager"],
        title: { ar: "المشاريع", en: "Projects" },
        summary: {
          ar: "إدارة مشاريع بلوحة Kanban أو عرض قائمة، مع ميزانيات لكل مشروع ومؤشر تقدّم.",
          en: "Project management with Kanban or list view, per-project budgets, and progress indicator.",
        },
        sections: [
          {
            heading: { ar: "إنشاء مشروع", en: "Creating a project" },
            body: {
              ar: "افتح /projects → «مشروع جديد»، أدخل الاسم، الميزانية، تاريخ البدء/النهاية، ثم أضف مهام بسحبها بين أعمدة Kanban.",
              en: "Open /projects → 'New project', enter name, budget, start/end dates, then add tasks and drag them between Kanban columns.",
            },
          },
        ],
      }),
      M({
        slug: "marketing",
        position: 20,
        appPath: "/marketing",
        roles: ["owner", "manager", "marketing"],
        title: { ar: "التسويق", en: "Marketing" },
        summary: {
          ar: "حملات تسويقية مع قمع Leads ومتابعة معدل التحويل.",
          en: "Marketing campaigns with a leads funnel and conversion tracking.",
        },
        sections: [
          {
            heading: { ar: "إطلاق حملة", en: "Launching a campaign" },
            body: {
              ar: "افتح /marketing → «حملة جديدة»، حدّد القناة والميزانية والفترة، اربطها بقائمة Leads.",
              en: "Open /marketing → 'New campaign', pick channel, budget, period, and link it to a leads list.",
            },
          },
        ],
      }),
      M({
        slug: "admin-panel",
        position: 21,
        appPath: "/admin",
        roles: ["owner", "manager"],
        title: { ar: "لوحة تحكم المدير", en: "Admin Panel" },
        summary: {
          ar: "إشراف المنصّة في خمس تبويبات: نظرة عامة، الدعم الفني، الإعلانات، الميزات، السجلات.",
          en: "Platform oversight in five tabs: overview, support tickets, announcements, feature flags, audit logs.",
        },
        sections: [
          {
            heading: { ar: "نشر إعلان", en: "Publishing an announcement" },
            body: {
              ar: "افتح /admin → تبويب «الإعلانات»، اضغط «إعلان جديد»، حدّد العنوان، النص، تاريخ الانتهاء. سيظهر لكل المستخدمين.",
              en: "Open /admin → 'Announcements' tab, click 'New announcement', set title, body, expiry. It appears for every user.",
            },
          },
          {
            heading: { ar: "تشغيل/إيقاف ميزات", en: "Toggling features" },
            body: {
              ar: "تبويب «الميزات» يعرض الميزات حسب الفئة مع مفاتيح تشغيل/إيقاف فورية.",
              en: "The 'Features' tab lists feature flags by category with instant on/off toggles.",
            },
          },
        ],
      }),
    ],
  },
];

export function findModule(slug: string): DocModule | null {
  for (const cat of DOC_CATEGORIES) {
    for (const m of cat.modules) {
      if (m.slug === slug) return m;
    }
  }
  return null;
}

export function allModules(): DocModule[] {
  return DOC_CATEGORIES.flatMap((c) => c.modules);
}
