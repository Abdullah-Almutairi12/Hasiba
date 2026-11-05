import type {Request,RequestHandler} from "express";
import {db} from "@workspace/db";
import {sql,type SQL} from "drizzle-orm";
import {inventoryActor,type InventoryActor} from "./scoped-inventory-actor";
import {inventoryReadGuard} from "../middlewares/require-role";
import {managedProfile,requireResponsibility} from "./responsibility-context";
import {teamRows} from "./team-store";
import {FinancialRequestError} from "./financial-transaction";
import {logger} from "./logger";

type Connection=Pick<typeof db,"execute">;
export const reorderReadGuard:RequestHandler=async(req,res,next)=>{
 try{
  if(req.session.userId&&await managedProfile(req.session.userId,req.session.companyId??-1)){
   await requireResponsibility("inventory.read");next();
  }else await inventoryReadGuard(req,res,next);
 }catch(e){if(e instanceof FinancialRequestError)res.status(e.status).json({error:e.message});else next(e);}
};
export function reorderScope(actor:InventoryActor,product=sql`p`,warehouse=sql`w`):SQL{
 return sql`${product}.company_id=${actor.companyId} AND ${warehouse}.company_id=${actor.companyId}
  AND EXISTS(SELECT 1 FROM branches rb WHERE rb.id=${warehouse}.branch_id AND rb.company_id=${actor.companyId} AND rb.is_active)
  ${actor.grant?sql`AND ${warehouse}.branch_id=${actor.grant.branchId}
   AND ${warehouse}.id=ANY(${sql.param(actor.grant.warehouseIds)}::integer[])`:sql``}`;
}
export async function reorderActor(req:Request,connection:Connection=db,write=false){
 const actor=await inventoryActor(connection,req,write?"inventory.reorder.manage":null);
 if(!actor.grant&&!write&&!["owner","manager","inventory","accountant","auditor","production"].includes(actor.role))
  throw new FinancialRequestError("ليس لديك إذن قراءة حالة المخزون",403);
 return actor;
}
export async function reorderReference(req:Request,connection:Connection,productId:number,warehouseId:number,write=false){
 const actor=await reorderActor(req,connection,write);
 const [row]=await teamRows<{supported:boolean}>(connection,sql`SELECT
  (p.tracking_mode='none' AND NOT p.is_variant_parent AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
   AND NOT EXISTS(SELECT 1 FROM stock_quants q WHERE q.product_id=p.id AND q.warehouse_id=w.id
     AND (q.variant_id IS NOT NULL OR q.lot_id IS NOT NULL))) AS supported
  FROM products p CROSS JOIN warehouses w WHERE p.id=${productId} AND w.id=${warehouseId} AND ${reorderScope(actor)}`);
 if(!row)throw new FinancialRequestError("الصنف أو المستودع خارج نطاق المسؤولية",403);
 if(write&&!row.supported)throw new FinancialRequestError("تنبيه المستودع متاح للأصناف العادية غير المتتبعة فقط؛ إعدادات المتتبعات محفوظة دون تغيير",409);
 return actor;
}
/** All callers, including the existing inbox, use the SAME live responsibility. */
export async function warehouseAlertScope(req:Request,alias:SQL=sql`alerts`):Promise<SQL>{
 let actor:InventoryActor|null=null;
 try{actor=await reorderActor(req);}catch{/* No inventory read: hide inventory alerts, not an existence proof. */}
 return sql`(${alias}.type<>'warehouse_low_stock' OR ${actor?sql`EXISTS(
  SELECT 1 FROM warehouse_stock_alert_cycles ac JOIN products p ON p.id=ac.product_id
  JOIN warehouses w ON w.id=ac.warehouse_id WHERE ac.alert_id=${alias}.id AND ac.company_id=${actor.companyId} AND ${reorderScope(actor)})`:sql`false`})`;
}

/**
 * Durable, transactionally-enqueued work. The queue row is the serialization
 * lock, NOT a quant lock. A stock writer may hold a quant and wait to enqueue;
 * reading committed quants without locking them prevents a reverse lock order.
 * Deleting the claimed queue row commits with the alert; a waiting enqueue then
 * inserts fresh work. Rollbacks cannot enqueue, and a crash cannot lose work.
 */
export async function evaluateWarehouseStockAlerts(limit=100){
 let processed=0;
 while(processed<limit){
  const done=await db.transaction(async tx=>{
   const [key]=await teamRows<{product_id:number;warehouse_id:number}>(tx,sql`
    SELECT * FROM warehouse_stock_alert_queue ORDER BY product_id,warehouse_id LIMIT 1 FOR UPDATE SKIP LOCKED`);
   if(!key)return false;
   const [r]=await teamRows<{id:number;company_id:number;branch_id:number;name:string;sku:string;warehouse:string;branch:string;unit:string;
    min_qty:string;quantity:string;enabled:boolean;supported:boolean}>(tx,sql`
    SELECT r.id,p.company_id,w.branch_id,p.name_ar AS name,p.sku,w.name_ar AS warehouse,b.name_ar AS branch,p.unit,
     r.min_qty::text,coalesce((SELECT sum(q.quantity) FROM stock_quants q WHERE q.product_id=p.id AND q.warehouse_id=w.id),0)::text AS quantity,
     (r.alert_enabled AND p.is_active AND b.is_active) AS enabled,
     (p.tracking_mode='none' AND NOT p.is_variant_parent AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
      AND NOT EXISTS(SELECT 1 FROM stock_quants q WHERE q.product_id=p.id AND q.warehouse_id=w.id
       AND (q.variant_id IS NOT NULL OR q.lot_id IS NOT NULL))) AS supported
    FROM reorder_rules r JOIN products p ON p.id=r.product_id JOIN warehouses w ON w.id=r.warehouse_id AND w.company_id=p.company_id
    JOIN branches b ON b.id=w.branch_id AND b.company_id=p.company_id
    WHERE r.product_id=${key.product_id} AND r.warehouse_id=${key.warehouse_id} AND r.alert_adopted_at IS NOT NULL`);
   if(r){
    const [condition]=await teamRows<{low:boolean}>(tx,sql`SELECT ${r.quantity}::numeric<=${r.min_qty}::numeric AS low`);
    const low=r.enabled&&r.supported&&condition!.low;
    const status=low?"open":!r.supported?"unsupported":!r.enabled?"disabled":"recovered";
    const [existing]=await teamRows<{id:number;alert_id:number}>(tx,sql`SELECT id,alert_id FROM warehouse_stock_alert_cycles WHERE rule_id=${r.id} AND status='open'`);
    const [clock]=await teamRows<{at:string}>(tx,sql`SELECT clock_timestamp()::text AS at`);
    const message=`${r.name} (${r.sku}) — الفرع: ${r.branch}، المستودع: ${r.warehouse}. رصيد فعلي في المستودع: ${r.quantity} ${r.unit}، حد التنبيه: ${r.min_qty}. وقت التقييم: ${clock!.at}. ${status==="recovered"?"تعافى الرصيد فوق الحد.":status==="disabled"?"عُطّل التنبيه.":status==="unsupported"?"توقف التنبيه: الصنف خارج نطاق الدعم.":"تنبيه داخلي فقط، وليس توصية شراء."}`;
    if(existing){
     await tx.execute(sql`UPDATE warehouse_stock_alert_cycles SET quantity=${r.quantity},threshold=${r.min_qty},status=${status},
      evaluated_at=clock_timestamp(),closed_at=CASE WHEN ${low} THEN NULL ELSE clock_timestamp() END WHERE id=${existing.id}`);
     await tx.execute(sql`UPDATE alerts SET title=${`${low?"مخزون منخفض":status==="recovered"?"تعافي المخزون":"تنبيه متوقف"}: ${r.name} — ${r.warehouse}`},
      message=${message} WHERE id=${existing.alert_id}`);
    }else if(low){
     const [alert]=await teamRows<{id:number}>(tx,sql`INSERT INTO alerts(type,title,message,company_id)
      VALUES('warehouse_low_stock',${`مخزون منخفض: ${r.name} — ${r.warehouse}`},${message},${r.company_id}) RETURNING id`);
     await tx.execute(sql`INSERT INTO warehouse_stock_alert_cycles(rule_id,company_id,branch_id,warehouse_id,product_id,alert_id,quantity,threshold,status)
      VALUES(${r.id},${r.company_id},${r.branch_id},${key.warehouse_id},${key.product_id},${alert!.id},${r.quantity},${r.min_qty},'open')`);
    }
   }
   await tx.execute(sql`DELETE FROM warehouse_stock_alert_queue WHERE product_id=${key.product_id} AND warehouse_id=${key.warehouse_id}`);
   return true;
  });
  if(!done)break;processed++;
 }
 return processed;
}
let started=false;
export function startWarehouseStockAlertWorker(){
 if(started||process.env.VITEST==="true")return;started=true;
 let running=false;
 const run=async()=>{if(running)return;running=true;try{await evaluateWarehouseStockAlerts();}catch(err){logger.warn({err},"warehouse stock alert evaluation failed; durable queue retained");}finally{running=false;}};
 // Reconcile explicitly adopted rules after downtime and periodically (e.g.
 // product tracking changes). Retry bootstrap failures without losing adoption.
 const reconcile=()=>db.execute(sql`INSERT INTO warehouse_stock_alert_queue(product_id,warehouse_id)
  SELECT product_id,warehouse_id FROM reorder_rules WHERE alert_adopted_at IS NOT NULL ON CONFLICT DO NOTHING`)
  .then(()=>run()).catch(err=>logger.warn({err},"warehouse stock alert reconciliation failed"));
 void reconcile();
 setInterval(()=>void reconcile(),60000).unref();
 setInterval(()=>void run(),5000).unref();
}
