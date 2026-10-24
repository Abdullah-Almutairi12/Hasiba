import { managedProfile, selectedResponsibility } from "./responsibility-context";
import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FinancialRequestError } from "./financial-transaction";

export const returnTemplates: Record<string, string[]> = {
  cashier: ["view", "request", "payout", "close", "sell"],
  branch_manager: ["view", "request", "approve", "payout", "close", "difference", "reports", "export", "sell", "expense", "seller_edit", "commission_approve"],
  branch_accountant: ["view", "payout", "external", "close", "reports", "export", "expense", "commission_approve", "commission_paid"],
  finance_manager: ["view", "request", "approve", "payout", "external", "close", "difference", "reports", "export", "expense", "seller_edit", "commission_approve", "commission_paid"],
  auditor: ["view", "reports", "export"],
};
export const returnCapabilities = [...new Set([...Object.values(returnTemplates).flat(), "receive", "responsibility", "hr_view", "hr_write"])];
export async function returnActor(userId: number, companyId: number, connection?: Pick<typeof db, "execute">) {
  const text = `
    SELECT uc.role, u.branch_id, a.capabilities, a.branches
    FROM user_companies uc JOIN users u ON u.id=uc.user_id
    JOIN companies c ON c.id=uc.company_id
    LEFT JOIN return_access a ON a.company_id=uc.company_id AND a.user_id=uc.user_id
    WHERE uc.user_id=$1 AND uc.company_id=$2 AND u.is_active AND c.is_active`;
  const { rows } = connection ? await connection.execute(sql`SELECT uc.role,u.branch_id,a.capabilities,a.branches
    FROM user_companies uc JOIN users u ON u.id=uc.user_id JOIN companies c ON c.id=uc.company_id
    LEFT JOIN return_access a ON a.company_id=uc.company_id AND a.user_id=uc.user_id
    WHERE uc.user_id=${userId} AND uc.company_id=${companyId} AND u.is_active AND c.is_active FOR SHARE OF uc,u,c`)
    : await pool.query(text, [userId, companyId]);
  const row = rows[0];
  if (!row) throw new FinancialRequestError("ليس لديك وصول إلى الشركة", 403);
  if (await managedProfile(userId, companyId, connection)) {
    const grant = await selectedResponsibility(userId, companyId, connection);
    return {
      userId, companyId, role: "scoped", custom: true,
      capabilities: grant?.resource === "pos" ? [
        ...(grant.actions.includes("pos.read") ? ["view"] : []),
        ...(grant.actions.includes("pos.sell") ? ["sell"] : []),
        ...Object.entries({
          "pos.return.request": "request", "pos.return.payout": "payout",
          "pos.return.approve": "approve", "pos.return.receive": "receive",
          "pos.return.external": "external", "pos.shift.close": "close",
          "pos.shift.difference": "difference",
          "pos.shift.responsibility": "responsibility",
        }).filter(([action]) => grant.actions.includes(action)).map(([, capability]) => capability),
      ] : [],
      branches: grant ? [grant.branchId] : [],
    };
  }
  const template = ({ owner: "branch_manager", manager: "branch_manager", accountant: "branch_accountant", cashier: "cashier", sales: "cashier", auditor: "auditor" } as Record<string, string>)[String(row.role)];
  return {
    userId, companyId, role: String(row.role),
    custom: row.capabilities != null,
    capabilities: row.role === "owner" ? [...returnCapabilities, "configure"] : (row.capabilities ?? returnTemplates[template] ?? []) as string[],
    branches: row.role === "owner" ? null : (row.branches ?? (row.branch_id ? [row.branch_id] : row.role === "cashier" ? [] : null)) as number[] | null,
  };
}
export async function returnAuthorize(userId: number, companyId: number, capability: string, branchId?: number, connection?: Pick<typeof db, "execute">) {
  const actor = await returnActor(userId, companyId, connection);
  if (!actor.capabilities.includes(capability)) throw new FinancialRequestError("ليست لديك صلاحية هذا الإجراء", 403);
  if (branchId != null) {
    const owned = connection ? await connection.execute(sql`SELECT id FROM branches WHERE id=${branchId} AND company_id=${companyId}`)
      : await pool.query("SELECT id FROM branches WHERE id=$1 AND company_id=$2", [branchId, companyId]);
    if (!owned.rows.length) throw new FinancialRequestError("الفرع غير متاح", 404);
    if (actor.branches && !actor.branches.includes(branchId)) throw new FinancialRequestError("الفرع غير مسموح", 403);
  }
  return actor;
}
export async function returnInvoiceBranch(companyId: number, invoiceId: number) {
  const result = await pool.query(`SELECT s.branch_id FROM customer_invoices i
    JOIN sales_orders so ON so.id=i.so_id AND so.company_id=i.company_id AND so.source='pos'
    JOIN pos_orders o ON so.notes='POS '||o.order_number AND o.company_id=i.company_id
    JOIN pos_sessions s ON s.id=o.session_id
    WHERE i.id=$1 AND i.company_id=$2`, [invoiceId, companyId]);
  return result.rows[0]?.branch_id as number | undefined;
}
export const returnRequestGuard: RequestHandler = async (req, res, next) => {
  try {
    const companyId = req.session.companyId!;
    const invoiceId = Number(req.body.invoiceId);
    const branchId = Number.isSafeInteger(invoiceId) && invoiceId > 0 ? await returnInvoiceBranch(companyId, invoiceId) : undefined;
    const actor = await returnActor(req.session.userId!, companyId);
    if (branchId != null) {
      await returnAuthorize(actor.userId, companyId, "request", branchId);
      if (!actor.capabilities.includes("approve") && req.body.operationalReturn !== true) {
        throw new FinancialRequestError("يلزم استخدام طلب المرتجع الموثق وموافقته", 400);
      }
    }
    else if (!["owner", "manager", "sales"].includes(actor.role)) throw new FinancialRequestError("هذه الرحلة تتطلب فاتورة نقطة بيع متاحة", 403);
    req.session.role = actor.role as NonNullable<typeof req.session.role>;
    next();
  } catch (error) {
    res.status(error instanceof FinancialRequestError ? error.status : 500).json({
      error: error instanceof FinancialRequestError ? error.message : "تعذر التحقق من مسار المرتجع",
      diagnosticRef: String(req.id),
    });
  }
};
export async function returnPolicy(companyId: number, branchId: number) {
  const { rows } = await pool.query(`SELECT * FROM return_policies WHERE company_id=$1
    AND branch_id IN (0,$2) ORDER BY branch_id DESC LIMIT 1`, [companyId, branchId]);
  return rows[0] ?? { approval_above: null, allow_resale: true };
}
// Stable persisted facts only; statuses/timestamps are deliberately excluded.
export async function returnFingerprint(tx: Pick<typeof db, "execute">, noteId: number) {
  const result = await tx.execute(sql`SELECT jsonb_build_object(
    'invoice',n.invoice_id,'customer',n.customer_id,'restock',n.restock,
    'warehouse',n.warehouse_id,'currency',n.currency_code,'total',n.total,
    'date',n.note_date,'reason',n.reason,
    'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM credit_note_lines l WHERE l.note_id=n.id),
    'disposition',c.disposition,'settlement',c.settlement_method,'proof',c.proof_ref
  ) AS facts FROM credit_notes n LEFT JOIN return_controls c ON c.note_id=n.id WHERE n.id=${noteId}`);
  return createHash("sha256").update(JSON.stringify(result.rows[0]?.facts)).digest("hex");
}
export async function assertReturnSnapshot(tx: Pick<typeof db, "execute">, noteId: number) {
  const result = await tx.execute(sql`SELECT fingerprint FROM return_controls WHERE note_id=${noteId}`);
  if (result.rows.length && result.rows[0].fingerprint !== await returnFingerprint(tx, noteId)) {
    throw new FinancialRequestError("تغيرت بيانات المرتجع بعد تقديمه؛ يلزم طلب واعتماد جديد", 409);
  }
}
export async function authorizeReturnApproval(req: Request, noteId: number) {
  const result = await pool.query("SELECT branch_id FROM return_controls WHERE note_id=$1 AND company_id=$2", [noteId, req.session.companyId!]);
  if (!result.rowCount) throw new FinancialRequestError("المرتجع غير متاح", 404);
  return returnAuthorize(req.session.userId!, req.session.companyId!, "approve", result.rows[0].branch_id);
}
