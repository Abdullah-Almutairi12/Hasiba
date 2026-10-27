import {sql} from "drizzle-orm";
import type {DbOrTx} from "./journal-posting";
import {teamRows} from "./team-store";
import {previewFifoLayers} from "./stock-engine";
import {FinancialRequestError} from "./financial-transaction";

/** Caller requesting locks has already locked the parent and ALL counted
 * quant keys in product order. GET previews never acquire write locks. */
export async function stocktakeValuation(tx:DbOrTx,id:number,companyId:number,warehouseId:number,lock=false){
 const lines=await teamRows<{id:number;productId:number;count:string;revision:number;checkpoint:unknown;
  delta:string;method:string;carrying:string;quantity:string;unitCost:string}>(tx,sql`
  SELECT l.id,l.product_id AS "productId",l.counted_qty::text AS count,l.count_revision AS revision,
   l.count_checkpoint AS checkpoint,(l.counted_qty-(l.count_checkpoint->>'quantity')::numeric)::text AS delta,
   p.costing_method AS method,coalesce(q.avg_cost,p.cost_price)::text AS "unitCost",
   coalesce(q.quantity,0)::text AS quantity,coalesce(q.avg_cost,p.cost_price)::text AS carrying
  FROM stock_take_lines l JOIN products p ON p.id=l.product_id AND p.company_id=${companyId}
  LEFT JOIN stock_quants q ON q.product_id=l.product_id AND q.warehouse_id=${warehouseId}
   AND q.variant_id IS NULL AND q.lot_id IS NULL
  WHERE l.stock_take_id=${id} AND l.counted_qty IS NOT NULL ORDER BY l.product_id,l.id
  ${lock?sql`FOR NO KEY UPDATE OF p`:sql``}`);
 const facts=[];
 for(const l of lines){
  let cost=Number(l.unitCost),fifo:Awaited<ReturnType<typeof previewFifoLayers>>|null=null;
  if(l.method==="fifo"){
   fifo=await previewFifoLayers(tx,l.productId,warehouseId,Math.abs(Number(l.delta)),null,companyId,null,lock);
   const [check]=await teamRows<{valid:boolean}>(tx,sql`SELECT
    abs(${fifo.quantity}::numeric-${l.quantity}::numeric)<=0.00000001 AND
    abs(${fifo.value}::numeric-${l.quantity}::numeric*${l.carrying}::numeric)<=0.00000001 AS valid`);
   if(!check.valid||Number(l.delta)<0&&Number(fifo.covered)+0.00000001<Math.abs(Number(l.delta)))
    throw new FinancialRequestError("طبقات FIFO لا تطابق الرصيد وقيمته؛ يلزم مسار مصالحة موثق دون إعادة تقييم التاريخ",409);
   if(Number(l.delta)<0)cost=Number(fifo.unitCost);
  }
  const [value]=await teamRows<{amount:string}>(tx,sql`SELECT (abs(${l.delta}::numeric)*${cost}::numeric)::text AS amount`);
  facts.push({...l,unitCost:cost,amount:value.amount,fifo});
 }
 const [total]=await teamRows<{amount:string}>(tx,sql`SELECT (${facts.length?
  sql.join(facts.map(f=>sql`${f.amount}::numeric`),sql` + `):sql`0`})::text AS amount`);
 return {lines:facts,amount:total.amount};
}
