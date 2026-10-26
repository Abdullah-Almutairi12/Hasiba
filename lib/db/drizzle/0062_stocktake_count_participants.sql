-- Count participation belongs to the session, not the current assignment or
-- surviving line. Never cascade it from a line/user deletion or rewrite it on
-- recount. The session itself has no public delete operation.
CREATE TABLE IF NOT EXISTS stocktake_count_participants (
  take_id integer NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  user_id integer NOT NULL,
  line_id integer NOT NULL,
  first_counted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (take_id,user_id,line_id)
);
ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS count_participation_incomplete boolean NOT NULL DEFAULT false;

-- Recover only evidenced actors, including actors of lines since removed.
-- Do NOT infer participation from the session creator or current assignee.
INSERT INTO stocktake_count_participants(take_id,user_id,line_id,first_counted_at)
SELECT t.id,a.user_id,(a.details::jsonb->>'lineId')::integer,min(a.created_at)
FROM audit_logs a
JOIN stock_takes t ON t.id=(a.details::jsonb->>'takeId')::integer
JOIN warehouses w ON w.id=t.warehouse_id AND w.company_id=a.company_id
WHERE a.action='inventory.stocktake.counted' AND a.entity='stock_take'
  AND a.user_id IS NOT NULL
GROUP BY t.id,a.user_id,(a.details::jsonb->>'lineId')::integer
ON CONFLICT DO NOTHING;

-- An unaudited historical actor must not be "replaced" by a new counter.
-- Keep this evidence gap even after recounting/deleting the current line.
UPDATE stock_takes t SET count_participation_incomplete=true
WHERE EXISTS(SELECT 1 FROM stock_take_lines l WHERE l.stock_take_id=t.id
  AND l.counted_qty IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM stocktake_count_participants p WHERE p.take_id=t.id AND p.line_id=l.id));
