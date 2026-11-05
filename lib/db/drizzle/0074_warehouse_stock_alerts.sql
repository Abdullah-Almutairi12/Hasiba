-- Explicit adoption only. Existing replenishment rules keep their old settings.
ALTER TABLE reorder_rules ADD COLUMN IF NOT EXISTS alert_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE reorder_rules ADD COLUMN IF NOT EXISTS alert_adopted_at timestamptz;
ALTER TABLE reorder_rules ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS warehouse_stock_alert_queue (
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id integer NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  PRIMARY KEY(product_id,warehouse_id)
);
CREATE TABLE IF NOT EXISTS warehouse_stock_alert_cycles (
  id bigserial PRIMARY KEY,
  rule_id integer NOT NULL REFERENCES reorder_rules(id),
  company_id integer NOT NULL REFERENCES companies(id),
  branch_id integer NOT NULL REFERENCES branches(id),
  warehouse_id integer NOT NULL REFERENCES warehouses(id),
  product_id integer NOT NULL REFERENCES products(id),
  alert_id integer NOT NULL UNIQUE REFERENCES alerts(id),
  quantity numeric(18,4) NOT NULL,
  threshold numeric(18,4) NOT NULL,
  status text NOT NULL CHECK(status IN ('open','recovered','disabled','unsupported')),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_stock_alert_one_open
  ON warehouse_stock_alert_cycles(rule_id) WHERE status='open';
CREATE OR REPLACE FUNCTION enqueue_warehouse_stock_alert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    INSERT INTO warehouse_stock_alert_queue(product_id,warehouse_id)
    SELECT OLD.product_id,OLD.warehouse_id WHERE EXISTS(
      SELECT 1 FROM reorder_rules WHERE product_id=OLD.product_id AND warehouse_id=OLD.warehouse_id AND alert_adopted_at IS NOT NULL)
    ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO warehouse_stock_alert_queue(product_id,warehouse_id)
    SELECT NEW.product_id,NEW.warehouse_id WHERE EXISTS(
      SELECT 1 FROM reorder_rules WHERE product_id=NEW.product_id AND warehouse_id=NEW.warehouse_id AND alert_adopted_at IS NOT NULL)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS warehouse_stock_alert_quant ON stock_quants;
CREATE TRIGGER warehouse_stock_alert_quant AFTER INSERT OR UPDATE OR DELETE ON stock_quants
  FOR EACH ROW EXECUTE FUNCTION enqueue_warehouse_stock_alert();
DROP TRIGGER IF EXISTS warehouse_stock_alert_rule ON reorder_rules;
CREATE TRIGGER warehouse_stock_alert_rule AFTER INSERT OR UPDATE ON reorder_rules
  FOR EACH ROW EXECUTE FUNCTION enqueue_warehouse_stock_alert();
