-- Allow multiple mappings per ERP product when the store models the
-- catalogue as variants. Uniqueness is now on
--   (connector_id, external_product_id, COALESCE(external_variant_id, ''))
-- so the same external product can carry many variant rows while still
-- blocking duplicates within a given (product, variant) pair.

DROP INDEX IF EXISTS "marketplace_pm_connector_external_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_pm_connector_external_variant_idx"
  ON "marketplace_product_mappings" (
    "connector_id",
    "external_product_id",
    (COALESCE("external_variant_id", ''))
  );
