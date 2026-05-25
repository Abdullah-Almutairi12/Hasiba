-- Phase 3: Transfer Pricing & Zakat Compliance.
--
-- Adds `compliance_alerts`, `intercompany_agreements` and a
-- `market_reference_price` column on `products`. All statements are
-- idempotent so re-applying on a DB that was already pushed via
-- `drizzle-kit push` is a no-op.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "market_reference_price" numeric(12, 2);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "compliance_alerts" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'warning',
  "ref_type" text NOT NULL,
  "ref_id" integer NOT NULL,
  "ref" text,
  "counterparty_company_id" integer,
  "message" text NOT NULL,
  "deviation_pct" numeric(9, 4),
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'open',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "resolved_at" timestamp,
  "resolved_by" integer REFERENCES "users"("id"),
  "resolved_note" text
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "compliance_alerts_company_status_idx"
  ON "compliance_alerts" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_alerts_kind_idx"
  ON "compliance_alerts" ("company_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_alerts_ref_idx"
  ON "compliance_alerts" ("ref_type", "ref_id");
--> statement-breakpoint

-- Idempotency guard for the zakat scan: at most one OPEN zakat alert
-- per (company, counterparty) pair. Cron + manual run both rely on
-- this to coalesce repeated findings.
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_alerts_zakat_open_uniq"
  ON "compliance_alerts" ("company_id", "counterparty_company_id")
  WHERE "kind" = 'zakat' AND "status" = 'open';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "intercompany_agreements" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "counterparty_company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "pdf_url" text NOT NULL,
  "pdf_filename" text,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "notes" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "uploaded_by" integer REFERENCES "users"("id"),
  "uploaded_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "intercompany_agreements_pair_idx"
  ON "intercompany_agreements" ("company_id", "counterparty_company_id", "is_active");
