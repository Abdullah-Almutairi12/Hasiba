import type { Request } from "express";
import { db, purchaseOrdersTable, warehousesTable } from "@workspace/db";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";
import { managedProfile, currentResponsibilities, selectedResponsibility, type Responsibility } from "./responsibility-context";
import { returnActor } from "./return-access";
import { supplyScope } from "./supply-chain-scope";
import { getCompanyId } from "./scoped-db";
import { lockApprovalAuthority } from "./approval-authority";
import { authorityFingerprint } from "./approval-authority";

export const procurementAction = (method: string, path: string): string | null => {
  if(method==="GET"&&path==="/invoices/draft-options")return "procurement.invoices.read";
  if(method==="POST"&&path==="/invoices/drafts")return "procurement.invoices.create";
  if(method==="PATCH"&&/^\/invoices\/\d+\/draft$/.test(path))return "procurement.invoices.edit";
  if(method==="POST"&&/^\/invoices\/\d+\/process$/.test(path))return "procurement.invoices.read";
  if (method === "POST" && path === "/invoices/match-preview") return "procurement.invoices.compare";
  if (method === "GET" && /^\/invoices(?:\/(?:stats|\d+(?:\/(?:zatca-qr|pdf|evidence))?))?$/.test(path))
    return path.endsWith("/pdf") ? "procurement.invoices.print" : "procurement.invoices.read";
  if (method === "GET" && path.startsWith("/storage/objects/invoices/")) return "procurement.invoices.read";
  // A committed receipt remains recoverable with source read authority.
  // Fresh physical receipt is checked inside the transaction, under the fence.
  if (path === "/procurement/goods-receipts" && ["GET","POST"].includes(method)) return "procurement.receipts.read";
  if (/^\/suppliers(?:\/\d+)?$/.test(path))
    return `procurement.suppliers.${method === "GET" ? "read" : method === "POST" ? "create" : method === "PATCH" ? "edit" : "unsupported"}`;
  if (/^\/exports\/suppliers\.(xlsx|pdf)$/.test(path)) return "procurement.suppliers.export";
  if (!/^\/procurement\/purchase-orders(?:\/\d+(?:\/(?:confirm|approve|cancel|close|pdf|send|outbox(?:\/\d+\/retry)?))?)?$/.test(path)) return null;
  const tail = path.split("/").at(-1)!;
  if (method === "GET") return tail === "pdf" ? "procurement.orders.print" : tail === "outbox" ? "procurement.orders.send" : "procurement.orders.read";
  return `procurement.orders.${tail === "retry" ? "send" : /^\d+$/.test(tail) ? "unsupported" : tail === "purchase-orders" ? "create" : tail}`;
};

export type ProcurementActor = { userId: number; companyId: number; grant: Responsibility | null; branches: number[] | null; action:string };
export async function procurementActor(connection: DbOrTx, userId: number, companyId: number, action: string,
  independent = false): Promise<ProcurementActor> {
  const actor = await returnActor(userId, companyId, connection);
  const profile = await managedProfile(userId, companyId, connection);
  if (profile) {
    const grants = independent ? await currentResponsibilities(userId, companyId, connection) :
      [await selectedResponsibility(userId, companyId, connection)].filter(Boolean) as Responsibility[];
    if(action==="procurement.orders.read" && grants.some(g=>g.resource==="procurement" &&
      !g.actions.includes(action)&&g.actions.includes("procurement.receipts.read"))) action="procurement.receipts.read";
    const grant = grants.find(g => g.resource === "procurement" && g.actions.includes(action) &&
      (!action.startsWith("procurement.receipts.") || g.actions.includes("procurement.receipts.read")) &&
      (!action.startsWith("procurement.orders.") || g.actions.includes("procurement.orders.read")) &&
      (!action.startsWith("procurement.invoices.") || g.actions.includes("procurement.invoices.read")) &&
      (!action.startsWith("procurement.suppliers.") || g.actions.includes("procurement.suppliers.read")));
    if (!grant) throw new FinancialRequestError("المسؤولية الحالية لا تجيز فعل الموردين أو أوامر الشراء", 403);
    return { userId, companyId, grant, branches: [grant.branchId],action };
  }
  const read = ["read", "print", "export"].includes(action.split(".").at(-1)!) || action === "procurement.invoices.compare";
  const allowed = action === "procurement.orders.approve" ? ["owner", "manager"] :
    read ? ["owner", "manager", "accountant", "inventory", "auditor"] : ["owner", "manager", "accountant", "inventory"];
  if(action.endsWith(".export")&&actor.custom&&(!actor.capabilities.includes("export")||!actor.capabilities.includes("reports")))
    throw new FinancialRequestError("منع التصدير القديم ما زال نافذًا؛ العرض ليس إذن تصدير",403);
  if(action==="procurement.suppliers.export"&&actor.branches!==null)
    throw new FinancialRequestError("دليل الموردين بلا فرع؛ التصدير القديم المقيد بالفروع غير متاح",403);
  if (!allowed.includes(actor.role) || actor.custom && !actor.capabilities.includes(read ? "view" : action.endsWith(".approve") ? "approve" : "create"))
    throw new FinancialRequestError("صلاحية الموردين أو أوامر الشراء غير متاحة", 403);
  return { userId, companyId, grant: null, branches: actor.branches,action };
}
export const receiptOnly = (actor: ProcurementActor) => !!actor.grant && !actor.grant.actions.includes("procurement.orders.read");
export function receiptOrderView(po: typeof purchaseOrdersTable.$inferSelect) {
  return {id:po.id,reference:po.reference,supplierName:po.supplierName,status:po.status,
    warehouseId:po.warehouseId,orderDate:po.orderDate,expectedDate:po.expectedDate,receiptOnly:true};
}
export async function assertReceiptDestination(actor:ProcurementActor,po:typeof purchaseOrdersTable.$inferSelect,
  warehouseId:number,connection:DbOrTx) {
  const [w]=await connection.select().from(warehousesTable).where(and(
    eq(warehousesTable.id,warehouseId),eq(warehousesTable.companyId,actor.companyId)));
  if(!w || actor.branches!==null&&!actor.branches.includes(w.branchId!) ||
    actor.grant?.warehouseIds.length&&!actor.grant.warehouseIds.includes(w.id) ||
    actor.grant&&po.warehouseId!==warehouseId)
    throw new FinancialRequestError("وجهة الاستلام غير مطابقة لأمر الشراء أو خارج نطاق المستودع",403);
}
export async function requestProcurementActor(req: Request, action: string, connection: DbOrTx = db, write = false) {
  if (write) await lockApprovalAuthority(connection);
  return procurementActor(connection, req.session.userId!, getCompanyId(req), action);
}
export function procurementOrderScope(actor: ProcurementActor): SQL {
  const g = actor.grant;
  return and(supplyScope("purchaseOrder", purchaseOrdersTable.id, actor.companyId),
    g ? sql`${purchaseOrdersTable.currencyCode}='SAR' AND ${purchaseOrdersTable.exchangeRate}=1` : sql`true`,
    actor.branches === null ? sql`true` : sql`EXISTS(SELECT 1 FROM warehouses scope_wh
      WHERE scope_wh.id=${purchaseOrdersTable.warehouseId} AND scope_wh.company_id=${actor.companyId}
      AND scope_wh.branch_id=ANY(${sql.param(actor.branches)}::integer[])
      ${g?.warehouseIds.length ? sql`AND scope_wh.id=ANY(${sql.param(g.warehouseIds)}::integer[])` : sql``})`,
    g?.amountLimit == null ? sql`true` : sql`${purchaseOrdersTable.total}<=${g.amountLimit}::numeric`)!;
}
export async function assertProcurementOrder(actor: ProcurementActor, id: number, connection: DbOrTx = db, lock = false) {
  const query = connection.select().from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.id, id), procurementOrderScope(actor)));
  const [po] = await (lock ? query.for("update") : query);
  if (!po) throw new FinancialRequestError("أمر الشراء غير متاح في النطاق الحالي", actor.grant?403:404);
  if(actor.grant&&["confirm","approve","cancel","close"].some(a=>actor.action===`procurement.orders.${a}`)){
    const related=await connection.execute(sql`SELECT linked_company_id FROM suppliers WHERE id=${po.supplierId} AND company_id=${actor.companyId}`);
    if(po.requisitionId||po.rfqId||po.agreementId||related.rows[0]?.linked_company_id)
      throw new FinancialRequestError("تنفيذ أمر مرتبط بدورة احتياج أو عقد أو شركة مقابلة خارج حدود هذه المنحة",403);
  }
  return po;
}
export async function assertProcurementValue(actor: ProcurementActor, warehouseId: number | null, amount: string, connection: DbOrTx) {
  if (actor.branches !== null) {
    const [w] = warehouseId == null ? [] : await connection.select().from(warehousesTable).where(and(
      eq(warehousesTable.id, warehouseId), eq(warehousesTable.companyId, actor.companyId)));
    if (!w || !actor.branches.includes(w.branchId!) || actor.grant?.warehouseIds.length && !actor.grant.warehouseIds.includes(w.id))
      throw new FinancialRequestError("مستودع أمر الشراء خارج نطاق المسؤولية؛ لا يمكن إسناد مستند بلا فرع", 403);
  }
  if (actor.grant?.amountLimit != null) {
    const result = await connection.execute(sql`SELECT ${amount}::numeric <= ${actor.grant.amountLimit}::numeric AS allowed`);
    if (!result.rows[0]?.allowed) throw new FinancialRequestError("أمر الشراء يتجاوز الحد المالي الحالي", 403);
  }
}
export async function procurementAudit(connection: DbOrTx, actor: ProcurementActor, action: string, source: unknown) {
  await connection.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
    SELECT id,name,${actor.companyId},${action},'procurement',
    ${JSON.stringify({ source, grant: actor.grant, branches: actor.branches })} FROM users WHERE id=${actor.userId}`);
}

/** Review selection belongs to the reviewer, never the submitting/executing employee. */
export async function procurementReviewAuthority(connection: DbOrTx, companyId: number, userId: number,
  orderId: number, action = "procurement.orders.approve"): Promise<string | null> {
  try {
    const profile=await managedProfile(userId,companyId,connection);
    const actor=await procurementActor(connection,userId,companyId,action,true);
    const grants=profile ? (await currentResponsibilities(userId,companyId,connection))
      .filter(g=>g.resource==="procurement"&&g.actions.includes(action)&&g.actions.includes("procurement.orders.read")) : [null];
    for(const grant of grants){
      try {
        const scoped={...actor,grant,branches:grant?[grant.branchId]:actor.branches};
        const po=await assertProcurementOrder(scoped,orderId,connection);
        if(action.endsWith(".approve")&&po.createdBy===userId)return null;
        return authorityFingerprint({userId,companyId,profile,grant,branches:scoped.branches});
      } catch(e){if(!(e instanceof FinancialRequestError))throw e;}
    }
    return null;
  }catch(e){if(e instanceof FinancialRequestError)return null;throw e;}
}
