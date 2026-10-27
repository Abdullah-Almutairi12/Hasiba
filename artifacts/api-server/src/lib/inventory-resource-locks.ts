import {sql} from "drizzle-orm";
import type {InventoryConnection} from "./scoped-inventory-actor";

type QuantKey={productId:number;warehouseId:number;variantId?:number|null;lotId?:number|null};
/** Existing stock-engine advisory namespace; acquire all keys before product
 * metadata locks. Deterministic numeric order also covers opposite transfers.
 * Reentrant inside the transaction; never substitutes for live authorization. */
export async function lockInventoryQuantKeys(tx:InventoryConnection,resources:QuantKey[]){
 const keys=resources.map(r=>({...r,variantId:r.variantId??0,lotId:r.lotId??0}))
  .sort((a,b)=>a.productId-b.productId||a.warehouseId-b.warehouseId||a.variantId-b.variantId||a.lotId-b.lotId);
 const held=new Set<string>();
 for(const r of keys){
  const key=`${r.productId}-${r.warehouseId}-${r.variantId}-${r.lotId}`;
  if(held.has(key))continue;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`);
  held.add(key);
 }
}
