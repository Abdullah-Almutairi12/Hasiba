-- Phase 2 tenant isolation: enforce NOT NULL on company_id for every
-- tenant-scoped table. The application layer already filters every
-- read/write by req.session.companyId; this migration adds the DB-level
-- guarantee so a missing scope predicate cannot produce a row that
-- "belongs to no tenant" and accidentally leak across companies.
--
-- All columns and FKs were created in 0000_init.sql as nullable.
-- Existing rows were backfilled and verified to contain zero NULLs
-- (incl. orphaned warehouses + early export audit_logs that pre-date
-- companyId stamping) before this migration was applied. Statements
-- are idempotent — re-running them on an already-NOT-NULL column is
-- a no-op.
--
-- alerts is intentionally LEFT NULLABLE: background workers (email
-- retry, KPI eval) emit cross-tenant ops alerts; the
-- /dashboard/alerts handler uses strict eq() on companyId so NULL
-- alerts never leak into a tenant feed.

ALTER TABLE "products"        ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers"       ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices"        ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "branches"        ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "pos_orders"      ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "suppliers"       ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "warehouses"      ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects"        ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns"       ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads"           ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "employees"       ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_logs"      ALTER COLUMN "company_id" SET NOT NULL;
