-- Independent, value-only ledger. No historical stock moves or prices change.
CREATE TABLE IF NOT EXISTS stock_revaluations (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  quant_id integer NOT NULL REFERENCES stock_quants(id),
  product_name text NOT NULL, warehouse_name text NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  old_cost numeric(30,16) NOT NULL CHECK (old_cost >= 0),
  target_cost numeric(30,16) NOT NULL CHECK (target_cost >= 0),
  old_value numeric(48,20) NOT NULL, new_value numeric(48,20) NOT NULL,
  delta numeric(18,2) NOT NULL CHECK (delta <> 0),
  quant_version text NOT NULL, last_move_id integer NOT NULL,
  variance_account_id integer NOT NULL REFERENCES accounts(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','confirmed','posted','cancelled')),
  created_by integer NOT NULL REFERENCES users(id),
  confirmed_by integer REFERENCES users(id), approved_by integer REFERENCES users(id),
  journal_entry_id integer UNIQUE REFERENCES journal_entries(id),
  created_at timestamp NOT NULL DEFAULT now(), confirmed_at timestamp,
  approved_at timestamp, cancelled_at timestamp, cancelled_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS stock_revaluations_company_idx ON stock_revaluations(company_id, id);
CREATE OR REPLACE FUNCTION protect_stock_revaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Valuation evidence cannot be deleted';
  END IF;
  IF OLD.status IN ('posted', 'cancelled') THEN
    RAISE EXCEPTION 'Final valuation evidence is immutable';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','confirmed_by','confirmed_at','approved_by','approved_at','journal_entry_id','cancelled_by','cancelled_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','confirmed_by','confirmed_at','approved_by','approved_at','journal_entry_id','cancelled_by','cancelled_at']) THEN
    RAISE EXCEPTION 'Valuation snapshot is immutable';
  END IF;
  IF NOT ((OLD.status = 'preview' AND NEW.status IN ('confirmed','cancelled'))
       OR (OLD.status = 'confirmed' AND NEW.status IN ('posted','cancelled'))) THEN
    RAISE EXCEPTION 'Invalid valuation transition';
  END IF;
  IF NEW.status = 'posted' AND (NEW.approved_by IS NULL OR NEW.approved_by = NEW.created_by
       OR NEW.approved_at IS NULL OR NEW.journal_entry_id IS NULL) THEN
    RAISE EXCEPTION 'Independent financial approval is required';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stock_revaluation_immutable ON stock_revaluations;
CREATE TRIGGER stock_revaluation_immutable BEFORE UPDATE OR DELETE ON stock_revaluations
FOR EACH ROW EXECUTE FUNCTION protect_stock_revaluation();
