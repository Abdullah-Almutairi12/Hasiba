import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { type InventoryConnection } from "./scoped-inventory-actor";
import { teamRows } from "./team-store";
import { FinancialRequestError } from "./financial-transaction";

export type CountPoint={fingerprint:string;quantity:string;generation:string;observedAt:string};
const fail=(message:string,status=409):never=>{throw new FinancialRequestError(message,status);};

/** Same advisory key/order as ALL native stock-engine sales/receipts/issues/transfers.
 * No warehouse-wide freeze. Locks last only for the short checkpoint/save/close tx.
 */
export async function countPoint(tx:InventoryConnection,companyId:number,warehouseId:number,productId:number):Promise<CountPoint> {
  const [p]=await teamRows<{tracking:string;variant:boolean}>(tx,sql`
    SELECT tracking_mode AS tracking,is_variant_parent AS variant FROM products
    WHERE id=${productId} AND company_id=${companyId}`);
  if(!p)fail("الصنف خارج المنشأة",404);
  if(p.tracking!=="none"||p.variant)fail("الجرد المتحرك هنا للأصناف العادية فقط؛ المتتبعات والمتغيرات خارج هذه الشريحة",400);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${productId}-${warehouseId}-0-0`},0))`);
  const quants=await teamRows<{id:number;version:string;quantity:string;cost:string}>(tx,sql`
    SELECT id,xmin::text AS version,quantity::text,avg_cost::text AS cost FROM stock_quants
    WHERE warehouse_id=${warehouseId} AND product_id=${productId}
    AND variant_id IS NULL AND lot_id IS NULL ORDER BY id FOR UPDATE`);
  const [complex]=await teamRows(tx,sql`SELECT 1 FROM stock_quants WHERE warehouse_id=${warehouseId}
    AND product_id=${productId} AND (variant_id IS NOT NULL OR lot_id IS NOT NULL) LIMIT 1`);
  if(complex)fail("الصنف له أرصدة متتبعة؛ يلزم مسار الجرد المتخصص",400);
  const [balance]=await teamRows<{quantity:string}>(tx,sql`SELECT COALESCE(SUM(quantity),0)::text AS quantity
    FROM stock_quants WHERE warehouse_id=${warehouseId} AND product_id=${productId}`);
  const [fence]=await teamRows<{generation:string}>(tx,sql`SELECT generation::text FROM stocktake_product_fences
    WHERE warehouse_id=${warehouseId} AND product_id=${productId}`);
  const generation=fence?.generation??"0";
  // xmin detects a committed move-and-reverse (ABA), not merely quantity equality.
  // The checkpoint expires in 15 minutes; it is not a long-term xmin archive.
  return {quantity:balance.quantity,generation,fingerprint:createHash("sha256")
    .update(JSON.stringify({quants,generation})).digest("hex"),observedAt:new Date().toISOString()};
}

export async function preparePoint(tx:InventoryConnection,takeId:number,lineId:number,userId:number,point:CountPoint) {
  const id=randomUUID(),expiresAt=new Date(Date.now()+15*60_000).toISOString();
  await tx.execute(sql`INSERT INTO stocktake_checkpoints(id,take_id,line_id,user_id,facts,expires_at)
    VALUES(${id}::uuid,${takeId},${lineId},${userId},${JSON.stringify(point)}::jsonb,${expiresAt}::timestamptz)`);
  return {checkpointId:id,expectedQty:Number(point.quantity),expiresAt};
}
export async function verifyPoint(tx:InventoryConnection,takeId:number,lineId:number,userId:number,id:string|undefined,current:CountPoint) {
  if(!id)fail("ابدأ عد الصنف أولًا للحصول على نقطة عد موثقة؛ الأعداد القديمة تحتاج إعادة عد",428);
  const [saved]=await teamRows<{facts:CountPoint;valid:boolean}>(tx,sql`SELECT facts,expires_at>clock_timestamp() AS valid
    FROM stocktake_checkpoints WHERE id=${id}::uuid AND take_id=${takeId} AND line_id=${lineId} AND user_id=${userId}`);
  if(!saved?.valid)fail("انتهت نقطة العد أو لا تخص هذا المستخدم والسطر؛ ابدأ العد مجددًا");
  if(saved.facts.fingerprint!==current.fingerprint)fail("تحرك الصنف أثناء العد أو أُقفل جرد آخر؛ ابدأ نقطة عد جديدة وأعد العد الفعلي");
  return saved.facts;
}
export async function advanceCountGeneration(tx:InventoryConnection,warehouseId:number,productId:number) {
  await tx.execute(sql`INSERT INTO stocktake_product_fences(warehouse_id,product_id,generation)
    VALUES(${warehouseId},${productId},1) ON CONFLICT(warehouse_id,product_id)
    DO UPDATE SET generation=stocktake_product_fences.generation+1`);
}
