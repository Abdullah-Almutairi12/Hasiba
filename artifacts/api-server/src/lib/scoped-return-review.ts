import { createHash } from "node:crypto";
import type { DbOrTx } from "./journal-posting";
import { sql } from "drizzle-orm";
import { currentResponsibilities, managedProfile, responsibilityContext } from "./responsibility-context";
import { financialPolicy } from "./financial-policy";
import { FinancialRequestError } from "./financial-transaction";

type Connection = DbOrTx;

/**
 * Source-bound candidates, never a union of grants. Decisions use the selected
 * grant; delayed execution can compare the saved fingerprint against current
 * candidates for that SAME reviewer (not the receiver's request context).
 */
export async function scopedReturnGrants(tx: Connection, userId: number, companyId: number, noteId: number,
  action = "pos.read", delayed = false) {
  const profile = await managedProfile(userId, companyId, tx);
  if (!profile) return null;
  const { rows } = await tx.execute(sql`SELECT c.branch_id,n.total,n.warehouse_id,so.warehouse_id AS source_warehouse
    FROM credit_notes n JOIN return_controls c ON c.note_id=n.id AND c.company_id=n.company_id
    JOIN customer_invoices i ON i.id=n.invoice_id AND i.company_id=n.company_id
    JOIN sales_orders so ON so.id=i.so_id AND so.company_id=i.company_id AND so.source='pos'
    JOIN pos_orders o ON so.notes='POS '||o.order_number AND o.company_id=n.company_id
    JOIN pos_sessions s ON s.id=o.session_id AND s.branch_id=c.branch_id
    JOIN branches b ON b.id=s.branch_id AND b.company_id=n.company_id
    WHERE n.id=${noteId} AND n.company_id=${companyId}`);
  const source = rows[0];
  if (!source) return [];
  const returnPolicy = await tx.execute(sql`SELECT * FROM return_policies
    WHERE company_id=${companyId} AND branch_id IN (0,${Number(source.branch_id)})
    ORDER BY branch_id DESC LIMIT 1`);
  const context = responsibilityContext.getStore();
  const spendsAmount = action === "pos.return.approve" || action === "pos.return.direct";
  const policy = spendsAmount ? await financialPolicy(companyId, "scoped", "sales.credit_note_amount", tx) : null;
  const candidates = (await currentResponsibilities(userId, companyId, tx)).filter(g =>
    g.resource === "pos" && g.actions.includes(action) && g.branchId === Number(source.branch_id) &&
    g.warehouseIds.includes(Number(source.source_warehouse)) &&
    (source.warehouse_id == null || g.warehouseIds.includes(Number(source.warehouse_id))) &&
    (delayed || (context?.userId === userId && context.companyId === companyId ? context.grantId === g.id : action === "pos.read")));
  const result = [];
  for (const grant of candidates) {
    if (spendsAmount) {
      const { rows: limits } = await tx.execute(sql`SELECT
        (${String(source.total)}::numeric > coalesce(${grant.amountLimit}::numeric,0)) OR
        (${policy?.max == null ? false : sql`${String(source.total)}::numeric > ${String(policy.max)}::numeric`}) AS exceeds`);
      if (policy?.blocked || limits[0]?.exceeds) continue;
    }
    const fingerprint = createHash("sha256").update(JSON.stringify({
      version: 1, userId, companyId, noteId, source, grant, profile, policy, returnPolicy: returnPolicy.rows[0] ?? null,
    })).digest("hex");
    result.push({ grant, fingerprint });
  }
  return result;
}

export async function assertScopedReturnReview(tx: Connection, userId: number, companyId: number, noteId: number) {
  const grants = await scopedReturnGrants(tx, userId, companyId, noteId, "pos.return.approve");
  if (grants && !grants.length) throw new FinancialRequestError("اعتماد المرتجع خارج المستودع أو المبلغ أو المسؤولية الحالية", 403);
  return grants;
}
