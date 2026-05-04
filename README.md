<div align="center">

# 🧮 Hasiba.AI — حاسبة.AI

### Integrated Accounting & ERP System for Retail and Restaurants in Saudi Arabia
### نظام محاسبي و ERP متكامل لقطاعَي التجزئة والمطاعم في المملكة العربية السعودية

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![ZATCA](https://img.shields.io/badge/ZATCA-Phase%202-success)](https://zatca.gov.sa/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Made with ❤️ in Saudi Arabia 🇸🇦**

</div>

---

<div dir="rtl">

# 🇸🇦 العربية

## نظرة عامة

**حاسبة.AI** نظام تخطيط موارد مؤسسات (ERP) ومحاسبة سحابي شامل، صُمِّم خصيصاً لاحتياجات قطاعَي **التجزئة** و**المطاعم** في المملكة العربية السعودية. يجمع النظام بين قوة Odoo ومرونة Zoho وعمق SAP في حزمة واحدة بواجهة عربية كاملة (RTL)، متوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك (**ZATCA Phase 2**) لإصدار الفواتير الإلكترونية.

## 🎯 لمن هذا النظام؟

- 🛍️ **محلات التجزئة** بفروع متعددة (سوبرماركت، إلكترونيات، أزياء، مستلزمات)
- 🍽️ **المطاعم والمقاهي** (طلبات داخلية، سفري، توصيل، شاشة مطبخ KDS)
- 🏭 **منشآت التصنيع الخفيف** (مخابز، مصانع أغذية، ورش)
- 🏢 **سلاسل الفروع** التي تحتاج محاسبة موحدة وتقارير لحظية

## ✨ الميزات الرئيسية

### 🛒 نقاط البيع (POS)
- جلسات افتتاح/إغلاق مع جرد صناديق
- **دفع مقسَّم** متعدد القنوات (كاش، شبكة، تحويل، STC Pay، آجل) في فاتورة واحدة
- خصومات وعروض ولاء فوريّة
- وضع المطعم: طاولات، طلبات داخلية/سفري/توصيل، تقسيم الفاتورة بين العملاء
- فواتير ZATCA المرحلة الثانية (تشفير + ختم رقمي + رمز QR)
- يعمل أونلاين مع مزامنة تلقائية

### 📊 المحاسبة الكاملة
- دليل حسابات هرمي مرن
- قيود مزدوجة تلقائية لكل عملية (بيع، شراء، مخزون، تصنيع، رواتب)
- فترات محاسبية وإقفال شهري/سنوي
- تقارير الميزانية، قائمة الدخل، التدفقات النقدية، ميزان المراجعة
- ضريبة القيمة المضافة 15% مع تقارير ZATCA جاهزة للتقديم

### 📦 المخزون والمستودعات
- مستودعات متعددة لكل فرع
- حركات كاملة (استلام، إصدار، تحويل، جرد، تالف)
- أرصدة لحظية وتنبيهات الحد الأدنى
- تقييم بالمتوسط المتحرك
- باركود ودعم قارئات التسوق

### 🏭 التصنيع
- قوائم المواد (BOM) متعددة المستويات
- أوامر إنتاج مع متابعة لحظية
- تسجيل تكاليف فعلية واحتساب فروقات التكلفة

### 💼 المبيعات والمشتريات
- دورة كاملة: عرض سعر → أمر بيع → تسليم → فاتورة → تحصيل
- دورة شراء كاملة: طلب → أمر شراء → استلام → فاتورة مورد → سداد
- مطابقة ثلاثية (PO ↔ GRN ↔ Invoice)

### 👥 العملاء (CRM) والولاء
- قاعدة عملاء موحدة بين الفروع
- نقاط ولاء وحملات تسويقية
- متابعة الفرص والصفقات

### 🔐 الصلاحيات والأمان
- أدوار قابلة للتخصيص (مدير، محاسب، أمين صندوق، مشرف فرع، …)
- صلاحيات على مستوى الوحدة والإجراء
- سجل تدقيق (Audit Log) كامل لكل العمليات الحساسة

## 🛠️ التقنيات المستخدمة

| الطبقة | التقنية |
|--------|---------|
| اللغة | **TypeScript** (strict mode) في كل الطبقات |
| الواجهة الأمامية | **React 18** + Vite + **TailwindCSS** + shadcn/ui |
| إدارة الحالة | TanStack Query (React Query) |
| الواجهة الخلفية | **Node.js 20** + Express |
| قاعدة البيانات | **PostgreSQL 14+** مع Drizzle ORM |
| التحقق | Zod (مولَّد تلقائياً من OpenAPI) |
| عقد الـ API | OpenAPI 3.1 + Orval لتوليد العميل |
| التغليف | pnpm workspaces (monorepo) |

## 🚀 البدء السريع

```bash
# 1. تثبيت الاعتماديات
pnpm install

# 2. تجهيز قاعدة البيانات
pnpm --filter @workspace/db run migrate

# 3. تشغيل الخادم والواجهة (عبر workflows في Replit)
#    أو محلياً:
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/erp-system run dev
```

افتح المتصفح على `http://localhost` وسجِّل دخول بحساب الاختبار:

| البريد | كلمة المرور |
|--------|--------------|
| `admin@hasba.ai` | `admin123` |

## 📚 وثائق إضافية
- `replit.md` — تفاصيل البنية المعمارية والقرارات التقنية
- `lib/api-spec/openapi.yaml` — عقد الـ API الكامل

</div>

---

# 🇬🇧 English

## Overview

**Hasiba.AI** is a comprehensive cloud-based **ERP and accounting system** purpose-built for the **retail** and **restaurant** sectors in **Saudi Arabia**. It combines the power of Odoo, the flexibility of Zoho, and the depth of SAP into a single Arabic-first (RTL) platform, fully compliant with **ZATCA Phase 2** e-invoicing requirements.

## 🎯 Who Is It For?

- 🛍️ **Multi-branch retail stores** (supermarkets, electronics, fashion, hardware)
- 🍽️ **Restaurants & cafés** (dine-in, takeaway, delivery, Kitchen Display Systems)
- 🏭 **Light manufacturing** (bakeries, food factories, workshops)
- 🏢 **Branch chains** needing unified accounting and real-time reporting

## ✨ Key Features

### 🛒 Point of Sale (POS)
- Cashier sessions with open/close cash counts
- **Split payments** across multiple methods (cash, card, transfer, STC Pay, credit) in a single bill
- Real-time discounts and loyalty promotions
- Restaurant mode: tables, dine-in/takeaway/delivery, **bill splitting between customers**
- ZATCA Phase 2 e-invoices (encryption + digital signature + QR code)
- Online-first with automatic sync

### 📊 Full Accounting
- Hierarchical chart of accounts
- Automatic double-entry journals for every operation (sales, purchases, inventory, manufacturing, payroll)
- Monthly/yearly accounting periods and closings
- Balance sheet, income statement, cash flow, trial balance
- 15% VAT with ZATCA-ready reports

### 📦 Inventory & Warehouses
- Multiple warehouses per branch
- Full movement tracking (receipts, issues, transfers, counts, scrap)
- Real-time stock levels and reorder alerts
- Moving-average valuation
- Barcode and scanner support

### 🏭 Manufacturing
- Multi-level Bills of Materials (BOM)
- Production orders with live tracking
- Actual cost recording and variance analysis

### 💼 Sales & Purchasing
- Full sales cycle: Quote → Sales Order → Delivery → Invoice → Collection
- Full purchase cycle: Requisition → PO → GRN → Vendor Invoice → Payment
- Three-way matching (PO ↔ GRN ↔ Invoice)

### 👥 CRM & Loyalty
- Unified customer database across all branches
- Loyalty points and marketing campaigns
- Lead and opportunity tracking

### 🔐 Permissions & Security
- Customizable roles (Admin, Accountant, Cashier, Branch Supervisor, …)
- Module- and action-level permissions
- Complete audit log of all sensitive operations

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Language | **TypeScript** (strict) end-to-end |
| Frontend | **React 18** + Vite + **TailwindCSS** + shadcn/ui |
| State | TanStack Query (React Query) |
| Backend | **Node.js 20** + Express |
| Database | **PostgreSQL 14+** with Drizzle ORM |
| Validation | Zod (auto-generated from OpenAPI) |
| API Contract | OpenAPI 3.1 + Orval codegen |
| Packaging | pnpm workspaces (monorepo) |

## 📁 Project Structure

```text
.
├── artifacts/                # Deployable applications
│   ├── api-server/           # REST API (Express + Drizzle)
│   ├── erp-system/           # Main ERP UI (React + Vite)
│   └── mockup-sandbox/       # Component preview sandbox
├── lib/                      # Shared composite libraries
│   ├── api-spec/             # OpenAPI contract + Orval config
│   ├── api-client-react/     # Auto-generated React Query hooks
│   ├── api-zod/              # Auto-generated Zod schemas
│   └── db/                   # Drizzle schemas + migrations
├── scripts/                  # Maintenance utilities
├── pnpm-workspace.yaml       # Workspace config + dependency catalog
├── tsconfig.base.json        # Shared strict TS defaults
└── tsconfig.json             # Composite solution for libs
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- pnpm 9+
- PostgreSQL 14+ (auto-provisioned via `DATABASE_URL` on Replit)

### Installation
```bash
pnpm install
```

### Database Migration
```bash
pnpm --filter @workspace/db run generate    # generate SQL from schema changes
pnpm --filter @workspace/db run migrate     # apply migrations
```

### Run the Apps

Apps run as **Replit workflows** — do **not** run `pnpm dev` from the root.

| Workflow | Command |
|----------|---------|
| API Server | `pnpm --filter @workspace/api-server run dev` |
| ERP UI | `pnpm --filter @workspace/erp-system run dev` |
| Mockup Sandbox | `pnpm --filter @workspace/mockup-sandbox run dev` |

All services are routed through a shared proxy on port 80 — never call internal ports directly.
- API → `http://localhost:80/api/...`
- UI → `http://localhost:80/`

### Test Account
| Email | Password | Role |
|-------|----------|------|
| `admin@hasba.ai` | `admin123` | Full access |

## 🧪 Common Commands

```bash
pnpm run typecheck          # full type check (libs + apps)
pnpm run typecheck:libs     # composite lib build only
pnpm run build              # full production build
pnpm --filter @workspace/api-spec run codegen   # regen API client + Zod
```

## 🔁 API Contract-First Workflow

We use a **contract-first** approach. To add or modify an endpoint:

1. Edit `lib/api-spec/openapi.yaml` (paths, types, enums).
2. Regenerate the client and schemas:
   ```bash
   pnpm --filter @workspace/api-spec run codegen
   ```
3. Use generated hooks in the frontend:
   ```ts
   import { useCreatePosOrder, type CreatePosOrderBody } from "@workspace/api-client-react";
   ```
4. Use generated Zod schemas on the server for input validation.

> ⚠️ Never edit files inside `generated/` folders — they are overwritten on regen.

## 🚢 Deployment

The project is configured for **Replit Deployments**:
1. Click **Deploy** in the Replit panel.
2. The build runs `pnpm run build` then publishes the API and UI behind the shared proxy over HTTPS.
3. Required environment variables:
   - `DATABASE_URL` — PostgreSQL connection
   - `SESSION_SECRET` — session encryption key
   - `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` — for object storage

## 🤝 Contributing

### Guidelines
- Strict TypeScript — no unjustified `any`.
- Update `replit.md` for any major architectural decision.
- **Never** use `console.log` in server code — use `req.log` inside handlers and `logger` elsewhere.
- Return `400` with a clear Arabic message for validation errors; reserve `500` for unexpected failures.

### Before opening a PR
```bash
pnpm run typecheck    # must pass
pnpm run build        # must succeed
```

### Workspace Rules
- Package names use the `@workspace/<name>` prefix.
- Each package declares its own dependencies — nothing is shared implicitly.
- If a dependency is in `pnpm-workspace.yaml > catalog`, use `"catalog:"` in `package.json`.
- Artifacts must **not** import from each other — promote shared code into a `lib/` package.

## 📜 License

Released under the **MIT License**. See [`LICENSE`](LICENSE) for details.

## 📬 Contact

For questions, bug reports, or contributions, please open an Issue on GitHub or reach out to the development team.

---

<div align="center">

**Hasiba.AI** — Built for Saudi businesses, by people who understand them.
**حاسبة.AI** — مبني للسوق السعودي، بأيدٍ تفهمه.

🇸🇦 صُنع بفخر في المملكة العربية السعودية 🇸🇦

</div>
