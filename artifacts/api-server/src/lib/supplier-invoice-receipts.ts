import {sql} from "drizzle-orm";
import type {invoicesTable} from "@workspace/db";
import type {DbOrTx} from "./journal-posting";
import {FinancialRequestError} from "./financial-transaction";
const scale=1_000_000n;
function units(value:unknown):bigint{
  const [whole,fraction=""]=String(value).split(".");
  if(!/^\d+$/.test(whole)||!/^\d{0,6}$/.test(fraction))throw new FinancialRequestError("كمية المصدر غير صالحة للمصالحة",409);
  return BigInt(whole)*scale+BigInt(fraction.padEnd(6,"0"));
}
function decimal(value:bigint){return `${value/scale}.${String(value%scale).padStart(6,"0")}`;}

/** Call only with the invoice AND PO locked. Current invoices consume actual
 * immutable GRN evidence FIFO. Historical billed totals reserve anonymous
 * capacity; no fabricated historic invoice/receipt links are persisted. */
export async function allocateInvoiceReceipts(tx:DbOrTx,invoice:typeof invoicesTable.$inferSelect):Promise<number>{
  const lines=await tx.execute(sql`SELECT e.id,e.po_line_id,e.quantity::text
    FROM supplier_invoice_lines e JOIN purchase_order_lines l ON l.id=e.po_line_id AND l.po_id=${invoice.poId}
    WHERE e.invoice_id=${invoice.id} AND e.company_id=${invoice.companyId} AND l.product_id IS NOT NULL ORDER BY e.position`);
  for(const line of lines.rows){
    const [legacy]=(await tx.execute(sql`SELECT(l.billed_qty-coalesce((SELECT sum(a.quantity)
      FROM supplier_invoice_receipt_allocations a JOIN supplier_invoice_lines e ON e.id=a.invoice_line_id
      WHERE e.po_line_id=l.id AND e.invoice_id<>${invoice.id} AND a.company_id=${invoice.companyId} AND a.reversed_at IS NULL),0))::text AS quantity
      FROM purchase_order_lines l WHERE l.id=${line.po_line_id} AND l.po_id=${invoice.poId}`)).rows;
    let reserved=units(legacy.quantity),needed=units(line.quantity);
    const receipts=await tx.execute(sql`SELECT r.id,r.unit_cost::text,
      (r.quantity-coalesce((SELECT sum(a.quantity) FROM supplier_invoice_receipt_allocations a
        WHERE a.receipt_line_id=r.id AND a.company_id=${invoice.companyId} AND a.reversed_at IS NULL),0))::text AS available
      FROM goods_receipt_lines r JOIN goods_receipts g ON g.id=r.grn_id
      JOIN purchase_orders p ON p.id=g.po_id AND p.company_id=${invoice.companyId}
      JOIN warehouses w ON w.id=g.warehouse_id AND w.company_id=${invoice.companyId}
      WHERE r.po_line_id=${line.po_line_id} AND g.po_id=${invoice.poId}
      ORDER BY g.received_at,g.id,r.id`);
    for(const receipt of receipts.rows){
      let available=units(receipt.available);
      const skipped=reserved<available?reserved:available;reserved-=skipped;available-=skipped;
      const take=needed<available?needed:available;
      if(take>0n){
        await tx.execute(sql`INSERT INTO supplier_invoice_receipt_allocations(invoice_line_id,receipt_line_id,company_id,quantity,source_unit_cost)
          VALUES(${line.id},${receipt.id},${invoice.companyId},${decimal(take)}::numeric,${receipt.unit_cost}::numeric)`);
        needed-=take;
      }
      if(needed===0n)break;
    }
    if(needed>0n)throw new FinancialRequestError("الكمية المستلمة الإجمالية لا تقابل دليل استلام متاحًا؛ لم يختلق ربط أو أثر مالي",409);
  }
  const totals=await tx.execute(sql`SELECT round(coalesce(sum(a.quantity*a.source_unit_cost),0),2)::text AS amount
    FROM supplier_invoice_receipt_allocations a JOIN supplier_invoice_lines e ON e.id=a.invoice_line_id
    WHERE e.invoice_id=${invoice.id} AND a.company_id=${invoice.companyId} AND a.reversed_at IS NULL`);
  return Number(totals.rows[0].amount);
}
