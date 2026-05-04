# حاسبة.AI — Hasiba.AI ERP

نظام تخطيط موارد مؤسسات (ERP) متكامل مصمَّم للسوق السعودي والعربي، يجمع بين خصائص Odoo و Zoho و SAP في حزمة واحدة بواجهة عربية كاملة (RTL).

> **Full-stack Arabic-first ERP** — POS, Accounting, Inventory, Manufacturing, CRM, Sales, Purchasing, HR, ZATCA-compliant invoicing, and more.

---

## 📋 المحتويات

- [الميزات الرئيسية](#الميزات-الرئيسية)
- [البنية التقنية](#البنية-التقنية)
- [هيكل المشروع](#هيكل-المشروع)
- [البدء السريع](#البدء-السريع)
- [الأوامر الشائعة](#الأوامر-الشائعة)
- [قواعد البيانات والترحيل](#قواعد-البيانات-والترحيل)
- [عقد الـ API و Codegen](#عقد-الـ-api-و-codegen)
- [حسابات الاختبار](#حسابات-الاختبار)
- [النشر (Deploy)](#النشر-deploy)
- [المساهمة](#المساهمة)

---

## الميزات الرئيسية

### 🛒 نقاط البيع (POS)
- جلسات مفتوحة/مغلقة مع أرصدة افتتاحية وختامية
- دفع مقسّم متعدد (كاش/شبكة/تحويل/STC Pay/آجل) في نفس الفاتورة
- ربط مباشر بالمحاسبة وقيود مزدوجة تلقائية
- خصومات وعروض ولاء العملاء
- فواتير ZATCA Phase 2 (تشفير + ختم + QR Code)

### 📊 المحاسبة
- دليل حسابات هرمي قابل للتخصيص
- قيود يومية تلقائية لكل عملية (مبيعات، مشتريات، مخزون، تصنيع)
- فترات محاسبية وإقفال
- تقارير الميزانية / الدخل / التدفقات النقدية
- ضريبة القيمة المضافة 15% مع تقارير ZATCA

### 📦 المخزون
- مستودعات متعددة لكل فرع
- حركات مخزون كاملة (استلام، إصدار، تحويل، جرد)
- أرصدة فورية وتنبيهات الحد الأدنى
- تقييم المخزون بطريقة المتوسط المتحرك

### 🏭 التصنيع
- قوائم المواد (BOM) متعددة المستويات
- أوامر إنتاج مع متابعة حية
- استهلاك مكونات وتسجيل تكاليف فعلية
- فروقات التكلفة وترحيلها لـ COGS

### 💼 المبيعات والمشتريات
- عروض أسعار → أوامر بيع → تسليم → فاتورة
- أوامر شراء → استلام → فاتورة مورد
- مطابقة ثلاثية (PO ↔ GRN ↔ Invoice)
- إرسال أوامر الشراء بالبريد الإلكتروني مع PDF

### 👥 إدارة العملاء (CRM)
- قاعدة عملاء موحدة
- متابعة العملاء المحتملين والصفقات
- نقاط الولاء وحملات التسويق

### 🔐 الصلاحيات
- أدوار قابلة للتخصيص (مدير، محاسب، أمين صندوق، مشرف، إلخ)
- صلاحيات على مستوى الوحدة والإجراء
- سجل تدقيق (Audit Log) كامل

---

## البنية التقنية

| الطبقة | التقنية |
|--------|---------|
| اللغة | TypeScript (strict) |
| الواجهة الأمامية | React 18 + Vite + TailwindCSS + shadcn/ui |
| إدارة الحالة | TanStack Query (React Query) |
| التوجيه | wouter |
| الواجهة الخلفية | Node.js + Express |
| قاعدة البيانات | PostgreSQL + Drizzle ORM |
| التحقق | Zod (مولّد من OpenAPI) |
| عقد الـ API | OpenAPI 3.1 + Orval (codegen) |
| التغليف | pnpm workspaces (monorepo) |
| السجلات | pino (`req.log` للطلبات، `logger` للباقي) |

---

## هيكل المشروع

```text
.
├── artifacts/                     # تطبيقات قابلة للنشر
│   ├── api-server/                # خادم REST (Express + Drizzle)
│   ├── erp-system/                # واجهة ERP الرئيسية (React)
│   └── mockup-sandbox/            # بيئة عزل لمعاينة المكونات
├── lib/                           # مكتبات مشتركة (composite TS)
│   ├── api-spec/                  # ملف OpenAPI الأم + إعدادات Orval
│   ├── api-client-react/          # عميل React Query مولّد تلقائياً
│   ├── api-zod/                   # سكيمات Zod مولّدة من OpenAPI
│   └── db/                        # سكيمات Drizzle + الترحيلات
├── scripts/                       # أوامر صيانة وأدوات
├── pnpm-workspace.yaml            # تعريف الحزم وتثبيت إصدارات
├── tsconfig.base.json             # إعدادات TS مشتركة
└── tsconfig.json                  # حل composite للمكتبات
```

---

## البدء السريع

### المتطلبات
- Node.js 20+
- pnpm 9+
- PostgreSQL 14+ (متوفر تلقائياً عبر `DATABASE_URL` على Replit)

### التثبيت
```bash
pnpm install
```

### تشغيل التطبيقات

التطبيقات تعمل عبر **Workflows** على Replit (لا تستخدم `pnpm dev` من الجذر):

| الـ Workflow | الأمر | الوصف |
|--------------|-------|-------|
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` | خادم الـ API |
| `artifacts/erp-system: web` | `pnpm --filter @workspace/erp-system run dev` | واجهة ERP |
| `artifacts/mockup-sandbox: Component Preview Server` | `pnpm --filter @workspace/mockup-sandbox run dev` | معاينة المكونات |

محلياً (خارج Replit) يمكنك تشغيل أي تطبيق مباشرة:
```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/erp-system run dev
```

### الوصول
كل التطبيقات يتم توجيهها عبر بروكسي مشترك على المنفذ 80 حسب المسار المعرَّف في `artifact.toml`:
- API: `http://localhost:80/api/...`
- ERP UI: `http://localhost:80/`

---

## الأوامر الشائعة

### الفحص النوعي (TypeScript)
```bash
pnpm run typecheck          # فحص كامل (مكتبات + تطبيقات)
pnpm run typecheck:libs     # المكتبات فقط (composite build)
```

### بناء الإنتاج
```bash
pnpm run build              # typecheck ثم build لكل الحزم
```

### استهداف حزمة معينة
```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/erp-system run lint
```

---

## قواعد البيانات والترحيل

### مخططات Drizzle
موجودة في `lib/db/src/schema/` مقسَّمة حسب المجال:
- `accounting.ts` — دليل الحسابات، القيود، الفترات
- `pos.ts` — جلسات وأوامر نقاط البيع، الدفعات
- `sales.ts` — أوامر البيع، الفواتير، التسليم
- `purchasing.ts` — أوامر الشراء، فواتير الموردين
- `inventory.ts` — المنتجات، المستودعات، الحركات
- `manufacturing.ts` — قوائم المواد، أوامر الإنتاج
- `crm.ts` — العملاء، النقاط، الصفقات
- `auth.ts` — المستخدمون، الأدوار، الصلاحيات

### إنشاء ترحيل جديد
```bash
pnpm --filter @workspace/db run generate    # توليد SQL من تغييرات السكيما
pnpm --filter @workspace/db run migrate     # تطبيق الترحيلات على DATABASE_URL
```

### الوصول المباشر (تطوير)
```bash
psql "$DATABASE_URL"
```

---

## عقد الـ API و Codegen

نتبع نهج **contract-first**: تعريف الـ API في OpenAPI أولاً ثم توليد العميل والسكيمات تلقائياً.

### تعديل الـ API
1. حدّث `lib/api-spec/openapi.yaml` (المسارات، الأنواع، الـ enums).
2. أعِد توليد العميل والسكيمات:
   ```bash
   pnpm --filter @workspace/api-spec run codegen
   ```
3. سيتم تحديث:
   - `lib/api-client-react/src/generated/` — Hooks للـ React Query
   - `lib/api-zod/src/generated/` — سكيمات Zod للتحقق
4. استخدم الأنواع المولَّدة في الواجهة:
   ```ts
   import { useCreatePosOrder, type CreatePosOrderBody } from "@workspace/api-client-react";
   ```
5. استخدم سكيمات Zod في الخادم للتحقق من المدخلات.

### قاعدة ذهبية
- لا تعدّل الملفات في مجلدات `generated/` يدوياً — ستُمحى عند إعادة التوليد.
- لا تغيّر `info.title` في `openapi.yaml` — يتحكم بأسماء الملفات المولَّدة.

---

## حسابات الاختبار

| الحساب | البريد | كلمة المرور | الدور |
|--------|--------|-------------|-------|
| المدير العام | `admin@hasba.ai` | `admin123` | جميع الصلاحيات |

> 💡 يحتوي قاعدة البيانات على بيانات تجريبية (فروع، منتجات، عملاء، جلسات POS مفتوحة) جاهزة للاختبار.

---

## النشر (Deploy)

المشروع مهيأ للنشر عبر Replit Deployments:
1. اضغط زر **Deploy** في لوحة Replit.
2. سيتم تشغيل `pnpm run build` ثم نشر الـ API والواجهة عبر البروكسي المشترك.
3. متغيرات البيئة المطلوبة:
   - `DATABASE_URL` — رابط PostgreSQL
   - `SESSION_SECRET` — مفتاح تشفير الجلسات
   - `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` — للتخزين السحابي

---

## المساهمة

### إرشادات عامة
- **اللغة:** TypeScript صارمة، لا استخدام لـ `any` بدون مبرر.
- **التوثيق:** كل قرار معماري كبير يُحدَّث في `replit.md`.
- **السجلات:** لا تستخدم `console.log` في كود الخادم — استخدم `req.log` داخل المعالجات و `logger` خارجها.
- **الأخطاء:** أعِد `400` مع رسالة عربية واضحة لأخطاء التحقق، و `500` فقط للأخطاء غير المتوقعة.

### قبل أي PR
```bash
pnpm run typecheck    # يجب أن يمرّ بالكامل
pnpm run build        # تأكد من نجاح البناء
```

### قواعد الـ Workspace
- اسم الحزمة بصيغة `@workspace/<name>`.
- لا تشارك dependencies بين الحزم بشكل ضمني — كل حزمة تعرّف ما تحتاج.
- إن كانت dependency موجودة في `pnpm-workspace.yaml > catalog`، استخدم `"catalog:"` في `package.json`.
- لا تستورد artifact من artifact آخر — أنشئ مكتبة في `lib/` للمشاركة.

---

## الترخيص

MIT — راجع ملف `LICENSE` (إن وُجد).

---

## التواصل

للأسئلة والمساهمات، افتح Issue على المستودع أو تواصل مع فريق التطوير.

**صُنع بـ ❤️ في المملكة العربية السعودية 🇸🇦**
