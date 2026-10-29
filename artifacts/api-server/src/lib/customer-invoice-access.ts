import type { Request } from "express";
import { db, customerInvoicesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FinancialRequestError } from "./financial-transaction";
import { managedProfile, selectedResponsibility, type Responsibility } from "./responsibility-context";
import { getCompanyId } from "./scoped-db";

export function customerInvoiceAction(method:string,path:string,download:unknown) {
  if(method!=="GET"||!/^\/sales\/invoices(?:\/\d+(?:\/(?:pdf|history))?)?$/.test(path))return null;
  return path.endsWith("/pdf")?(download==="1"?"sales.invoices.export":"sales.invoices.print"):"sales.read";
}
/** Existing accounts keep their established legacy access until an explicitly
 * previewed conversion. No grant, membership or entitlement is backfilled. */
export async function customerInvoiceGrant(req:Request, action="sales.read") {
  const companyId=getCompanyId(req),userId=req.session.userId!;
  if(!await managedProfile(userId,companyId))return null;
  const grant=await selectedResponsibility(userId,companyId);
  if(grant?.resource!=="sales"||!grant.actions.includes("sales.read")||!grant.actions.includes(action))
    throw new FinancialRequestError("صلاحية عرض الفواتير لا تمنح الطباعة أو تصدير PDF؛ تحقق من المسؤولية الحالية",403);
  return grant;
}
export function customerInvoiceScope(grant:Responsibility,companyId:number) {
  // Same evidenced legacy POS source as the accepted invoice-list fix.
  const branch=sql`coalesce(${customerInvoicesTable.branchId},(
    SELECT b.id FROM sales_orders so
    JOIN pos_orders o ON so.notes='POS '||o.order_number AND o.company_id=so.company_id
    JOIN pos_sessions s ON s.id=o.session_id
    JOIN branches b ON b.id=s.branch_id AND b.company_id=so.company_id
    WHERE so.id=${customerInvoicesTable.soId} AND so.company_id=${companyId} AND so.source='pos'))`;
  return sql`${customerInvoicesTable.companyId}=${companyId} AND ${branch}=${grant.branchId}
    ${grant.warehouseIds.length ? sql`AND EXISTS(SELECT 1 FROM sales_orders so WHERE
      so.id=${customerInvoicesTable.soId} AND so.company_id=${companyId}
      AND so.warehouse_id=ANY(${sql.param(grant.warehouseIds)}::integer[]))` : sql``}
    ${grant.amountLimit===null ? sql`` : sql`AND ${customerInvoicesTable.currencyCode}='SAR'
      AND abs(${customerInvoicesTable.total}::numeric)<=${grant.amountLimit}::numeric`}`;
}
export async function assertCustomerInvoice(req:Request,id:number,action="sales.read") {
  const grant=await customerInvoiceGrant(req,action);
  if(!grant)return;
  const rows=await db.execute(sql`SELECT id FROM customer_invoices
    WHERE id=${id} AND ${customerInvoiceScope(grant,getCompanyId(req))}`);
  if(!rows.rows.length)throw new FinancialRequestError("الفاتورة خارج نطاق المسؤولية أو حدها",404);
}
