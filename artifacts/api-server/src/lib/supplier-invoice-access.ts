import type { Request } from "express";
import { db, invoicesTable, purchaseOrdersTable } from "@workspace/db";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { requestProcurementActor, procurementActor, type ProcurementActor } from "./procurement-authority";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";
import { returnActor } from "./return-access";
import { getCompanyId } from "./scoped-db";
import { currentResponsibilities, managedProfile } from "./responsibility-context";
import { authorityFingerprint } from "./approval-authority";

/** Existing financial records do not acquire a fictitious branch. A legacy
 * unlinked invoice has company scope only; a branch grant cannot see it. */
export function supplierInvoiceScope(actor: ProcurementActor): SQL {
  return and(
    eq(invoicesTable.companyId, actor.companyId),
    actor.branches === null ? sql`true` : sql`(
      (${invoicesTable.lifecycleVersion}=1 AND ${invoicesTable.poId} IS NULL
       AND ${invoicesTable.branchId}=ANY(${sql.param(actor.branches)}::integer[])
       ${actor.grant?.warehouseIds.length ? sql`AND false` : sql``})
      OR EXISTS (
      SELECT 1 FROM purchase_orders p JOIN warehouses w ON w.id=p.warehouse_id
      WHERE p.id=${invoicesTable.poId} AND p.company_id=${actor.companyId}
        AND w.company_id=${actor.companyId}
        AND w.branch_id=ANY(${sql.param(actor.branches)}::integer[])
        ${actor.grant?.warehouseIds.length ? sql`AND w.id=ANY(${sql.param(actor.grant.warehouseIds)}::integer[])` : sql``}
        AND p.currency_code='SAR' AND p.exchange_rate=1))`,
    actor.grant?.amountLimit == null ? sql`true` :
      sql`abs(${invoicesTable.amount})<=${actor.grant.amountLimit}::numeric`,
  )!;
}

export async function supplierInvoiceActor(req: Request, action = "read", connection: DbOrTx = db) {
  const actor = await requestProcurementActor(req, `procurement.invoices.${action}`, connection);
  if (!actor.grant) {
    // Match the existing invoiceReadGuard exactly for unmanaged accounts;
    // a new quantities-only responsibility still cannot use this legacy path.
    const legacy = await returnActor(actor.userId, actor.companyId, connection);
    const read=["read","compare","print","export"].includes(action);
    if (!(read?["owner","manager","accountant","inventory","auditor"]:["owner","manager","accountant"]).includes(legacy.role)) {
      throw new FinancialRequestError("صلاحية قراءة فواتير الموردين غير متاحة", 403);
    }
  }
  return actor;
}

export async function assertSupplierInvoice(req: Request, id: number, action = "read", connection: DbOrTx = db) {
  const actor = await supplierInvoiceActor(req, action, connection);
  const [invoice] = await connection.select().from(invoicesTable).where(and(
    eq(invoicesTable.id, id), supplierInvoiceScope(actor)));
  if (!invoice) throw new FinancialRequestError("الفاتورة غير متاحة في النطاق الحالي", 404);
  return { actor, invoice };
}

export async function invoiceAttachmentAccess(req: Request, url: string) {
  const actor = await supplierInvoiceActor(req);
  const [row] = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
    eq(invoicesTable.fileUrl, url), supplierInvoiceScope(actor))).limit(1);
  if (!row) throw new FinancialRequestError("المرفق غير متاح في النطاق الحالي", 404);
}

export async function invoiceMatchingOrder(req: Request, id: number, action = "compare", connection: DbOrTx = db) {
  const actor = await supplierInvoiceActor(req, action, connection);
  const rows = await connection.select().from(purchaseOrdersTable).where(and(
    eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.companyId, getCompanyId(req)),
    actor.branches === null ? sql`true` : sql`EXISTS(
      SELECT 1 FROM warehouses w WHERE w.id=${purchaseOrdersTable.warehouseId}
        AND w.company_id=${actor.companyId} AND w.branch_id=ANY(${sql.param(actor.branches)}::integer[])
        ${actor.grant?.warehouseIds.length ? sql`AND w.id=ANY(${sql.param(actor.grant.warehouseIds)}::integer[])` : sql``})`,
    actor.grant ? sql`${purchaseOrdersTable.currencyCode}='SAR' AND ${purchaseOrdersTable.exchangeRate}=1` : sql`true`,
    // Mutations are capped against their server-computed invoice amount.
    // Internal validation of a larger PO is not permission to disclose its value.
    actor.grant?.amountLimit == null || !["read","compare","print","export"].includes(action)
      ? sql`true` : sql`${purchaseOrdersTable.total}<=${actor.grant.amountLimit}::numeric`,
  ));
  if (!rows[0]) throw new FinancialRequestError("مصدر المطابقة غير متاح في نطاق المسؤولية", 404);
  return { actor, order: rows[0] };
}

export async function invoiceDecisionAuthority(connection:DbOrTx,companyId:number,userId:number,id:number,action="approve",
  viewScope?:{branchId:number|null;amount?:number|string}):Promise<string|null>{
  try {
    const profile=await managedProfile(userId,companyId,connection);
    const nativeAction=`procurement.invoices.${action}`;
    const actor=await procurementActor(connection,userId,companyId,nativeAction,true);
    const grants=profile?(await currentResponsibilities(userId,companyId,connection))
      .filter(g=>g.resource==="procurement"&&g.actions.includes(nativeAction)&&g.actions.includes("procurement.invoices.read")):[null];
    if(!profile && !(action==="read"?["owner","manager","accountant","inventory","auditor"]:["owner","manager","accountant"])
      .includes((await returnActor(userId,companyId,connection)).role)) return null;
    for(const grant of grants) {
      if(grant&&viewScope&&(grant.branchId!==viewScope.branchId ||
        grant.amountLimit!=null&&viewScope.amount!=null&&Math.abs(Number(viewScope.amount))>Number(grant.amountLimit)))continue;
      const scoped={...actor,grant,branches:grant?[grant.branchId]:actor.branches};
      const rows=await connection.select({id:invoicesTable.id}).from(invoicesTable).where(and(eq(invoicesTable.id,id),supplierInvoiceScope(scoped)));
      if(rows.length) return authorityFingerprint({userId,companyId,profile,grant,branches:scoped.branches});
    }
    return null;
  } catch(error) {if(error instanceof FinancialRequestError)return null;throw error;}
}
