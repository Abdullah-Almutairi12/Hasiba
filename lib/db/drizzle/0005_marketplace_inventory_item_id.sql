-- Shopify exposes two different per-variant identifiers:
--   * `variant_id` — used by order webhooks / line items
--   * `inventory_item_id` — required by the Inventory Levels API
-- Persist both so order import can resolve variants AND inventory
-- pushes target the correct Shopify inventory item.
ALTER TABLE "marketplace_product_mappings"
  ADD COLUMN IF NOT EXISTS "external_inventory_item_id" text;
