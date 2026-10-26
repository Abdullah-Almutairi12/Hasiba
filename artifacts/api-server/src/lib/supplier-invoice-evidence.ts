import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { assertSupplierInvoice } from "./supplier-invoice-access";
import { FinancialRequestError } from "./financial-transaction";

export async function supplierInvoiceEvidence(req: Request, res: Response) {
  try {
    const { invoice, actor } = await assertSupplierInvoice(req, Number(req.params.id));
    const evidence = await db.execute(sql`SELECT id,position,description,quantity::text,
      unit_price::text AS "unitPrice",net_amount::text AS "netAmount",
      source_total::text AS "sourceTotal",unit,tax_rate::float8 AS "taxRate",po_line_id AS "poLineId",product_id AS "productId"
      FROM supplier_invoice_lines WHERE invoice_id=${invoice.id} AND company_id=${actor.companyId}
      ORDER BY position`);
    res.setHeader("Cache-Control","private, no-store");
    const receipts=await db.execute(sql`SELECT a.id,g.reference,r.id AS "receiptLineId",
      e.id AS "invoiceLineId",a.quantity::text,a.source_unit_cost::text AS "unitCost",a.reversed_at AS "reversedAt"
      FROM supplier_invoice_receipt_allocations a JOIN supplier_invoice_lines e ON e.id=a.invoice_line_id
      JOIN goods_receipt_lines r ON r.id=a.receipt_line_id JOIN goods_receipts g ON g.id=r.grn_id
      JOIN purchase_orders p ON p.id=g.po_id AND p.company_id=${actor.companyId}
      WHERE e.invoice_id=${invoice.id} AND a.company_id=${actor.companyId} ORDER BY a.id`);
    res.json({version:invoice.lineEvidenceVersion, poId:invoice.poId,lines:evidence.rows,receipts:receipts.rows,
      historicalLimit:invoice.lineEvidenceVersion==null
        ? "لا توجد بنود أصلية محفوظة لهذه الفاتورة القديمة؛ لا يعاد بناؤها من أمر الشراء." : null});
  } catch (error) {
    if(error instanceof FinancialRequestError) {res.status(error.status).json({error:error.message});return;}
    req.log.error({error},"supplier invoice evidence read failed");
    res.status(500).json({error:"تعذر قراءة بنود الفاتورة الأصلية"});
  }
}
