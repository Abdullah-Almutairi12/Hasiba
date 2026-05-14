CREATE TABLE IF NOT EXISTS "marketplace_connectors" (
  "id" serial PRIMARY KEY NOT NULL,
  "branch_id" integer,
  "platform" text NOT NULL,
  "display_name" text NOT NULL,
  "store_url" text,
  "environment" text DEFAULT 'production' NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "default_warehouse_id" integer,
  "webhook_secret" text,
  "settings" jsonb,
  "last_sync_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketplace_connectors"
    ADD CONSTRAINT "marketplace_connectors_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketplace_connectors"
    ADD CONSTRAINT "marketplace_connectors_default_warehouse_id_warehouses_id_fk"
    FOREIGN KEY ("default_warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_connectors_branch_platform_name_idx"
  ON "marketplace_connectors" ("branch_id","platform","display_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_connectors_platform_idx"
  ON "marketplace_connectors" ("platform");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketplace_product_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "connector_id" integer NOT NULL,
  "product_id" integer NOT NULL,
  "external_product_id" text NOT NULL,
  "external_variant_id" text,
  "last_pushed_at" timestamp,
  "last_inventory_pushed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketplace_product_mappings"
    ADD CONSTRAINT "marketplace_product_mappings_connector_id_marketplace_connectors_id_fk"
    FOREIGN KEY ("connector_id") REFERENCES "marketplace_connectors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketplace_product_mappings"
    ADD CONSTRAINT "marketplace_product_mappings_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_pm_connector_external_idx"
  ON "marketplace_product_mappings" ("connector_id","external_product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_pm_product_idx"
  ON "marketplace_product_mappings" ("product_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketplace_order_imports" (
  "id" serial PRIMARY KEY NOT NULL,
  "connector_id" integer NOT NULL,
  "external_order_id" text NOT NULL,
  "external_order_number" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "so_id" integer,
  "customer_id" integer,
  "total" numeric(18, 2),
  "raw_payload" jsonb,
  "error_message" text,
  "imported_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketplace_order_imports"
    ADD CONSTRAINT "marketplace_order_imports_connector_id_marketplace_connectors_id_fk"
    FOREIGN KEY ("connector_id") REFERENCES "marketplace_connectors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketplace_order_imports"
    ADD CONSTRAINT "marketplace_order_imports_so_id_sales_orders_id_fk"
    FOREIGN KEY ("so_id") REFERENCES "sales_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketplace_order_imports"
    ADD CONSTRAINT "marketplace_order_imports_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_oi_connector_external_idx"
  ON "marketplace_order_imports" ("connector_id","external_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_oi_status_idx"
  ON "marketplace_order_imports" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketplace_sync_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "connector_id" integer NOT NULL,
  "operation" text NOT NULL,
  "direction" text DEFAULT 'outbound' NOT NULL,
  "success" boolean DEFAULT true NOT NULL,
  "payload_size_bytes" integer,
  "latency_ms" integer,
  "status_code" integer,
  "external_ref" text,
  "error_message" text,
  "payload_summary" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "marketplace_sync_logs"
    ADD CONSTRAINT "marketplace_sync_logs_connector_id_marketplace_connectors_id_fk"
    FOREIGN KEY ("connector_id") REFERENCES "marketplace_connectors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_sl_connector_created_idx"
  ON "marketplace_sync_logs" ("connector_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_sl_success_idx"
  ON "marketplace_sync_logs" ("success");
