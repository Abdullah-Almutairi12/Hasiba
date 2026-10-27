import {sql} from "drizzle-orm";
import {teamRows} from "./team-store";
import {lockInventoryQuantKeys} from "./inventory-resource-locks";
import type {DbOrTx} from "./journal-posting";

/** Freeze the candidate key set before metadata writes or recursive FEFO moves.
 * Arrivals committed later are considered by the next request, never acquired
 * out of order halfway through a multi-lot operation. No new costing allocator. */
export async function lockLotMovementKeys(tx:Pick<DbOrTx,"execute">,productId:number,from:number|null,to:number|null,
 lotId?:number|null,candidates?:number[]){
 const ids=candidates??(lotId?[lotId]:(await teamRows<{id:number}>(tx,sql`
  SELECT DISTINCT lot_id AS id FROM stock_quants
  WHERE product_id=${productId} AND warehouse_id=${from} AND lot_id IS NOT NULL AND quantity>0 ORDER BY lot_id`)).map(l=>l.id));
 await lockInventoryQuantKeys(tx,[...new Set([from,to].filter((w):w is number=>w!==null))]
  .flatMap(warehouseId=>ids.map(lotId=>({productId,warehouseId,lotId}))));
 return ids;
}
