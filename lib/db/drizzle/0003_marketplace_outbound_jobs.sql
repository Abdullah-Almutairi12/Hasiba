CREATE TABLE IF NOT EXISTS "marketplace_outbound_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "connector_id" integer NOT NULL,
  "job_type" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 8 NOT NULL,
  "last_error" text,
  "next_run_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketplace_outbound_jobs"
    ADD CONSTRAINT "marketplace_outbound_jobs_connector_id_marketplace_connectors_id_fk"
    FOREIGN KEY ("connector_id") REFERENCES "marketplace_connectors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- Drop the legacy non-partial index if it exists from earlier deploys.
DROP INDEX IF EXISTS "marketplace_oj_dedupe_idx";
--> statement-breakpoint
-- Partial unique index: only queued rows must be unique by dedupe_key.
-- Done/failed/running rows are retained without blocking future enqueues.
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_oj_dedupe_queued_idx"
  ON "marketplace_outbound_jobs" ("dedupe_key")
  WHERE "status" = 'queued';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_oj_next_run_idx"
  ON "marketplace_outbound_jobs" ("status","next_run_at");
