import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { invoiceMatchingOrder } from "./supplier-invoice-access";
import { FinancialRequestError } from "./financial-transaction";

export const invoiceMatchInput = z.object({
  poId: z.number().int().positive(),
  items: z.array(z.object({
    poLineId: z.number().int().positive(),
    quantity: z.number().finite().positive().max(1e9),
    unitPrice: z.number().finite().min(0).max(1e9),
    unit: z.string().trim().min(1).max(60).optional(),
  }).strict()).min(1).max(500),
}).strict();

/** Advisory, read-only comparison. Does not approve, reserve quantities, or
 * replace the existing locked matching checks in /invoices/from-scan. */
export async function supplierInvoiceMatchPreview(req: Request, res: Response) {
  try {
    const body = invoiceMatchInput.parse(req.body);
    const { actor, order } = await invoiceMatchingOrder(req, body.poId);
    const tolerance = Number(process.env.PO_INVOICE_PRICE_TOLERANCE_PCT ?? "5");
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) {
      throw new FinancialRequestError("إعداد سياسة تفاوت السعر غير صالح؛ يلزم مراجعته", 503);
    }
    // Decimal multiplication/comparison stays in PostgreSQL numeric, not JS
    // floating arithmetic. Repeated PO-line entries are aggregated FIRST.
    const result = await db.execute(sql`
      WITH requested AS (
        SELECT "poLineId" AS id,sum(quantity) AS quantity,sum(quantity*"unitPrice") AS amount,
          array_agg(DISTINCT unit) FILTER(WHERE unit IS NOT NULL) AS units,
          min("unitPrice") AS min_price,max("unitPrice") AS max_price
        FROM jsonb_to_recordset(${JSON.stringify(body.items)}::jsonb)
          AS x("poLineId" integer,quantity numeric,"unitPrice" numeric,unit text)
        GROUP BY "poLineId"
      )
      SELECT r.id,l.description,coalesce(to_jsonb(l)->>'unit',p.unit,'piece') AS unit,
        l.quantity::text AS ordered,l.received_qty::text AS received,l.billed_qty::text AS billed,
        l.unit_price::text AS "orderUnitPrice",r.quantity::text AS current,
        r.amount::text AS "currentAmount",
        greatest(r.quantity-(l.received_qty-l.billed_qty),0)::text AS excess,
        r.quantity>(l.received_qty-l.billed_qty) AS "quantityMismatch",
        l.unit_price>0 AND (
          abs(r.min_price-l.unit_price)*100>l.unit_price*${tolerance}::numeric OR
          abs(r.max_price-l.unit_price)*100>l.unit_price*${tolerance}::numeric) AS "priceMismatch",
        coalesce(EXISTS(SELECT 1 FROM unnest(r.units) u
          WHERE u<>coalesce(to_jsonb(l)->>'unit',p.unit,'piece')),false) AS "unitMismatch"
      FROM requested r
      LEFT JOIN purchase_order_lines l ON l.id=r.id AND l.po_id=${order.id}
      LEFT JOIN products p ON p.id=l.product_id AND p.company_id=${actor.companyId}
      ORDER BY r.id`);
    if (result.rows.some(row => row.ordered == null)) {
      throw new FinancialRequestError("بند المطابقة غير موجود في أمر الشراء المصرح به", 400);
    }
    const totals = await db.execute(sql`SELECT sum(quantity*"unitPrice")::text AS subtotal
      FROM jsonb_to_recordset(${JSON.stringify(body.items)}::jsonb)
        AS x(quantity numeric,"unitPrice" numeric)`);
    if (actor.grant?.amountLimit != null) {
      const check = await db.execute(sql`SELECT ${totals.rows[0].subtotal}::numeric<=${actor.grant.amountLimit}::numeric AS allowed`);
      if (!check.rows[0]?.allowed) throw new FinancialRequestError("مبلغ المعاينة يتجاوز حد المسؤولية", 403);
    }
    const lines = result.rows.map(row => ({
      ...row,
      messages: [
        ...(row.quantityMismatch ? [`كمية الفاتورة تتجاوز الكمية المستلمة المسجلة غير المفوترة بمقدار ${row.excess} ${row.unit}`] : []),
        ...(row.priceMismatch ? [`سعر الفاتورة يختلف عن أمر الشراء بأكثر من التفاوت المهيأ (${tolerance}%)`] : []),
        ...(row.unitMismatch ? ["وحدة البند مختلفة؛ يلزم التحقق من التحويل المعتمد، ولا يجري تحويل تلقائي في هذه المعاينة"] : []),
      ],
    }));
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      advisoryOnly: true, source: { id: order.id, reference: order.reference,
        canOpenOrder: actor.grant == null || actor.grant.actions.includes("procurement.orders.read") },
      currency: order.currencyCode, currentSubtotal: totals.rows[0].subtotal, lines,
      requiresReview: lines.some(l => l.messages.length > 0),
      policy: { priceTolerancePct: tolerance, quantityTolerance: 0 },
      explanation: "هذه مقارنة وليست اعتمادًا أو حجزًا للكميات. قد يوجد توريد لاحق أو استلام لم يسجل؛ راجع المستندات قبل التصحيح. التنفيذ يعيد التحقق تحت الأقفال.",
      evidenceLimit: "المفوتر سابقًا هو رصيد بنود أمر الشراء المسجل حاليًا؛ لا تعيد المعاينة بناء بنود فواتير تاريخية غير محفوظة أو تحويلات وحدات غير موثقة.",
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "بيانات معاينة المطابقة غير صالحة" });
    if (err instanceof FinancialRequestError) return res.status(err.status).json({ error: err.message });
    req.log.error({ err }, "supplier invoice matching preview failed");
    return res.status(500).json({ error: "تعذرت معاينة المطابقة" });
  }
}
