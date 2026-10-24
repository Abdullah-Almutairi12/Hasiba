ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS source_fingerprint text;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS source_fingerprint_version integer;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS review_invalidated_reason text;

-- V1 is intentionally conservative: every new business column is material
-- unless explicitly classified here as lifecycle/output/display metadata.
-- Do not change V1 semantics later: introduce a new fingerprint version.
CREATE FUNCTION approval_material_row_v1(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT value - ARRAY[
   'status','created_at','updated_at','approved_by','approved_at',
   'posted_by','posted_at','executed_at','confirmed_at',
   'requires_approval','sent_to_supplier_at','sent_to_supplier_email',
   'journal_entry_id','inventory_cost','cancellation_rounding',
   'received_qty','billed_qty','delivered_qty','invoiced_qty',
   'rejection_reason','reversed_by','reversed_at'
 ]::text[]
$$;

-- Source row locks are also the approval engine's first lock. Line writers
-- take that parent lock before changing material data; readers never lock
-- child rows, avoiding the header/line reverse-lock cycle.
CREATE FUNCTION approval_source_write_guard_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
 old_doc jsonb; new_doc jsonb; source_id integer; parent_ids integer[];
 parent_table text := TG_ARGV[0]; source_type text := TG_ARGV[1];
 parent_key text := TG_ARGV[2]; source_status text; material_change boolean; terminal_change boolean;
BEGIN
 old_doc := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END;
 new_doc := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END;
 material_change := approval_material_row_v1(old_doc) IS DISTINCT FROM approval_material_row_v1(new_doc);
 terminal_change := TG_OP='UPDATE' AND parent_key='id'
   AND old_doc->>'status' IS DISTINCT FROM new_doc->>'status'
   AND new_doc->>'status' NOT IN ('draft','pending','pending_approval','submitted','rejected','changes_requested')
   AND EXISTS (SELECT 1 FROM approval_requests WHERE record_id=(old_doc->>'id')::integer
     AND (doc_type=source_type OR (source_type='credit_note' AND doc_type='credit_note_cancel'))
     AND status='pending' AND source_fingerprint IS NOT NULL AND review_invalidated_at IS NULL);
 IF terminal_change AND new_doc->>'status' NOT IN ('cancelled','rejected') THEN
   RAISE EXCEPTION 'A pending review cannot be bypassed by changing document status' USING ERRCODE='23514';
 END IF;
 IF NOT material_change AND NOT terminal_change THEN
   RETURN NEW;
 END IF;
 IF parent_key = 'id' THEN
   parent_ids := ARRAY[COALESCE((old_doc->>'id')::integer,(new_doc->>'id')::integer)];
 ELSE
   parent_ids := ARRAY[(old_doc->>parent_key)::integer,(new_doc->>parent_key)::integer];
 END IF;
 FOR source_id IN SELECT DISTINCT x FROM unnest(parent_ids) x WHERE x IS NOT NULL ORDER BY x LOOP
   EXECUTE format('SELECT status FROM %I WHERE id=$1 FOR UPDATE',parent_table) INTO source_status USING source_id;
   IF material_change AND source_status NOT IN ('draft','pending','pending_approval','submitted','rejected','changes_requested')
      AND EXISTS (SELECT 1 FROM approval_requests WHERE record_id=source_id
        AND (doc_type=source_type OR (source_type='credit_note' AND doc_type='credit_note_cancel'))
        AND source_fingerprint IS NOT NULL AND status='approved' AND review_invalidated_at IS NULL)
   THEN
     RAISE EXCEPTION 'Material edits of an executed reviewed document require a separate correction'
       USING ERRCODE='23514';
   END IF;
   WITH invalidated AS (
     UPDATE approval_requests SET review_invalidated_at=clock_timestamp(),
       review_invalidated_reason='تغيرت حقائق المستند في قاعدة البيانات؛ يلزم تقديم مراجعة جديدة',
       status=CASE WHEN status='pending' THEN 'changes_requested' ELSE status END,
       decided_at=CASE WHEN status='pending' THEN clock_timestamp() ELSE decided_at END
     WHERE record_id=source_id
       AND (doc_type=source_type OR (source_type='credit_note' AND doc_type='credit_note_cancel'))
       AND source_fingerprint IS NOT NULL AND review_invalidated_at IS NULL
       AND status IN ('pending','approved')
     RETURNING id,current_step
   )
   INSERT INTO approval_actions(request_id,step_sequence,action,approver_name,comment)
     SELECT id,current_step,'comment','system','أبطلت كتابة جوهرية صلاحية المراجعة؛ القرار السابق محفوظ.'
     FROM invalidated;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION install_approval_source_guards_v1() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE item record; trigger_name text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('purchase_orders','purchase_order','purchase_orders','id'),
  ('purchase_order_lines','purchase_order','purchase_orders','po_id'),
  ('sales_orders','sales_order','sales_orders','id'),
  ('sales_order_lines','sales_order','sales_orders','so_id'),
  ('journal_entries','journal_entry','journal_entries','id'),
  ('journal_entry_lines','journal_entry','journal_entries','entry_id'),
  ('payment_runs','payment_run','payment_runs','id'),
  ('payment_run_lines','payment_run','payment_runs','run_id'),
  ('credit_notes','credit_note','credit_notes','id'),
  ('credit_note_lines','credit_note','credit_notes','note_id'),
  ('leave_requests','leave_request','leave_requests','id'),
  ('expense_claims','expense_claim','expense_claims','id')
 ) AS v(table_name,doc_type,parent_table,parent_key) LOOP
  trigger_name := 'approval_facts_v1_'||item.table_name;
  IF to_regclass(item.table_name) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(item.table_name) AND tgname=trigger_name
  ) THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION approval_source_write_guard_v1(%L,%L,%L)',
     trigger_name,item.table_name,item.parent_table,item.doc_type,item.parent_key);
  END IF;
 END LOOP;
END $$;
SELECT install_approval_source_guards_v1();
