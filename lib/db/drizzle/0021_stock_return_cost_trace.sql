-- Additive only: never infer or rewrite costs on historical stock movements.
ALTER TABLE stock_moves
  ADD COLUMN IF NOT EXISTS invoice_line_id integer REFERENCES customer_invoice_lines(id),
  ADD COLUMN IF NOT EXISTS original_move_id integer REFERENCES stock_moves(id);
CREATE INDEX IF NOT EXISTS stock_moves_invoice_line_idx ON stock_moves(invoice_line_id);
CREATE INDEX IF NOT EXISTS stock_moves_original_move_idx ON stock_moves(original_move_id);
