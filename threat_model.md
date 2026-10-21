# Threat Model

## Project Overview

حاسبة.AI is a full-stack, multi-company (multi-tenant) ERP for Arabic/Saudi businesses.
pnpm monorepo: Express 5 API server (`artifacts/api-server`, `/api`), React/Vite frontends
(`artifacts/erp-system`, `artifacts/docs`, `artifacts/features-deck`, `artifacts/mockup-sandbox`),
PostgreSQL + Drizzle ORM. Modules: dashboard, POS, products/inventory, supplier invoices
(OpenAI Vision), accounting/ZATCA, reports, customers, HR, projects, marketing, CRM,
procurement, manufacturing, sales, intercompany mirroring, and an admin panel. Users belong
to one or more companies via `user_companies` with a per-company role; the active tenant lives
on `req.session.companyId`.

## Assets

- **User credentials & sessions** — password hashes, `hasba.sid` session cookies, 2FA state.
  Compromise → account takeover.
- **Cross-tenant business data** — quotations, sales/purchase orders, invoices, credit notes,
  receipts, bank accounts/statements, payroll, employees, projects, CRM leads/opportunities,
  stock. Each company must only see its own.
- **Financial control state** — fiscal periods/years, journal postings, commission postings,
  payments/refunds. Mutating these across tenants corrupts books.
- **Application secrets** — OpenAI (via Replit AI proxy), payment/shipping/email integration
  credentials, DB connection string, session signing key, webhook HMAC secrets.
- **PII** — customer/employee names, emails, phones, IBANs, addresses.

## Trust Boundaries

- **Browser → API** — all client requests are untrusted. Auth via `express-session`.
- **Public (pre-auth) routes** — health, auth, docs, HR device webhook (API key),
  integration webhooks (HMAC), portal magic-link (token), e-sign (token), intercompany
  email-action/unsubscribe (token). Each must verify its own token/signature.
- **Authenticated, cross-tenant, auth-only (mounted BEFORE `requireCompanyContext`)** —
  `/users`, `/admin`, `/companies`, `/app-settings`, `/storage`. These bypass company scoping
  and MUST enforce their own object/tenant/ownership checks. **This is the riskiest boundary.**
- **Authenticated, tenant-scoped (after `requireCompanyContext`)** — all business modules.
  `scopedDb(req)`/`getCompanyId(req)` bind queries to `session.companyId`.
- **Public ↔ Authenticated boundary enforced by** `requireAuth` + `requireSameOrigin` (CSRF).
- **User ↔ Admin boundary** — `require-role.ts` guards (`adminGuard`, `financeGuard`, etc.)
  read `req.session.role`.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/routes/*.ts` (mounted in `routes/index.ts`).
- **Tenant isolation core:** `lib/scoped-db.ts`, `middlewares/require-company-context.ts`,
  `middlewares/require-role.ts`, `middlewares/require-auth.ts`, `require-same-origin.ts`.
- **Highest-risk areas (confirmed BOLA-prone):** sales.ts, crm.ts, procurement.ts,
  manufacturing.ts, inventory.ts, accounting.ts, hr.ts, projects.ts, reports-builder.ts,
  integrations.ts, ai.ts, and the cross-tenant `users.ts`.
- **Known systemic pattern:** `company_id` columns exist on most tenant tables, but READ /
  detail / report / some mutation handlers resolve objects by raw `id` WITHOUT a `companyId`
  filter (or ownership join). Writes are more consistently scoped than reads. Several tables
  (`bank_accounts`, `bank_statements`, `fiscal_years`, `fiscal_periods`, `customer_receipts`,
  `users`) lack a direct `company_id`, so scoping must go through a join or `user_companies`.
- **Dev-only / lower priority:** `artifacts/mockup-sandbox` (design canvas), `artifacts/features-deck`.
- **Deployment:** not currently deployed (GetDeploymentInfo isDeployed=false).

## Threat Categories

### Elevation of Privilege / Broken Access Control (PRIMARY RISK)
The dominant, systemic vulnerability class. Two sub-patterns:
1. **Cross-tenant BOLA** — authenticated user of company A reads/mutates company B's objects
   because handlers look up by raw `id` without enforcing `companyId`. Confirmed across sales,
   CRM, procurement, manufacturing, inventory, HR, finance, and reporting modules.
2. **Cross-tenant account/admin control** — the auth-only `/users` surface lets a manager in
   one company reset passwords / change roles of users in ANY company (account takeover). On
   `/auth/switch-company`, the session `role` is NOT updated to the destination company's role,
   so privileges from the prior tenant leak.
Guarantee: every handler accessing a tenant-owned object MUST prove the object belongs to
`session.companyId` (direct predicate or ownership join) before read/write, and privileged
cross-tenant surfaces MUST additionally verify the actor's authority over the target tenant.
Role used for authorization MUST reflect the active company.

### Information Disclosure
Cross-tenant reads expose financial figures, PII, IBANs, payroll, and aggregated reports.
Guarantee: list/detail/report endpoints MUST filter by tenant; error responses MUST NOT leak
internals.

### Tampering
Cross-tenant writes (payroll mutations, fiscal period close, refunds, credential writes,
commission postings computed from all tenants) corrupt another company's state. Mass-assignment
of `role`/`companyId`/`ownerId`/`isActive` must be prevented; writes must be tenant-stamped.

### Spoofing
Public token/HMAC routes (webhooks, portal magic-link, e-sign, intercompany email links) must
verify signatures/tokens and bind them to the intended tenant/recipient. Session cookies must
stay unpredictable and expire.

### Injection
Raw SQL via `db.execute(sql\`...\`)` and the report-builder/data-source query runner must never
interpolate unsanitized user input. Supplier-invoice image upload must validate type/size.
