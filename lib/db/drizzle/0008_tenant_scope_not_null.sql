-- Phase 2 tenant isolation: enforce NOT NULL on company_id for all
-- tenant-scoped tables. The application layer already filters every
-- read/write by req.session.companyId; this migration adds the DB-level
-- guarantee so that a missing scope predicate cannot produce a row
-- that "belongs to no tenant" and accidentally leak across companies.
--
-- The columns and FKs were created in 0000_init.sql as nullable.
-- Data was backfilled and verified to contain zero NULLs in prior
-- maintenance work before this migration was applied. The statements
-- below are idempotent — re-running them on an already-NOT-NULL column
-- is a no-op.

ALTER TABLE "products"   ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers"  ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices"   ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "branches"   ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "pos_orders" ALTER COLUMN "company_id" SET NOT NULL;
