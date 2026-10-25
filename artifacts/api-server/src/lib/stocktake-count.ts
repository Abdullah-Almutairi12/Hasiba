import type { Request } from "express";
import { sql } from "drizzle-orm";
import { FinancialRequestError } from "./financial-transaction";
import { inventoryActor, type InventoryActor, type InventoryConnection } from "./scoped-inventory-actor";
import { teamRows } from "./team-store";

export async function stocktakeReadAuthority(connection:InventoryConnection,req:Request,id:number) {
  const actor=await inventoryActor(connection,req,null);
  const [take]=await teamRows<{id:number;warehouseId:number;branchId:number}>(connection,sql`
    SELECT t.id,w.id AS "warehouseId",w.branch_id AS "branchId" FROM stock_takes t
    JOIN warehouses w ON w.id=t.warehouse_id AND w.company_id=${actor.companyId}
    JOIN branches b ON b.id=w.branch_id AND b.company_id=w.company_id AND b.is_active
    WHERE t.id=${id}`);
  if(!take)throw new FinancialRequestError("الجرد غير موجود",404);
  if(actor.grant&&(actor.grant.branchId!==take.branchId||!actor.grant.warehouseIds.includes(take.warehouseId))) {
    throw new FinancialRequestError("الجرد خارج المستودع المسموح",403);
  }
  return {actor,take};
}

/** All count writers lock the same parent row that /complete updates. */
export async function lockStocktakeForCount(connection:InventoryConnection,req:Request,id:number,closedStatus=409) {
  const actor=await inventoryActor(connection,req,"inventory.stocktake.count");
  const [take]=await teamRows<{id:number;status:string;warehouseId:number;branchId:number;reference:string}>(connection,sql`
    SELECT t.id,t.status,t.warehouse_id AS "warehouseId",w.branch_id AS "branchId",t.reference
    FROM stock_takes t JOIN warehouses w ON w.id=t.warehouse_id AND w.company_id=${actor.companyId}
    JOIN branches b ON b.id=w.branch_id AND b.company_id=w.company_id AND b.is_active
    WHERE t.id=${id} FOR UPDATE OF t FOR SHARE OF w,b`);
  if(!take)throw new FinancialRequestError("الجرد غير موجود",404);
  if(actor.grant&&(actor.grant.branchId!==take.branchId||!actor.grant.warehouseIds.includes(take.warehouseId))) {
    throw new FinancialRequestError("الجرد خارج المستودع المسموح",403);
  }
  if(take.status!=="in_progress")throw new FinancialRequestError("لا يمكن تعديل جرد مغلق",closedStatus);
  return {actor,take};
}

export async function auditCountObservation(connection:InventoryConnection,actor:InventoryActor,takeId:number,lineId:number,
  previous:string|null,counted:string,mode:"set"|"scan") {
  await connection.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
    VALUES(${actor.userId},${actor.name},${actor.companyId},'inventory.stocktake.counted','stock_take',
      jsonb_build_object('takeId',${takeId}::integer,'lineId',${lineId}::integer,'mode',${mode}::text,
        'previousCountedQty',${previous}::numeric,'countedQty',${counted}::numeric,
        'responsibility',${JSON.stringify(actor.grant)}::jsonb,'membershipRole',${actor.role}::text,
        'financialEffect',false,'independentApproval',false)::text)`);
}
