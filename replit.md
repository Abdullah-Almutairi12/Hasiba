# حاسبة.AI — ERP System

## Overview

Full-stack ERP system targeting Arabic/Saudi businesses, inspired by Odoo. Built as a pnpm workspace monorepo using TypeScript with a dark glassmorphism dashboard and clean light-mode internal pages.

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
15. **لوحة تحكم المدير (Admin Panel)** — `/admin` route, manager-only. Single-page tabs: نظرة عامة (KPIs + system health + announcements), الدعم الفني (CRUD support tickets, reply + status), الإعلانات (publish/expire/delete), الميزات (toggle feature flags grouped by category), السجلات (recent audit log entries). Backed by tables `support_tickets`, `announcements`, `feature_flags`. Endpoints under `/api/admin/*` gated by `requireRole("manager")`. Sidebar entry "لوحة الإدارة" appears only for managers.

## Artifacts

- `artifacts/api-server` — Express 5 API server on port 8080 (path: `/api`)
- `artifacts/erp-system` — React + Vite frontend on port 19692 (preview path: `/`)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
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
- Mutations for projects/marketing require `manager` or `accountant`. Reads for projects/marketing are open to any authenticated user.
- `/users` endpoints are restricted to `manager`. The response uses an explicit safe-column projection — `passwordHash` is NEVER returned.
- Validation errors (Zod) return 400 via the `handleRouteError` helper in `lib/handle-error.ts`.

## Important Notes

- `lib/api-zod/src/index.ts` must contain ONLY `export * from "./generated/api";` — do not add other exports
- Orval config: no `schemas` option in zod output section
- All frontend API hooks import from `@workspace/api-client-react`
- UI is fully RTL (Arabic)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
