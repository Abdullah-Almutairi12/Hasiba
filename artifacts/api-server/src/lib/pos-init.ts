import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Boot-time initialization of the POS subsystem.
 *
 * Adds a database-level integrity guard on pos_order_payments so that
 * the sum of payment amounts for any pos_orders row must equal that
 * order's total. The trigger is INITIALLY DEFERRED so a single
 * transaction can insert the order header first and then its payments
 * — the check fires only at COMMIT, after every payment row is in.
 *
 * This prevents application bugs (or future routes) from persisting an
 * unbalanced split-bill order even if the route-level Zod check were
 * skipped or bypassed. The accounting books would otherwise drift.
 *
 * Idempotent — safe to run on every boot.
 */
export async function initPos(): Promise<void> {
  await pool
    .query(
      `
    CREATE OR REPLACE FUNCTION pos_payments_match_order_total()
    RETURNS trigger AS $$
    DECLARE
      v_order_id integer;
      v_order_total numeric(18, 2);
      v_paid_total  numeric(18, 2);
    BEGIN
      v_order_id := COALESCE(NEW.order_id, OLD.order_id);

      SELECT total INTO v_order_total
        FROM pos_orders WHERE id = v_order_id;

      -- Order may have been cascaded-deleted in the same tx; nothing to check.
      IF v_order_total IS NULL THEN
        RETURN NULL;
      END IF;

      SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
        FROM pos_order_payments WHERE order_id = v_order_id;

      -- Both columns are numeric(10,2); exact equality is the right check.
      IF v_paid_total <> v_order_total THEN
        RAISE EXCEPTION
          'مجموع دفعات الطلب % (%) لا يساوي إجمالي الفاتورة (%)',
          v_order_id, v_paid_total, v_order_total
        USING ERRCODE = 'check_violation';
      END IF;

      RETURN NULL;
    END $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS pos_payments_balance_check ON pos_order_payments;
    CREATE CONSTRAINT TRIGGER pos_payments_balance_check
      AFTER INSERT OR UPDATE OR DELETE ON pos_order_payments
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      EXECUTE FUNCTION pos_payments_match_order_total();
  `,
    )
    .catch((e) =>
      logger.warn({ err: e }, "POS payments-balance trigger skipped"),
    );

  // Also guard the orders side: if anyone updates pos_orders.total after
  // payments are recorded, the sum must still match. This is a separate
  // CONSTRAINT TRIGGER so it can be deferred in the same way.
  await pool
    .query(
      `
    CREATE OR REPLACE FUNCTION pos_order_total_matches_payments()
    RETURNS trigger AS $$
    DECLARE
      v_paid_total numeric(18, 2);
      v_payment_count integer;
    BEGIN
      SELECT COALESCE(SUM(amount), 0), COUNT(*)
        INTO v_paid_total, v_payment_count
        FROM pos_order_payments WHERE order_id = NEW.id;

      -- Zero-total orders (e.g. fully comped) need no payments.
      -- Any positive-total order must have at least one payment recorded
      -- by COMMIT time; this closes the previous bypass where a header
      -- could persist with no payments and skip the payments trigger.
      IF NEW.total = 0 AND v_payment_count = 0 THEN
        RETURN NULL;
      END IF;

      IF v_payment_count = 0 THEN
        RAISE EXCEPTION
          'الطلب % بإجمالي % لا يحتوي أي دفعات',
          NEW.id, NEW.total
        USING ERRCODE = 'check_violation';
      END IF;

      IF v_paid_total <> NEW.total THEN
        RAISE EXCEPTION
          'إجمالي الطلب % (%) لا يساوي مجموع الدفعات (%)',
          NEW.id, NEW.total, v_paid_total
        USING ERRCODE = 'check_violation';
      END IF;

      RETURN NULL;
    END $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS pos_order_total_balance_check ON pos_orders;
    CREATE CONSTRAINT TRIGGER pos_order_total_balance_check
      AFTER INSERT OR UPDATE OF total ON pos_orders
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      EXECUTE FUNCTION pos_order_total_matches_payments();
  `,
    )
    .catch((e) =>
      logger.warn({ err: e }, "POS orders-balance trigger skipped"),
    );

  logger.info("POS subsystem initialized");
}
