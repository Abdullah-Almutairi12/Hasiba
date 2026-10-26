-- Existing counts are deliberately NOT backfilled with invented observations.
ALTER TABLE stock_take_lines ADD COLUMN IF NOT EXISTS count_checkpoint jsonb;
ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS closure_result jsonb;
CREATE TABLE IF NOT EXISTS stocktake_checkpoints (
  id uuid PRIMARY KEY,
  take_id integer NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  line_id integer NOT NULL REFERENCES stock_take_lines(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id),
  facts jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS stocktake_checkpoint_take_idx ON stocktake_checkpoints(take_id,line_id);
-- A zero-variance completion supersedes older observations too.
CREATE TABLE IF NOT EXISTS stocktake_product_fences (
  warehouse_id integer NOT NULL REFERENCES warehouses(id),
  product_id integer NOT NULL REFERENCES products(id),
  generation numeric(30,0) NOT NULL DEFAULT 0,
  PRIMARY KEY (warehouse_id,product_id)
);
