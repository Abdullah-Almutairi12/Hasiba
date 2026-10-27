import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { inventoryReadGuard } from "../middlewares/require-role";
import { FinancialRequestError } from "./financial-transaction";
import { getCompanyId } from "./scoped-db";
import { managedProfile, requireResponsibility, responsibilityContext, type Responsibility } from "./responsibility-context";
import { teamRows } from "./team-store";
import { inventoryActor } from "./scoped-inventory-actor";
import { lockInventoryQuantKeys } from "./inventory-resource-locks";
import {lockSerialMovements} from "./serial-movement-integrity";

type Connection = Pick<typeof db, "execute">;
type Transfer = { id:number; state:string; destinationId:number; branchId:number; quantity:string; value:string; variantId:number|null; productId:number;lotId:number|null;serialId:number|null };
type Authority = { userId:number; companyId:number; name:string; role:string; grant:Responsibility|null; transfer:Transfer };
const denied = () => new FinancialRequestError("التحويل خارج مستودعات الوجهة المسموح بها أو الأهلية الحالية",403);

/** A committed replay needs current read access, not a renewed execution grant. */
export async function inventoryTransferReadGuard(req:Request,res:Response,next:NextFunction) {
  try {
    if (await managedProfile(req.session.userId!,getCompanyId(req))) {
      const grant=await requireResponsibility("inventory.read");
      if(grant.resource!=="inventory") throw denied();
      next();
    } else await inventoryReadGuard(req,res,next);
  } catch(error) {
    if(error instanceof FinancialRequestError) { res.status(error.status).json({error:error.message});return; }
    next(error);
  }
}

/** Fresh writes call this after the shared authority fence, before any stock locks. */
export async function transferAuthority(connection:Connection,req:Request,id:number,execute=false,completed=false):Promise<Authority> {
  const actor=await inventoryActor(connection,req,execute?"inventory.transfer.receive":null);
  const {companyId,grant}=actor;
  const [transfer]=await teamRows<Transfer>(connection,sql`
    SELECT m.id,m.state,m.to_warehouse_id AS "destinationId",t.branch_id AS "branchId",m.quantity::text,
      (m.quantity*m.unit_cost)::text AS value,m.variant_id AS "variantId",m.product_id AS "productId",m.lot_id AS "lotId",m.serial_id AS "serialId"
    FROM stock_moves m
    JOIN warehouses f ON f.id=m.from_warehouse_id AND f.company_id=${companyId}
    JOIN warehouses t ON t.id=m.to_warehouse_id AND t.company_id=f.company_id
    JOIN branches b ON b.id=t.branch_id AND b.company_id=t.company_id AND b.is_active
    JOIN products p ON p.id=m.product_id AND p.company_id=t.company_id
    WHERE m.id=${id} AND m.kind='transfer'
    ${execute?sql`FOR UPDATE OF m FOR SHARE OF f,t,b`:sql``}`);
  if(!transfer || grant && (transfer.branchId!==grant.branchId || !grant.warehouseIds.includes(transfer.destinationId))) throw denied();
  if(execute && transfer.state!==(completed?"done":"in_transit")) throw new FinancialRequestError("التحويل ليس بانتظار الاستلام؛ راجع نتيجته ولا تنشئ استلامًا ثانيًا",grant?409:400);
  if(execute&&grant?.amountLimit!=null){
    const [limit]=await teamRows<{over:boolean}>(connection,sql`SELECT ${transfer.value}::numeric>${grant.amountLimit}::numeric AS over`);
    if(limit!.over)throw new FinancialRequestError("قيمة التحويل المحسوبة من الخادم تتجاوز حد الاستلام",403);
  }
  if(execute&&transfer.serialId!==null){
   await lockSerialMovements(connection,transfer.productId);
   await lockInventoryQuantKeys(connection,[{productId:transfer.productId,warehouseId:transfer.destinationId}]);
   const [valid]=await teamRows(connection,sql`SELECT p.id FROM products p JOIN stock_serials s ON s.product_id=p.id
    WHERE p.id=${transfer.productId} AND p.company_id=${companyId} AND p.is_active AND p.tracking_mode='serial'
    AND s.id=${transfer.serialId} AND NOT p.is_variant_parent
    AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
    FOR NO KEY UPDATE OF p`);
   if(!valid)throw denied();
  }
   if(execute&&grant&&transfer.lotId!==null){
     await lockInventoryQuantKeys(connection,[{productId:transfer.productId,warehouseId:transfer.destinationId,lotId:transfer.lotId}]);
     const [usable]=await teamRows(connection,sql`SELECT p.id FROM products p JOIN stock_lots l ON l.product_id=p.id
      WHERE p.id=${transfer.productId} AND p.company_id=${companyId} AND p.is_active AND p.tracking_mode='lot'
       AND NOT p.is_variant_parent AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
       AND l.id=${transfer.lotId} AND ${transfer.variantId}::integer IS NULL
       FOR NO KEY UPDATE OF p FOR SHARE OF l`);
     if(!usable)throw denied();
   }
   if(execute&&grant&&transfer.variantId!==null){
    await lockInventoryQuantKeys(connection,[{productId:transfer.productId,warehouseId:transfer.destinationId,
      variantId:transfer.variantId,lotId:transfer.lotId}]);
    const [usable]=await teamRows(connection,sql`SELECT v.id FROM product_variants v JOIN stock_moves m
      ON m.variant_id=v.id AND m.product_id=v.product_id JOIN products p ON p.id=v.product_id
      WHERE m.id=${id} AND p.company_id=${companyId} AND p.is_active AND p.tracking_mode='none' AND v.is_active
       FOR NO KEY UPDATE OF p FOR SHARE OF v`);
    if(!usable)throw denied();
  }
  return {...actor,transfer};
}

export function transferReceiptReference(req:Request,authority:Authority):string|null {
  if(authority.grant && !req.get("Idempotency-Key")) throw new FinancialRequestError("يلزم معرف ثابت لطلب الاستلام وإعادة نتيجته بأمان",400);
  const body=req.body??{};
  if(authority.grant && (typeof body!=="object" || Array.isArray(body) || Object.keys(body).some(k=>k!=="receiptReference"))) {
    throw new FinancialRequestError("الاستلام يخص كامل التحويل الأصلي؛ لا ترسل كمية أو تكلفة أو وجهة بديلة",400);
  }
  const ref=typeof body.receiptReference==="string"?body.receiptReference.trim():null;
  if(authority.grant && (!ref || ref.length<3 || ref.length>200)) throw new FinancialRequestError("أدخل مرجع إثبات الاستلام الكامل (3–200 حرف)",400);
  return ref?.slice(0,200)??null;
}

/** A scoped FEFO dispatch is one intent, even when the native engine emits
 * several lot rows. Lock the entire group before any quant/product metadata;
 * receiving any anchor receives all slices atomically, under a gross cap. */
export async function transferReceiptGroup(connection:Connection,req:Request,id:number){
 const initial=await transferAuthority(connection,req,id);
 if(!initial.grant||initial.transfer.lotId===null)return [id];
 const group=await teamRows<{id:number;value:string;destinationId:number;lotId:number;productId:number}>(connection,sql`
  SELECT m.id,(m.quantity*m.unit_cost)::text AS value,m.to_warehouse_id AS "destinationId",
   m.lot_id AS "lotId",m.product_id AS "productId"
  FROM stock_moves m JOIN stock_moves anchor ON anchor.id=${id}
  WHERE m.product_id=anchor.product_id AND m.from_warehouse_id=anchor.from_warehouse_id
   AND m.to_warehouse_id=anchor.to_warehouse_id AND m.kind='transfer' AND m.lot_id IS NOT NULL
   AND m.variant_id IS NULL AND (m.id=anchor.id OR anchor.source_ref LIKE 'SCOPED-%' AND m.source_ref=anchor.source_ref)
  ORDER BY m.id FOR UPDATE OF m`);
 if(!group.length)throw denied();
 if(initial.grant.amountLimit!==null){
  const [over]=await teamRows<{over:boolean}>(connection,sql`SELECT sum(quantity*unit_cost)>${initial.grant.amountLimit}::numeric AS over
   FROM stock_moves WHERE id=ANY(${sql.param(group.map(m=>m.id))}::integer[])`);
  if(over?.over)throw new FinancialRequestError("القيمة الإجمالية لجميع دفعات التحويل تتجاوز حد الاستلام",403);
 }
 await lockInventoryQuantKeys(connection,group.map(m=>({productId:m.productId,warehouseId:m.destinationId,lotId:m.lotId})));
 return group.map(m=>m.id);
}

export async function auditTransferReceipt(connection:Connection,authority:Authority,receiptReference:string|null) {
  await connection.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
    VALUES(${authority.userId},${authority.name},${authority.companyId},'inventory.transfer.received','stock_move',
      jsonb_build_object('moveId',${authority.transfer.id}::integer,'warehouseId',${authority.transfer.destinationId}::integer,
        'branchId',${authority.transfer.branchId}::integer,'quantity',${authority.transfer.quantity}::numeric,
         'lotId',${authority.transfer.lotId}::integer,
         'expiredAtReceipt',coalesce((SELECT expiry_date<${new Date().toISOString().slice(0,10)}::date FROM stock_lots WHERE id=${authority.transfer.lotId}),false),
         'receiptReference',${receiptReference}::text,'responsibility',${JSON.stringify(authority.grant)}::jsonb,
        'membershipRole',${authority.role}::text,'independentApproval',false)::text)`);
}

/** Explicit destination-scoped projection. Costs and unrelated source stock never leave the server. */
export async function scopedIncomingTransfers() {
  const grant=await requireResponsibility("inventory.read");
  const context=responsibilityContext.getStore()!;
  if(grant.resource!=="inventory") throw denied();
  const transfers=await teamRows(db,sql`
    SELECT m.id,m.source_ref AS reference,m.quantity::text,m.state,m.created_at AS "createdAt",
      coalesce(p.name_ar,p.name) AS "productName",coalesce(f.name_ar,f.name) AS "sourceWarehouse",
       coalesce(t.name_ar,t.name) AS "destinationWarehouse",m.variant_id AS "variantId",v.sku AS "variantSku",p.unit,
       m.serial_id AS "serialId",s.serial_number AS "serialNumber",
       m.lot_id AS "lotId",l.lot_number AS "lotNumber",l.expiry_date::text AS "expiryDate",
       coalesce(l.expiry_date<${new Date().toISOString().slice(0,10)}::date,false) AS expired
       ,CASE WHEN m.lot_id IS NOT NULL AND m.source_ref LIKE 'SCOPED-%' THEN count(*) OVER lot_group ELSE 1 END::integer AS "groupCount"
       ,CASE WHEN m.lot_id IS NOT NULL AND m.source_ref LIKE 'SCOPED-%' THEN sum(m.quantity) OVER lot_group ELSE m.quantity END::text AS "groupQuantity"
    FROM stock_moves m JOIN warehouses f ON f.id=m.from_warehouse_id AND f.company_id=${context.companyId}
    JOIN warehouses t ON t.id=m.to_warehouse_id AND t.company_id=f.company_id
    JOIN products p ON p.id=m.product_id AND p.company_id=t.company_id
    LEFT JOIN product_variants v ON v.id=m.variant_id AND v.product_id=p.id
     LEFT JOIN stock_lots l ON l.id=m.lot_id AND l.product_id=p.id
     LEFT JOIN stock_serials s ON s.id=m.serial_id AND s.product_id=p.id
    WHERE m.kind='transfer' AND m.state IN ('in_transit','done')
      AND t.branch_id=${grant.branchId} AND t.id=ANY(${sql.param(grant.warehouseIds)}::integer[])
     WINDOW lot_group AS(PARTITION BY m.source_ref,m.product_id,m.from_warehouse_id,m.to_warehouse_id)
     ORDER BY (m.state='in_transit') DESC,m.id ASC LIMIT 100`);
  return {canReceive:grant.actions.includes("inventory.transfer.receive"),transfers};
}
