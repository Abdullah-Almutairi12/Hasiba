-- New invoice allocations only. Never infer allocations for old invoices.
CREATE TABLE IF NOT EXISTS sales_issue_allocations (
  id serial PRIMARY KEY,
  invoice_line_id integer NOT NULL REFERENCES customer_invoice_lines(id),
  issue_move_id integer NOT NULL REFERENCES stock_moves(id),
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(18,4) NOT NULL CHECK (unit_cost >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_issue_allocations_line_move_unique
  ON sales_issue_allocations(invoice_line_id, issue_move_id);
CREATE INDEX IF NOT EXISTS sales_issue_allocations_move_idx
  ON sales_issue_allocations(issue_move_id);
