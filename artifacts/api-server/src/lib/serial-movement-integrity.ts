import {sql} from "drizzle-orm";
import type {InventoryConnection} from "./scoped-inventory-actor";
import {teamRows} from "./team-store";
import {FinancialRequestError} from "./financial-transaction";

/** Product-wide, before quant/product locks: protects absent serials too.
 * No new uniqueness rule: the existing identity remains (product, number). */
export async function lockSerialMovements(tx:InventoryConnection,productId:number){
 await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`serial-stock:${productId}`},0))`);
}
const inconsistent=()=>new FinancialRequestError("حالة الرقم التسلسلي لا تطابق سجل حركاته أو رصيد المستودع؛ يلزم فحص مدقق دون إصلاح تلقائي",409);
export async function checkSerialMovement(tx:InventoryConnection,input:{
 productId:number;serialId:number;kind:string;fromWarehouseId?:number|null;toWarehouseId?:number|null;receivingTransferId?:number;
}){
 const [s]=await teamRows<{state:string;warehouse:number|null}>(tx,sql`
  SELECT state,current_warehouse_id AS warehouse FROM stock_serials
  WHERE id=${input.serialId} AND product_id=${input.productId} FOR UPDATE`);
 if(!s)throw inconsistent();
 const moves=await teamRows<{id:number;product:number;kind:string;state:string;quantity:string;from:number|null;to:number|null}>(tx,sql`
  SELECT id,product_id AS product,kind,state,quantity::text,from_warehouse_id AS "from",to_warehouse_id AS "to"
  FROM stock_moves WHERE serial_id=${input.serialId}
  AND state IN('done','in_transit') ORDER BY id`);
 const locations=new Map<number,number>();let transit=0;
 for(const m of moves){
  if(m.product!==input.productId||Number(m.quantity)!==1)throw inconsistent();
  if(m.from!==null)locations.set(m.from,(locations.get(m.from)??0)-1);
  if(m.state==="done"&&m.to!==null)locations.set(m.to,(locations.get(m.to)??0)+1);
  if(m.state==="in_transit")transit++;
 }
 const positive=[...locations].filter(([,q])=>q!==0);
 const inStock=s.state==="in_stock"&&s.warehouse!==null&&transit===0&&positive.length===1&&positive[0][0]===s.warehouse&&positive[0][1]===1;
 const inTransit=s.state==="in_transit"&&s.warehouse===null&&transit===1&&positive.length===0;
 if(input.receivingTransferId!==undefined){
  if(!inTransit||!moves.some(m=>m.id===input.receivingTransferId&&m.state==="in_transit"&&m.to===input.toWarehouseId))throw inconsistent();
 }else if(input.kind==="receipt"){
  // A metadata-only identity is not stock. Never receive an old issued or
  // ambiguous identity as a new purchase; returns are a separate workflow.
  if(moves.length||s.warehouse!==null||s.state!=="in_stock")throw new FinancialRequestError("الرقم التسلسلي موجود أو سبق تحريكه؛ لا يجوز استلام القطعة مرة أخرى",409);
 }else if(!inStock||s.warehouse!==input.fromWarehouseId){
  throw new FinancialRequestError("القطعة ليست متاحة في مستودع المصدر أو سبق صرفها أو ما زالت بالطريق",409);
 }
 // Cross-check all physical serials against the native aggregate, not an
 // invented per-serial quant. Old incompatible metadata stays blocked.
 for(const warehouse of new Set([input.fromWarehouseId,input.toWarehouseId].filter((w):w is number=>w!=null))){
  const [r]=await teamRows<{quantity:string;serials:string}>(tx,sql`
   SELECT (SELECT coalesce(sum(quantity),0)::text FROM stock_quants WHERE product_id=${input.productId}
    AND warehouse_id=${warehouse} AND variant_id IS NULL AND lot_id IS NULL) AS quantity,
    (SELECT count(*)::text FROM stock_serials WHERE product_id=${input.productId}
     AND current_warehouse_id=${warehouse} AND state='in_stock') AS serials`);
  if(Number(r.quantity)!==Number(r.serials))throw inconsistent();
  const [layers]=await teamRows<{valid:boolean}>(tx,sql`SELECT
   p.costing_method<>'fifo' OR (SELECT coalesce(sum(remaining_qty),0) FROM stock_layers
    WHERE product_id=p.id AND warehouse_id=${warehouse} AND variant_id IS NULL AND lot_id IS NULL)
    =${r.quantity}::numeric AS valid FROM products p WHERE p.id=${input.productId}`);
  if(!layers?.valid)throw inconsistent();
 }
}
