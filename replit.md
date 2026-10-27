# حاسبة.AI — ERP System

## Overview

Full-stack ERP system targeting Arabic/Saudi businesses, inspired by Odoo. Built as a pnpm workspace monorepo using TypeScript with a dark glassmorphism dashboard and clean light-mode internal pages.

## Mandatory task acceptance

Writing code, building successfully, or increasing test counts does not complete
a task. For each assigned task: define its scope and acceptance criteria; review
the change and its dependencies; execute the changed behavior; test relevant
allowed, denied and error paths; check related-function regressions; fix discovered
defects and rerun affected checks; save a specific tested version and deliver
evidence tied to it. Distinguish browser evidence predating a later runtime change.
Skipped checks are not successes. State what was and was not tested; never promise
that the entire program is free of errors. These rules apply to future assigned
tasks without automatically opening new scope.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + Wouter + TanStack Query + Recharts + Framer Motion
- **Styling**: Tailwind CSS + shadcn/ui, IBM Plex Sans Arabic + Inter, RTL
- **Build**: esbuild (CJS bundle)

## Modules

1. **لوحة القيادة التنفيذية** — Dark glassmorphism dashboard with AI insights, sales charts, health score, branch performance
2. **نقطة البيع (POS)** — Point-of-sale system with sessions and orders
3. **المنتجات والمخزون** — Products with categories, stock levels, low-stock alerts
4. **فواتير الموردين (AI)** — AI-powered invoice extraction with on-device camera + photo upload. The "Supplier Invoice Scanner Agent" uses OpenAI Vision (gpt-5-mini) via `/api/invoices/scan` to extract supplier name, invoice number, dates, line items, subtotal, VAT and total. After user review, `/api/invoices/from-scan` commits everything inside a single DB transaction: inserts the invoice, matches each line to an existing product (or auto-creates one under the "غير مصنف" category) and increments stock, and posts double-entry journal lines (Dr Inventory + Dr VAT-Inputs / Cr Suppliers). Routes are gated to manager+accountant roles, scan is rate-limited (15/15min), accepts up to a 20mb base64 JPEG/PNG/WEBP image, and returns 400/409/502 with proper error taxonomy. Includes ZATCA QR support on existing invoices.
5. **المحاسبة والامتثال** — Journal entries, cash flow, ZATCA integration status
6. **التقارير والتحليلات** — Reporting and analytics
7. **العملاء** — Customer management with order history
8. **الفروع، المستخدمون، الإعدادات (NCA ECC)** — Multi-branch ops, user/permission management, security settings
9. **التسجيل والإعداد الموجّه** — Full-screen `/signup` (create company) and `/onboarding` (5-step wizard) flows
10. **التقارير الذكية + كشف الاحتيال** — AI Copilot, predictive forecast, CLV, benchmarks, fraud detection table
11. **POS Loyalty + ZATCA badge** — In-cart customer loyalty (points → discount) with combined effectiveDiscount sent to backend so UI total mirrors persisted total
12. **المشاريع** — `/projects` page with Kanban board + list view, project budgets and progress
13. **التسويق** — `/marketing` page with campaigns and leads pipeline, conversion tracking
14. **صفحة البداية (Landing)** — `/welcome` public marketing landing page with hero, mockup preview, features grid, how-it-works section, dark CTA, and footer. CTAs link to `/signup` and `/login`. Auto-redirects authenticated users to `/`.
15. **المعاملات بين الشركات (Intercompany Mirror, Phase 5)** — `/intercompany` page (finance roles). When a sales invoice is issued to a customer with `linkedCompanyId` set (or a PO to a supplier with `linkedCompanyId` set), `mirrorSalesInvoice` / `mirrorPurchaseOrder` (in `lib/intercompany-mirror.ts`) auto-creates the mirror document in the sibling company inside the same DB transaction, links the pair via `intercompany_links` (kind, status=matched|void|resynced, unique on (kind, source_doc_id)), and writes an audit row. Loop guard via `isIntercompany` flag. Mirror writes bypass `scopedDb` and stamp `companyId` explicitly. Counterparty supplier/customer auto-provisioned when missing. `POST /intercompany/links/:id/void` neutralises the mirror; `POST /intercompany/links/:id/resync` re-emits it. All routes gated by `financeGuard` and require the actor to hold owner/manager/accountant on both source AND target company via `user_companies`. Schema additions: `customers.linkedCompanyId`, `suppliers.linkedCompanyId`, `{customer_invoices,invoices,purchase_orders}.{isIntercompany,counterpartyCompanyId}` (idempotent `initIntercompany()` in `app.ts`).
16. **حزمة الامتثال الضريبي للمنشآت الصغيرة (ZATCA SMB Suite)** — يضيف الحقول `companies.vatRegistrationStatus` (`registered`/`voluntary`/`not_registered`، الافتراضي `registered` للتوافق العكسي)، `vatRegistrationDate`، `vatThreshold{80,100}AlertedAt`. خدمة `lib/vat-threshold.ts` تحسب مبيعات Rolling 12 شهرًا من `pos_orders.(subtotal-discount)` + `customer_invoices.(subtotal-discount)` للحالات issued/partially_paid/paid وتقارن ضد حدّ التسجيل الإلزامي 375,000 ر.س + الاختياري 187,500 ر.س. مسارات `GET /vat/status` (snapshot عام)، `PATCH /vat/registration` (owner/manager/accountant) لتحديث الحالة + الرقم الضريبي مع مسح طوابع debounce، و`POST /vat/threshold/check` لاجتياح يدوي يُصدر تنبيه dashboard واحد (`type:warning` عند 80٪ أو `type:danger` عند 100٪) ويُسجّل الطابع في الـ companies row لمنع التكرار. الواجهة: `VatThresholdCard` على `/dashboard` تعرض شريط تقدّم مع تدرّج أخضر/كهرماني/أحمر + CTA "ابدأ التسجيل"؛ سؤال جديد في الخطوة 1 من `/onboarding` يحفظ الاختيار عبر PATCH عند الإنهاء. `useVatStatus()` و`useVatEnabled()` يتيحان إخفاء حقول الـ VAT في الواجهة عندما `status=not_registered`. تهيئة الأعمدة عبر `initVatRegistration()` (idempotent ALTER). الاختبارات: `lib/vat-threshold.test.ts` (rolling sum + 80٪/100٪ thresholds + gating).
17. **لوحة تحكم المدير (Admin Panel)** — `/admin` route, manager-only. Single-page tabs: نظرة عامة (KPIs + system health + announcements), الدعم الفني (CRUD support tickets, reply + status), الإعلانات (publish/expire/delete), الميزات (toggle feature flags grouped by category), السجلات (recent audit log entries). Backed by tables `support_tickets`, `announcements`, `feature_flags`. Endpoints under `/api/admin/*` gated by `requireRole("manager")`. Sidebar entry "لوحة الإدارة" appears only for managers.

## Artifacts

- `artifacts/api-server` — Express 5 API server on port 8080 (path: `/api`)
- `artifacts/erp-system` — React + Vite frontend on port 19692 (preview path: `/`)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only, interactive)
- `pnpm --filter @workspace/db run migrate` — non-interactive installer: on a genuinely empty database, first installs the frozen snapshot in `lib/db/bootstrap/`, then applies `lib/db/drizzle/*.sql` in order. Existing application schemas never receive the baseline. Tracks history, serializes installers, and uses per-statement savepoints inside atomic migration files. Historical SQL is immutable; add new migrations for future changes. Runs before api-server `dev`. See `lib/db/bootstrap/README.md` for limits.
- `pnpm run test:isolated` — normal tests install a fresh disposable database through migrations, without schema push. `--legacy-upgrade` explicitly reconstructs the pinned previous database package for upgrade verification; it never uses application data.
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Database Tables

Core: `branches`, `warehouses`, `categories`, `products`, `customers`, `pos_sessions`, `pos_orders`, `invoices`, `journal_entries`, `alerts`, `users`, `audit_logs`, `session`
Projects: `projects`, `project_tasks`
Marketing: `campaigns`, `leads`

## Internationalization (i18n)

- `i18next` + `react-i18next`. Config in `artifacts/erp-system/src/i18n/index.ts`.
- Locale JSON files: `src/i18n/ar.json` (default) and `src/i18n/en.json`.
- `useLanguage()` hook (`src/hooks/use-language.ts`) exposes `language`, `isRTL`, `setLanguage`, `toggleLanguage`, and `t`. It persists the choice to `localStorage` (`hasba.lang`) and updates `document.documentElement.lang/dir` on switch.
- A language toggle button is in the layout header (next to the theme toggle) and on the login page top-right.
- The sidebar `side` flips between `right` (RTL) and `left` (LTR) based on language.
- Currently translated: layout (sidebar nav + groups, header), login page. Inner business pages (dashboard, projects, marketing, etc.) intentionally remain in Arabic; t() keys can be added incrementally without further infrastructure changes.

## Mobile Responsiveness

- `<meta name="viewport">` allows pinch-zoom (removed `maximum-scale=1`).
- Sidebar uses shadcn's mobile drawer (Sheet) automatically below the `md` breakpoint via `useIsMobile`.
- Layout header padding/gap collapse on small screens (`px-3 sm:px-6`, `gap-2 sm:gap-4`).
- Page content padding scales: `p-3 sm:p-4 md:p-6`.
- shadcn `Table` already wraps in `overflow-auto`, so wide tables scroll horizontally inside their cards.
- KPI grids in Projects/Marketing collapse to 1 column below `sm` (`sm:grid-cols-2 lg:grid-cols-4`).
- Login page: brand panel hidden below `lg`, form padding collapses, header buttons wrap.

## AI Models (نماذج الذكاء الاصطناعي)

Five models registered in `ai_models` table, exposed via `/api/ai/*`:

1. **sales_forecast** — Linear regression on daily POS totals + EWMA smoothing → `/ai/predict/sales-forecast` returns next 7 days. Accuracy = (1 − MAPE).
2. **customer_churn** — RFM scoring (Recency/Frequency/Monetary) → `/ai/predict/at-risk-customers`.
3. **fraud_detection** — z-score on order value, item count, hour-of-day → `/ai/predict/fraud-anomalies`.
4. **product_recommendations** — Basket lift analysis on `pos_orders.items` jsonb → `/ai/predict/recommendations`.
5. **ai_assistant** — Natural-language chat using OpenAI `gpt-5-mini`. Pulls live business context (last-30-days sales, branches, products, customers, open invoices) into the system prompt. Endpoint: `POST /ai/assistant/ask` (manager-only, rate-limited 30 req/15min/IP).

Model registry endpoints (manager-only): `GET /ai/models`, `POST /ai/models/:key/train`, `POST /ai/models/train-all`. Prediction endpoints require manager or accountant role. Training stores parameters in `ai_models.parameters` jsonb; predictions auto-train on first use if params are missing.

OpenAI integration provisioned via Replit AI Integrations proxy (`AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`). Files: `lib/ai-models.ts`, `lib/ai-assistant.ts`, `lib/openai-client.ts`, `routes/ai.ts`. Admin UI exposes two tabs: "نماذج AI" (model cards + predictions panel) and "المساعد الذكي" (chat).

## Auth & Authorization

- Session-based via `express-session` + `connect-pg-simple` (cookie name `hasba.sid`).
- All routes after `/auth/*` and `/health` are protected by `requireAuth` (mounted in `routes/index.ts`).
- Role-based authorization via `requireRole(...roles)` middleware. Role is stored in session (`req.session.role`) on login/signup.
- `passwordHash` is NEVER returned from the `/users` endpoints (explicit safe-column projection).
- Validation errors (Zod) return 400 via the `handleRouteError` helper in `lib/handle-error.ts`.

### 8-Role Permissions Model (Odoo/Zoho/SAP-style)

Roles: `owner`, `manager`, `accountant`, `sales`, `cashier`, `inventory`, `marketing`, `auditor`. The catalogue served at `GET /users/roles` is the single source of truth for the UI.

Server-side guards live in `artifacts/api-server/src/middlewares/require-role.ts`:

| Guard | Allowed roles | Used for |
|---|---|---|
| `adminGuard` | owner, manager | branches, projects, /admin, user CRUD |
| `financeGuard` | owner, manager, accountant | accounting writes, invoice writes |
| `salesWriteGuard` | owner, manager, sales, cashier | customers writes |
| `posGuard` | owner, manager, sales, cashier | POS writes |
| `inventoryGuard` | owner, manager, inventory | products/warehouses writes |
| `marketingGuard` | owner, manager, marketing | marketing writes |
| `reportReadGuard` | owner, manager, accountant, auditor | reports module |
| `analyticsReadGuard` | owner, manager, accountant, marketing, auditor | analytics |
| `exportsGuard` | owner, manager, accountant, auditor, inventory, marketing | data exports |
| `invoiceReadGuard` | owner, manager, accountant, inventory, auditor | GET /invoices/* |
| `supplierReadGuard` | owner, manager, accountant, inventory, auditor | GET /suppliers/* |
| `posReadGuard` | owner, manager, accountant, sales, cashier, auditor | GET /pos/* |
| `auditReadGuard` | owner, manager, auditor | GET /security/audit-logs |

Frontend mirror in `artifacts/erp-system/src/hooks/use-permissions.ts` (`NAV_PERMISSIONS` + `canSee()`). The sidebar in `components/layout.tsx` filters nav by role and the `/users` page exposes full CRUD with the 8-role catalogue.

**Important pitfall (fixed):** `router.use(guard)` without a path prefix runs for every request that enters the router, regardless of route matching. When applying a router-level guard, always scope it: `router.use("/reports", reportReadGuard)`.

### CSRF defense-in-depth

Session cookies use `SameSite=lax`, which blocks the bulk of CSRF
vectors. On top of that, `middlewares/require-same-origin.ts` runs
right after `requireAuth` and rejects POST/PUT/PATCH/DELETE whose
`Origin` (or fallback `Referer`) is not in the allowlist
(`ALLOWED_ORIGINS` + `REPLIT_DOMAINS` + localhost in dev). Header-less
requests (curl, native mobile, S2S) pass through — they cannot forge
cross-site requests through a browser. Webhook routes are mounted
BEFORE this middleware and remain unaffected.

## Security & Observability (Task #269)

- **Tenant scoping (BOLA, KNOWN GAP)** — Schema audit confirmed only `employees` and `purchase_requisitions` have a direct `companyId` column. Tables `customer_invoices`, `purchase_orders`, `sales_orders`, `quotations`, `credit_notes`, `delivery_orders`, `rfqs`, `payment_runs`, `boms`, `work_orders`, `departments`, `leave_requests`, `payroll_runs`, `employee_documents`, `payslips`, `shifts`, `employee_shifts`, `opportunities` carry only `counterpartyCompanyId` (intercompany) and have NO direct tenant column. **Important caveat**: the affected list/detail/update/delete handlers (e.g. `GET /sales/orders`, `GET /sales/invoices`, `GET /procurement/purchase-orders`, `GET /crm/opportunities`, and their `:id` siblings) currently return rows across tenants once a user is authenticated. They are not yet scoped by joining through related tables (customer → company, warehouse → branch → company) either. This is a real cross-tenant read exposure that predates #269 and is documented here so the next task — a schema migration adding `company_id` columns + backfill, followed by `scopedDb` filters on these endpoints — is the prerequisite for any further hardening. Inline `TODO(BOLA)` comments mark the unfixable spots. The one legitimate fix that did land in #269: `GET /hr/employees/:id/eos` now scopes by `(id, companyId)` because `employees.companyId` exists.
- **Pagination** — `lib/pagination.ts` exposes `parsePagination(req)` (default=50, max=100). Applied to `/products`, `/customers`, `/pos/orders`, `/hr/employees`, `/sales/orders`, `/sales/invoices`, `/crm/opportunities`, `/procurement/purchase-orders`. Response shape unchanged (still arrays); only `.limit().offset()` capped.
- **API rate-limit** — `express-rate-limit` 300 req/min/IP mounted on `/api` after `sessionMiddleware`. Webhook endpoints (`/integrations/{payments,marketplaces,shipping,email}/webhook`) and `/health` are skipped via the `skip` predicate since they're HMAC-verified and bursty by design.
- **AI graceful degradation** — `openai-client.ts` exports `AIUnavailableError` (httpStatus=503) and a `tryAI<T>(fn)` wrapper. `askAssistant` (POST `/ai/assistant/ask`) and `extractInvoiceFromImage` (POST `/invoices/scan`) wrap upstream calls; when OpenAI is unreachable / over-quota / timing out, route handlers map the error to a clean Arabic 503 instead of a leaky 500/502.
- **Sentry observability** — `lib/sentry.ts` (api-server) and `src/lib/sentry.ts` (erp-system). Init is gated on `SENTRY_DSN` / `VITE_SENTRY_DSN` so absent env = no-op + info log. `@sentry/*` is externalised in `build.mjs` because Sentry lazy-requires `@opentelemetry/instrumentation-*` packages at init time which esbuild can't statically resolve. Env: `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` (default 0.1), `sendDefaultPii=false` (tenants own customer PII).
- **Test database isolation** — test mode requires `TEST_DATABASE_URL` pointing to a database named `hasba_test_<name>`. Missing or invalid test configuration fails closed; there is no fallback to application data. Prefer `pnpm test:isolated`, which creates a fresh, loopback-only local PostgreSQL cluster and removes it after the run. Never copy real tenant data into tests.

## Testing

Server-side unit + integration tests live next to the code they cover
(`src/**/*.test.ts`) and run with Vitest against a disposable test database.
Fixtures are tagged with `vitest-<ts>`; no application database is used.

- `pnpm test:isolated` — provision a disposable database and run the full suite.
- `pnpm --filter @workspace/erp-system test` — run frontend integration tests with jsdom and mocked HTTP responses (no server or database). These also run as the `erp-ui-tests` stage of `pnpm verify`.
- `pnpm test:isolated src/lib/intercompany-mirror.test.ts` — focused regression check (paths are relative to `artifacts/api-server`).
- `pnpm test:isolated src/routes/sales-return-cost.test.ts -t "scenario name"` — run only matching tests in that file. An optional leading `--` after `test:isolated` is also supported; the runner removes it before calling Vitest.
- `node --test scripts/test-isolated.test.mjs` — lightweight pnpm argument-forwarding and runner cleanup regression checks; PostgreSQL and Vitest are stubbed, so no database or financial tests run.
- `pnpm verify` — typecheck, full isolated tests, server and four client builds, and dependency audit. It records each result in `generated-artifacts/verification/summary.json` and exits nonzero if ANY required stage fails. Independent stages continue after a failure so the report remains useful.
- PostgreSQL binaries must be on PATH, or set `PG_BIN` to their directory.
- The SQL migration history assumes some runtime-created tables/columns already exist. The isolated runner therefore creates the current Drizzle schema first, then applies SQL migrations. This does NOT prove that migrations alone can bootstrap a blank database; do not hide this limitation.
- `pnpm --filter @workspace/api-server run test` requires an explicitly isolated `TEST_DATABASE_URL`; do not point it at development or production data.
- Current coverage:
  - `lib/integrations/shipping.test.ts` — webhook security boundary
    (carrier-scoped lookup, signature required for production carriers,
    HMAC verification, happy-path event ingestion)
  - `lib/scoped-db.test.ts` — multi-tenant isolation invariants
    (`stamp()` overrides client `companyId`, `scope()` filters by
    bound tenant, `scoped()` composes AND with extra predicates)
  - `lib/tenant-http.test.ts` — HTTP-level tenant isolation via
    supertest: two real users in two real companies log in through
    the full middleware chain and exercise `GET /api/products`,
    `POST /api/products` with forged `companyId`, `GET /api/products/:id`
    cross-tenant, and `GET /api/customers` per-tenant.
  - `middlewares/require-same-origin.test.ts` — CSRF Origin/Referer
    guard (safe-method pass-through, allowlist hit/miss, Referer
    fallback, localhost-port dev allowance).

Vitest config adds `setupFiles: ["reflect-metadata"]` so importing
`app` from a test reproduces the same polyfill ordering the bundled
production entry guarantees on line 1.

## Required verification and safe repair policy

- After every relevant code/dependency change, run the appropriate focused checks, then `pnpm verify` before delivery or release. Investigate the cause of a failing check, repair it, and rerun the affected checks. Do not delete a valid test, weaken assertions, make tenant ownership optional, or suppress type errors to obtain a pass.
- After three failed repair attempts for the same issue, stop attempts for that issue, document the evidence and required intervention, and continue independent work.
- Resolve company ownership from the authenticated and validated session and database relationships. Never use a hardcoded company ID, the first company in the database, or an unvalidated client-provided ID. Cross-company operations must authorize both sides and stay in one transaction.
- Do not provision tenant shifts/warehouse defaults or replay legacy stock across existing companies on process startup. Provision defaults only for the explicit company ID created by the authenticated company-creation flow; historical data maintenance needs separate approval.
- Keep code recovery points and preserve pre-existing changes. Generated backups, logs and test reports belong under ignored `generated-artifacts/`; they are local, not durable backups across workspace deletion. Restore code through checkpoints or extract a code archive into a separate directory for comparison; do not overwrite a dirty workspace blindly. A code backup is not a database backup.
- Do not publish or mutate real financial data without explicit user approval.
- GitHub Actions `.github/workflows/verify.yml` runs verification for PRs, pushes to main/master and manual dispatch when this repository is connected to GitHub. `pnpm release:check` is also configured as the root `.replit` deployment pre-build hook: the configured publishing path fails if verification fails, before artifact builds. No database migrations against application data are added to this hook. Require the Verify job in GitHub branch protection separately before using it as an organizational merge gate. The workflow and pre-build hook check code; neither publishes automatically.
- Instructions in this document guide an agent when it runs; they are not an autonomous repair service. CI runs checks, not code edits. The serving app must never repair its own code or financial data.
- `/api/healthz` reports process liveness; `/api/readyz` checks database reachability after initialization. Health checks are read-only. The latter must not be described as proving financial correctness or third-party service availability.
- Error logs include a generated request ID, event, error type/code and stack locations, not bodies, credentials, arbitrary DB error payloads or financial values. Use the request ID plus the route template to correlate a failure and reproduce it with synthetic test data. Sentry remains opt-in through the existing configuration; no new monitoring provider is enabled automatically.

## Build / bundle

The API is bundled to a single ESM file via esbuild. Large pure-JS
runtime libs (`openai`, `exceljs`, `pdfkit`, `qrcode`,
`arabic-reshaper`, `bidi-js`, `google-auth-library`) are kept as
externals — Node resolves them from `node_modules` at startup. This
cut `dist/index.mjs` from 9.3 MB → ~4.7 MB. Do **not** externalize
`@peculiar/x509` / `node-forge` / `tsyringe`: they require
`reflect-metadata` to load first, and bundling guarantees the init
order esbuild produces.

## Important Notes

- `lib/api-zod/src/index.ts` must contain ONLY `export * from "./generated/api";` — do not add other exports
- Orval config: no `schemas` option in zod output section
- All frontend API hooks import from `@workspace/api-client-react`
- UI is fully RTL (Arabic)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Returns / till settlement continuation
- The bounded follow-on to A2 is documented in `docs/enterprise-return-settlement-ar.md`; the unchanged original requirement IDs remain in `docs/enterprise-requirements-ar.md`.
- The operator workspace is `/returns`; the existing POS route is `/pos` (not its source filename).
- Preserve the distinction between a requested noncash refund and manually evidenced external confirmation; this batch does not execute network refunds.
- New operational role bindings cover this journey, not a wholesale IAM migration. Read the documented legacy compatibility and SAR-only payout limits before extending it.
