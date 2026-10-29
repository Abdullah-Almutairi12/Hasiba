import assert from "node:assert/strict";

/** Independent read-only SQL, not a comparison against preview-engine output. */
export async function reconcileTaxPreviewBrowser(pool:typeof import("@workspace/db").pool,companyId:number,productId:number){
  const q=async(s:string,p:unknown[]=[]) => (await pool.query(s,p)).rows;
  const invoices=await q(`SELECT id,source,reference,subtotal::text,discount::text,vat::text,total::text
    FROM customer_invoices WHERE company_id=$1 ORDER BY id`,[companyId]);
  const quants=await q("SELECT warehouse_id,quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1",[productId]);
  const layers=await q("SELECT id,remaining_qty::text,unit_cost::text FROM stock_layers WHERE product_id=$1 ORDER BY id",[productId]);
  const moves=await q(`SELECT id,kind,quantity::text,unit_cost::text,source_type,source_id,journal_entry_id
    FROM stock_moves WHERE product_id=$1 ORDER BY id`,[productId]);
  const ledger=await q(`SELECT a.system_key,coalesce(sum(l.debit-l.credit),0)::text AS balance
    FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
    WHERE e.company_id=$1 GROUP BY a.system_key ORDER BY a.system_key`,[companyId]);
  const unbalanced=await q(`SELECT e.id,sum(l.debit-l.credit)::text AS difference FROM journal_entries e
    JOIN journal_entry_lines l ON l.entry_id=e.id WHERE e.company_id=$1 GROUP BY e.id HAVING sum(l.debit-l.credit)<>0`,[companyId]);
  const receipts=await q(`SELECT operation,request_key,result->'value' AS result FROM financial_requests
    WHERE company_id=$1 ORDER BY operation,request_key`,[companyId]);
  const closed=receipts.filter(r=>r.result?.$financialRequest==="closed-without-execution:v1");
  const count=invoices.length;
  assert.equal(count,3,"Iconic POS + direct invoice + classic POS, exactly once each");
  assert.deepEqual(invoices.map(r=>Number(r.total)),[230,132.25,115]);
  assert.deepEqual(invoices.map(r=>Number(r.vat)),[30,17.25,0]);
  assert.equal(unbalanced.length,0);
  const quantity=quants.reduce((s,r)=>s+Number(r.quantity),0);
  const stockValue=quants.reduce((s,r)=>s+Number(r.quantity)*Number(r.avg_cost),0);
  const layerQty=layers.reduce((s,r)=>s+Number(r.remaining_qty),0);
  const layerValue=layers.reduce((s,r)=>s+Number(r.remaining_qty)*Number(r.unit_cost),0);
  assert.equal(quantity,18);assert.equal(layerQty,18);
  assert.equal(stockValue,900);assert.equal(layerValue,900);
  const balance=(key:string)=>Number(ledger.find(r=>r.system_key===key)?.balance??0);
  assert.equal(balance("inventory"),900);assert.equal(balance("cogs"),100);
  assert.equal(balance("sales_revenue"),-430);assert.equal(balance("vat_output"),-47.25);
  assert.equal(moves.filter(r=>r.kind==="issue").length,2);
  for(const inv of invoices){
    assert.equal(Number(inv.total),Number((Number(inv.subtotal)-Number(inv.discount)+Number(inv.vat)).toFixed(2)));
  }
  return {passed:true,companyId,productId,invoices,quants,layers,moves,ledger,unbalanced,
    receipts:receipts.map(r=>({operation:r.operation,key:r.request_key,
      documentId:r.result.order?.id??r.result.inv?.id??null,closedWithoutExecution:closed.includes(r)})),
    quantity,stockValue,layerQty,layerValue,limits:"Synthetic PostgreSQL, browser HTTP fault injection after proven commit; no provider/device/production acceptance."};
}
