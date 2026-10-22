-- Match the ledger's ON CONFLICT expression, including NULL lot/variant.
-- Do not merge/destroy balances: duplicate historical quants must fail the
-- migration and be reviewed separately. The runner rolls this file back.
DROP INDEX IF EXISTS stock_quants_unique;
CREATE UNIQUE INDEX stock_quants_unique ON stock_quants
  (product_id, warehouse_id, COALESCE(variant_id, 0), COALESCE(lot_id, 0));

CREATE TABLE IF NOT EXISTS financial_requests (
  company_id integer NOT NULL REFERENCES companies(id),
  user_id integer NOT NULL,
  operation text NOT NULL,
  request_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id, operation, request_key)
);
