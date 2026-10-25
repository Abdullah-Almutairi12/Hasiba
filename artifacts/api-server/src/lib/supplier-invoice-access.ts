import type { Request } from "express";
import { db, invoicesTable, purchaseOrdersTable } from "@workspace/db";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { requestProcurementActor, type ProcurementActor } from "./procurement-authority";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";
import { returnActor } from "./return-access";
import { getCompanyId } from "./scoped-db";

/** Existing financial records do not acquire a fictitious branch. A legacy
 * unlinked invoice has company scope only; a branch grant cannot see it. */
export function supplierInvoiceScope(actor: ProcurementActor): SQL {
  return and(
    eq(invoicesTable.companyId, actor.companyId),
    actor.branches === null ? sql`true` : sql`EXISTS (
      SELECT 1 FROM purchase_orders p JOIN warehouses w ON w.id=p.warehouse_id
      WHERE p.id=${invoicesTable.poId} AND p.company_id=${actor.companyId}
        AND w.company_id=${actor.companyId}
        AND w.branch_id=ANY(${sql.param(actor.branches)}::integer[])
        ${actor.grant?.warehouseIds.length ? sql`AND w.id=ANY(${sql.param(actor.grant.warehouseIds)}::integer[])` : sql``}
        AND p.currency_code='SAR' AND p.exchange_rate=1)`,
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
    if (!["owner", "manager", "accountant", "inventory", "auditor"].includes(legacy.role) ||
      !["read", "compare", "print", "export"].includes(action)) {
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
    actor.grant?.amountLimit == null ? sql`true` : sql`${purchaseOrdersTable.total}<=${actor.grant.amountLimit}::numeric`,
  ));
  if (!rows[0]) throw new FinancialRequestError("مصدر المطابقة غير متاح في نطاق المسؤولية", 404);
  return { actor, order: rows[0] };
}
