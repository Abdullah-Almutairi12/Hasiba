import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { FinancialRequestError } from "./financial-transaction";
import { managedProfile, requireResponsibility } from "./responsibility-context";

type Connection = Pick<typeof db, "execute">;
export async function scopedPosOrderVisible(tx: Connection, userId: number, companyId: number, orderId: number) {
  if (!await managedProfile(userId, companyId, tx)) return;
  const grant=await requireResponsibility("pos.read",tx);
  const {rows}=await tx.execute(sql`SELECT so.warehouse_id,s.branch_id FROM pos_orders o
    JOIN pos_sessions s ON s.id=o.session_id JOIN branches b ON b.id=s.branch_id AND b.company_id=o.company_id
    JOIN sales_orders so ON so.company_id=o.company_id AND so.source='pos' AND so.notes='POS '||o.order_number
    WHERE o.id=${orderId} AND o.company_id=${companyId}`);
  if(!rows[0] || Number(rows[0].branch_id)!==grant.branchId || !grant.warehouseIds.includes(Number(rows[0].warehouse_id))) {
    throw new FinancialRequestError("طلب البيع خارج الفرع أو المستودعات المحددة",403);
  }
}
/** Runs inside the financial transaction, after its shared authority fence. */
export async function scopedReturnSource(tx: Connection, userId: number, companyId: number, invoiceId: number,
  warehouseId?: number | null, receive = false) {
  if (!await managedProfile(userId, companyId, tx)) return null;
  const grant = await requireResponsibility("pos.return.request", tx);
  const { rows } = await tx.execute(sql`SELECT so.warehouse_id,s.branch_id
    FROM customer_invoices i JOIN sales_orders so ON so.id=i.so_id AND so.company_id=i.company_id AND so.source='pos'
    JOIN pos_orders o ON so.notes='POS '||o.order_number AND o.company_id=i.company_id
    JOIN pos_sessions s ON s.id=o.session_id JOIN branches b ON b.id=s.branch_id AND b.company_id=i.company_id
    WHERE i.id=${invoiceId} AND i.company_id=${companyId}`);
  const source = rows[0];
  if (!source || Number(source.branch_id) !== grant.branchId || !grant.warehouseIds.includes(Number(source.warehouse_id))) {
    throw new FinancialRequestError("مصدر المرتجع خارج الفرع أو المستودع المحدد", 403);
  }
  if (warehouseId != null && !grant.warehouseIds.includes(warehouseId)) {
    throw new FinancialRequestError("مستودع استلام المرتجع خارج المسؤولية", 403);
  }
  if (receive) {
    await requireResponsibility("pos.return.receive", tx);
    if (warehouseId == null) throw new FinancialRequestError("حدد مستودع الاستلام صراحةً؛ لا يستخدم مستودع افتراضي ضمني", 400);
  }
  return grant;
}

export async function scopedDirectReturn(tx: Connection, userId: number, companyId: number, branchId: number, total: string, noteId: number) {
  if (!await managedProfile(userId, companyId, tx)) return false;
  const grant = await requireResponsibility("pos.return.request", tx);
  if (!grant.actions.includes("pos.return.direct")) return false;
  // Any active company matrix retains priority. Do not bypass it using a direct grant.
  const { rows } = await tx.execute(sql`SELECT
    EXISTS(SELECT 1 FROM approval_rules WHERE (company_id=${companyId} OR company_id IS NULL) AND doc_type='credit_note' AND is_active) AS matrix,
    coalesce(${total}::numeric >= (SELECT approval_above FROM return_policies WHERE company_id=${companyId} AND branch_id IN (0,${branchId})
      ORDER BY branch_id DESC LIMIT 1),false) AS needs_approval,
    (${total}::numeric > ${grant.amountLimit}::numeric) AS exceeds`);
  const policy = rows[0];
  if (policy.matrix || policy.exceeds || policy.needs_approval) return false;
  await tx.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
    SELECT u.id,u.name,${companyId},'pos.return.direct.used','credit_note',
      jsonb_build_object('noteId',${noteId}::integer,'amount',${total}::numeric,'branchId',${branchId}::integer,
        'responsibility',to_jsonb(g),'profileRevision',a.revision,'deniedActions',a.denied_actions,
        'policy',(SELECT to_jsonb(p) FROM return_policies p WHERE p.company_id=${companyId}
          AND p.branch_id IN (0,${branchId}) ORDER BY p.branch_id DESC LIMIT 1))::text
    FROM users u JOIN employee_access a ON a.user_id=u.id AND a.company_id=${companyId}
    JOIN responsibility_grants g ON g.employee_id=a.employee_id AND g.company_id=a.company_id AND g.id=${grant.id}
    WHERE u.id=${userId}`);
  return true;
}

export async function scopedPayoutSource(tx: Connection, userId: number, companyId: number, noteId: number, amount?: number, external = false) {
  if (!await managedProfile(userId, companyId, tx)) return;
  const grant = await requireResponsibility(external ? "pos.return.external" : "pos.return.payout", tx);
  const { rows } = await tx.execute(sql`SELECT so.warehouse_id FROM credit_notes n
    JOIN customer_invoices i ON i.id=n.invoice_id AND i.company_id=n.company_id
    JOIN sales_orders so ON so.id=i.so_id AND so.company_id=i.company_id
    WHERE n.id=${noteId} AND n.company_id=${companyId}`);
  if (!rows[0] || !grant.warehouseIds.includes(Number(rows[0].warehouse_id))) {
    throw new FinancialRequestError("مصدر الاسترداد خارج مستودعات المسؤولية", 403);
  }
  if (amount != null && grant.amountLimit != null) {
    const result = await tx.execute(sql`SELECT ${String(amount)}::numeric > ${grant.amountLimit}::numeric AS exceeds`);
    if (result.rows[0]?.exceeds) throw new FinancialRequestError("الاسترداد يتجاوز الحد المالي للمسؤولية", 403);
  }
}
