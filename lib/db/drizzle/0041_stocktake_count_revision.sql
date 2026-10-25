-- Observations, not valuation: revisions prevent stale absolute counts (including ABA).
ALTER TABLE stock_take_lines ADD COLUMN count_revision numeric(30,0) NOT NULL DEFAULT 0;
