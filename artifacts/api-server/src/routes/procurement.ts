import { Router } from "express";
import { z, ZodError } from "zod";
import {
  db,
  suppliersTable,
  invoicesTable,
  productsTable,
  warehousesTable,
  purchaseRequisitionsTable,
  purchaseRequisitionLinesTable,
  rfqsTable,
  rfqSuppliersTable,
  rfqQuoteLinesTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  goodsReceiptsTable,
  goodsReceiptLinesTable,
  paymentRunsTable,
  paymentRunLinesTable,
  blanketAgreementsTable,
  blanketAgreementItemsTable,
} from "@workspace/db";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import {
  procurementGuard,
  financeGuard,
  adminGuard,
  supplierReadGuard,
} from "../middlewares/require-role";
import { recordAudit } from "../lib/audit";
import { postJournalEntry } from "../lib/journal-posting";
import { recordStockMove, getDefaultWarehouseId, getOrCreateLot } from "../lib/stock-engine";
import {
  submitForApproval,
  registerOnReject,
  registerOnApprove,
  triggerEvent,
  requireFinancialLimit,
} from "../lib/workflow-engine";
import { logger } from "../lib/logger";
import { sendMessage } from "../lib/integrations/messaging";
import { sendMail, isMailerConfigured } from "../lib/mailer";
import { buildPurchaseOrderPdf, getCompanyInfo } from "../lib/pdf/purchase-order";

const router = Router();

/**
 * Module hook: notify the supplier (WhatsApp first, falling back to
 * SMS via the configured provider) that a purchase order has been
 * confirmed. Fire-and-forget so the calling transaction is never
 * blocked. No-ops gracefully when the supplier has no phone or no
 * messaging credentials are configured.
 */
async function notifySupplierPoConfirmed(poId: number): Promise<void> {
  try {
    const [po] = await db
      .select({
        id: purchaseOrdersTable.id,
        reference: purchaseOrdersTable.reference,
        total: purchaseOrdersTable.total,
        supplierId: purchaseOrdersTable.supplierId,
      })
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.id, poId));
    if (!po?.supplierId) return;
    const [supplier] = await db
      .select({ name: suppliersTable.name, phone: suppliersTable.phone })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, po.supplierId));
    if (!supplier?.phone) return;
    const body = [
      `مرحباً ${supplier.name}،`,
      `تم اعتماد أمر الشراء رقم ${po.reference} بقيمة ${po.total} ر.س.`,
      `يرجى تأكيد الاستلام والبدء بالتجهيز.`,
    ].join("\n");
    await sendMessage({
      channel: "whatsapp",
      provider: "whatsapp",
      to: supplier.phone,
      body,
    });
  } catch (err) {
    logger.warn({ err, poId }, "supplier PO confirmation dispatch failed");
  }
}

// Lightweight tagged HTTP error so business-rule violations bubble out of
// transactions as 4xx instead of opaque 500s. Throw via `httpErr(409, ...)`
// inside a handler/transaction; the surrounding catch uses `respondError`
// to map .status onto the response.
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function httpErr(status: number, message: string): HttpError {
  return new HttpError(status, message);
}
function respondError(res: import("express").Response, err: unknown, fallback = "internal"): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : fallback });
}

// Module-wide guard with PR carve-out: any authenticated user may
// create/submit/list/view a Purchase Requisition (so e.g. cashiers or
// branch staff can request items they need). All other procurement
// actions require procurementGuard, and PR approval requires adminGuard
// (enforced per-route below).
//
// NOTE: When mounted at "/procurement", Express strips the mount prefix
// from req.path inside this middleware — so we match against the
// post-mount tail (e.g. "/requisitions"), NOT the full path.
const PR_OPEN_GET = [
  /^\/requisitions\/?$/,        // list
  /^\/requisitions\/\d+\/?$/,    // detail
];
router.use("/procurement", (req, res, next) => {
  const path = req.path;
  const method = req.method;
  const isPrOpen =
    (method === "GET" && PR_OPEN_GET.some((rx) => rx.test(path))) ||
    (method === "POST" &&
      (/^\/requisitions\/?$/.test(path) ||
        /^\/requisitions\/\d+\/submit\/?$/.test(path)));
  if (isPrOpen) return next();
  // Read endpoints (PO/GRN/AP-aging/supplier-ledger/reports/stats/etc.)
  // are open to read-only roles such as auditor via supplierReadGuard.
  // Mutating endpoints still require procurementGuard (applied per-route
  // below on POST/PATCH/DELETE handlers — Express runs middlewares in
  // order, so we just let GETs through here).
  if (method === "GET") return supplierReadGuard(req, res, next);
  return procurementGuard(req, res, next);
});

// ----- Approvals & tolerances (env-tunable) -----
const PO_APPROVAL_THRESHOLD = Number(process.env.PO_APPROVAL_THRESHOLD ?? 50000);
const PO_INVOICE_PRICE_TOLERANCE_PCT = Number(
  process.env.PO_INVOICE_PRICE_TOLERANCE_PCT ?? 5,
);

// ----- Sequence helpers (per-year, atomic) -----
async function nextSeq(prefix: string, year: number): Promise<string> {
  const seqName = `${prefix.toLowerCase()}_seq_${year}`;
  await db.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${seqName} MINVALUE 1 START 1`));
  const r = await db.execute(sql.raw(`SELECT nextval('${seqName}')::bigint AS n`));
  const rows = (r as unknown as { rows?: Array<{ n: string | number }> }).rows ?? [];
  const seq = Number(rows[0]?.n ?? 1);
  return `${prefix}-${year}-${String(seq).padStart(5, "0")}`;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] } | undefined;
  return r?.rows ?? [];
}

// =========================================================================
// PURCHASE REQUISITIONS
// =========================================================================
const PrLineInput = z.object({
  productId: z.coerce.number().int().nullable().optional(),
  description: z.string().min(1),
  quantity: z.coerce.number().positive(),
  estimatedCost: z.coerce.number().min(0).default(0),
  neededBy: z.string().optional().nullable(),
});
const CreatePrBody = z.object({
  branchId: z.coerce.number().int().nullable().optional(),
  warehouseId: z.coerce.number().int().nullable().optional(),
  notes: z.string().optional().nullable(),
  lines: z.array(PrLineInput).min(1),
});

router.get("/procurement/requisitions", async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const conds = status ? [eq(purchaseRequisitionsTable.status, status)] : [];
    const rows = await db
      .select({
        id: purchaseRequisitionsTable.id,
        reference: purchaseRequisitionsTable.reference,
        status: purchaseRequisitionsTable.status,
        notes: purchaseRequisitionsTable.notes,
        warehouseId: purchaseRequisitionsTable.warehouseId,
        branchId: purchaseRequisitionsTable.branchId,
        approvedAt: purchaseRequisitionsTable.approvedAt,
        createdAt: purchaseRequisitionsTable.createdAt,
        lineCount: sql<number>`(SELECT count(*) FROM ${purchaseRequisitionLinesTable}
                                  WHERE ${purchaseRequisitionLinesTable.requisitionId} = ${purchaseRequisitionsTable.id})`,
        estimatedTotal: sql<number>`(SELECT COALESCE(SUM(estimated_cost * quantity),0)
                                       FROM ${purchaseRequisitionLinesTable}
                                      WHERE ${purchaseRequisitionLinesTable.requisitionId} = ${purchaseRequisitionsTable.id})`,
      })
      .from(purchaseRequisitionsTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(purchaseRequisitionsTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        lineCount: Number(r.lineCount),
        estimatedTotal: Number(r.estimatedTotal),
        approvedAt: r.approvedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "list requisitions failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/requisitions", async (req, res) => {
  try {
    const body = CreatePrBody.parse(req.body);
    const out = await db.transaction(async (tx) => {
      const reference = await nextSeq("PR", new Date().getUTCFullYear());
      const [pr] = await tx
        .insert(purchaseRequisitionsTable)
        .values({
          reference,
          requesterId: req.session?.userId ?? null,
          branchId: body.branchId ?? null,
          warehouseId: body.warehouseId ?? null,
          notes: body.notes ?? null,
          status: "draft",
        })
        .returning();
      for (const ln of body.lines) {
        await tx.insert(purchaseRequisitionLinesTable).values({
          requisitionId: pr.id,
          productId: ln.productId ?? null,
          description: ln.description,
          quantity: String(ln.quantity),
          estimatedCost: String(ln.estimatedCost),
          neededBy: ln.neededBy || null,
        });
      }
      return pr;
    });
    void recordAudit(req, { action: "create", entity: "purchase_requisition", details: out.reference });
    res.status(201).json(out); return;
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: "بيانات غير صالحة", details: err.issues }); return; }
    req.log.error({ err }, "create requisition failed");
    respondError(res, err); return;
  }
});

router.get("/procurement/requisitions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [pr] = await db.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
    if (!pr) { res.status(404).json({ error: "not found" }); return; }
    const lines = await db
      .select()
      .from(purchaseRequisitionLinesTable)
      .where(eq(purchaseRequisitionLinesTable.requisitionId, id));
    return res.json({
      ...pr,
      approvedAt: pr.approvedAt?.toISOString() ?? null,
      createdAt: pr.createdAt.toISOString(),
      lines: lines.map((l) => ({
        ...l,
        quantity: Number(l.quantity),
        estimatedCost: Number(l.estimatedCost),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "get requisition failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/requisitions/:id/submit", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [updated] = await db
      .update(purchaseRequisitionsTable)
      .set({ status: "submitted" })
      .where(and(eq(purchaseRequisitionsTable.id, id), eq(purchaseRequisitionsTable.status, "draft")))
      .returning();
    if (!updated) { res.status(409).json({ error: "لا يمكن تقديم هذا الطلب من حالته الحالية." }); return; }
    void recordAudit(req, { action: "submit", entity: "purchase_requisition", details: updated.reference });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "submit requisition failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/requisitions/:id/approve", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [updated] = await db
      .update(purchaseRequisitionsTable)
      .set({ status: "approved", approvedBy: req.session?.userId ?? null, approvedAt: new Date() })
      .where(and(eq(purchaseRequisitionsTable.id, id), eq(purchaseRequisitionsTable.status, "submitted")))
      .returning();
    if (!updated) { res.status(409).json({ error: "لا يمكن اعتماد طلب غير مقدّم." }); return; }
    void recordAudit(req, { action: "approve", entity: "purchase_requisition", details: updated.reference });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "approve requisition failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// RFQs (Request for Quotation) — multi-supplier price discovery + award
// =========================================================================
const RfqQuoteLineInput = z.object({
  productId: z.coerce.number().int().nullable().optional(),
  description: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  leadTimeDays: z.coerce.number().int().min(0).default(0),
});
const CreateRfqBody = z.object({
  requisitionId: z.coerce.number().int().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  supplierIds: z.array(z.coerce.number().int().positive()).min(1),
});
const SubmitQuoteBody = z.object({
  supplierId: z.coerce.number().int().positive(),
  lines: z.array(RfqQuoteLineInput).min(1),
});
const AwardRfqBody = z.object({
  supplierId: z.coerce.number().int().positive(),
});

router.get("/procurement/rfqs", async (req, res) => {
  try {
    const rows = await db.select().from(rfqsTable).orderBy(desc(rfqsTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "list rfqs failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/rfqs", async (req, res) => {
  let body: z.infer<typeof CreateRfqBody>;
  try {
    body = CreateRfqBody.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: "بيانات غير صالحة", details: err.issues }); return; }
    res.status(400).json({ error: "Bad request" }); return;
  }
  try {
    const out = await db.transaction(async (tx) => {
      const reference = await nextSeq("RFQ", new Date().getUTCFullYear());
      const [rfq] = await tx.insert(rfqsTable).values({
        reference,
        requisitionId: body.requisitionId ?? null,
        dueDate: body.dueDate ?? null,
        notes: body.notes ?? null,
        status: "sent",
        createdBy: req.session?.userId ?? null,
      }).returning();
      for (const supplierId of body.supplierIds) {
        await tx.insert(rfqSuppliersTable).values({ rfqId: rfq.id, supplierId, sentAt: new Date() });
      }
      return rfq;
    });
    void recordAudit(req, { action: "create", entity: "rfq", details: out.reference });
    res.status(201).json(out);
  } catch (err) {
    req.log.error({ err }, "create rfq failed");
    respondError(res, err); return;
  }
});

router.get("/procurement/rfqs/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rfq] = await db.select().from(rfqsTable).where(eq(rfqsTable.id, id));
    if (!rfq) { res.status(404).json({ error: "not found" }); return; }
    const suppliers = await db.select().from(rfqSuppliersTable).where(eq(rfqSuppliersTable.rfqId, id));
    const quoteLines = await db.select().from(rfqQuoteLinesTable).where(eq(rfqQuoteLinesTable.rfqId, id));
    // Compute supplier totals for easy comparison.
    const totalsBySupplier = new Map<number, number>();
    for (const ln of quoteLines) {
      const t = Number(ln.unitPrice) * Number(ln.quantity);
      totalsBySupplier.set(ln.supplierId, (totalsBySupplier.get(ln.supplierId) ?? 0) + t);
    }
    res.json({
      ...rfq,
      suppliers: suppliers.map((s) => ({ ...s, totalQuoted: totalsBySupplier.get(s.supplierId) ?? 0 })),
      quoteLines,
    });
  } catch (err) {
    req.log.error({ err }, "rfq detail failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/rfqs/:id/quotes", async (req, res) => {
  let body: z.infer<typeof SubmitQuoteBody>;
  try {
    body = SubmitQuoteBody.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: "بيانات غير صالحة", details: err.issues }); return; }
    res.status(400).json({ error: "Bad request" }); return;
  }
  try {
    const id = Number(req.params.id);
    await db.transaction(async (tx) => {
      const [rfq] = await tx.select().from(rfqsTable).where(eq(rfqsTable.id, id));
      if (!rfq) throw httpErr(404, "RFQ not found");
      if (rfq.status === "awarded" || rfq.status === "closed") {
        throw httpErr(409, "RFQ مغلق ولا يقبل عروضاً جديدة.");
      }
      // Replace existing lines for this supplier on the RFQ.
      await tx.delete(rfqQuoteLinesTable).where(
        and(eq(rfqQuoteLinesTable.rfqId, id), eq(rfqQuoteLinesTable.supplierId, body.supplierId)),
      );
      for (const ln of body.lines) {
        await tx.insert(rfqQuoteLinesTable).values({
          rfqId: id,
          supplierId: body.supplierId,
          productId: ln.productId ?? null,
          description: ln.description,
          quantity: String(ln.quantity),
          unitPrice: String(ln.unitPrice),
          leadTimeDays: ln.leadTimeDays,
        });
      }
      await tx.update(rfqSuppliersTable)
        .set({ respondedAt: new Date() })
        .where(and(eq(rfqSuppliersTable.rfqId, id), eq(rfqSuppliersTable.supplierId, body.supplierId)));
    });
    void recordAudit(req, { action: "quote", entity: "rfq", details: `RFQ#${id} supplier#${body.supplierId}` });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "submit quote failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/rfqs/:id/award", procurementGuard, async (req, res) => {
  let body: z.infer<typeof AwardRfqBody>;
  try {
    body = AwardRfqBody.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: "بيانات غير صالحة", details: err.issues }); return; }
    res.status(400).json({ error: "Bad request" }); return;
  }
  try {
    const id = Number(req.params.id);
    const out = await db.transaction(async (tx) => {
      const [rfq] = await tx.select().from(rfqsTable).where(eq(rfqsTable.id, id));
      if (!rfq) throw httpErr(404, "RFQ not found");
      if (rfq.status === "awarded") throw httpErr(409, "RFQ تم ترسيته مسبقاً.");
      const winningLines = await tx.select().from(rfqQuoteLinesTable)
        .where(and(eq(rfqQuoteLinesTable.rfqId, id), eq(rfqQuoteLinesTable.supplierId, body.supplierId)));
      if (winningLines.length === 0) throw httpErr(409, "لا يوجد عرض من هذا المورد لترسيته.");
      const [supplier] = await tx.select().from(suppliersTable).where(eq(suppliersTable.id, body.supplierId));
      if (!supplier) throw httpErr(404, "المورد غير موجود.");

      // Build PO directly from the awarded quote, honoring the
      // supplier's defaultTax/defaultCurrency where set.
      const TAX_RATE = Number(supplier.defaultTax ?? 15);
      let subtotal = 0;
      const poLines = winningLines.map((ln) => {
        const lineTotal = Number(ln.unitPrice) * Number(ln.quantity);
        subtotal += lineTotal;
        return {
          productId: ln.productId,
          description: ln.description,
          quantity: ln.quantity,
          unitPrice: ln.unitPrice,
          taxRate: String(TAX_RATE),
          lineTotal: String(lineTotal.toFixed(2)),
        };
      });
      const vat = +(subtotal * TAX_RATE / 100).toFixed(2);
      const total = +(subtotal + vat).toFixed(2);
      const requiresApproval = total >= PO_APPROVAL_THRESHOLD;
      const reference = await nextSeq("PO", new Date().getUTCFullYear());
      const [po] = await tx.insert(purchaseOrdersTable).values({
        reference,
        supplierId: body.supplierId,
        supplierName: supplier.name,
        orderDate: new Date().toISOString().slice(0, 10),
        status: "draft",
        currencyCode: supplier.defaultCurrency ?? "SAR",
        subtotal: subtotal.toFixed(2),
        vat: vat.toFixed(2),
        total: total.toFixed(2),
        requisitionId: rfq.requisitionId,
        rfqId: rfq.id,
        requiresApproval,
        createdBy: req.session?.userId ?? null,
      }).returning();
      for (const ln of poLines) {
        await tx.insert(purchaseOrderLinesTable).values({
          poId: po.id,
          productId: ln.productId,
          description: ln.description,
          quantity: ln.quantity,
          unitPrice: ln.unitPrice,
          taxRate: ln.taxRate,
          lineTotal: ln.lineTotal,
        });
      }
      await tx.update(rfqsTable)
        .set({ status: "awarded", awardedSupplierId: body.supplierId })
        .where(eq(rfqsTable.id, id));
      return po;
    });
    void recordAudit(req, { action: "award", entity: "rfq", details: `RFQ#${id} → PO ${out.reference}` });
    res.status(201).json(out);
  } catch (err) {
    req.log.error({ err }, "award rfq failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// PURCHASE ORDERS
// =========================================================================
const PoLineInput = z.object({
  productId: z.coerce.number().int().nullable().optional(),
  description: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).default(15),
});
const CreatePoBody = z.object({
  supplierId: z.coerce.number().int().positive(),
  warehouseId: z.coerce.number().int().nullable().optional(),
  orderDate: z.string().optional(),
  expectedDate: z.string().nullable().optional(),
  // currencyCode is optional: when omitted we fall back to the
  // supplier's defaultCurrency (then SAR).
  currencyCode: z.string().optional(),
  exchangeRate: z.coerce.number().positive().default(1),
  notes: z.string().nullable().optional(),
  requisitionId: z.coerce.number().int().nullable().optional(),
  rfqId: z.coerce.number().int().nullable().optional(),
  agreementId: z.coerce.number().int().nullable().optional(),
  lines: z.array(PoLineInput).min(1),
});

router.get("/procurement/purchase-orders", async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
    const conds = [];
    if (status) conds.push(eq(purchaseOrdersTable.status, status));
    if (supplierId) conds.push(eq(purchaseOrdersTable.supplierId, supplierId));
    const rows = await db
      .select()
      .from(purchaseOrdersTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(purchaseOrdersTable.createdAt));

    // Surface the latest send attempt per PO from procurement_email_outbox
    // (kind='purchase_order') so the list can render a delivered / queued /
    // failed badge identical to customer invoices + quotations
    // (see SendStatusBadge on the frontend).
    const ids = rows.map((r) => r.id);
    const lastSendById = new Map<number, {
      outboxId: number;
      status: string;
      recipient: string | null;
      error: string | null;
      createdAt: string | null;
      sentAt: string | null;
    }>();
    if (ids.length > 0) {
      const lastRes = await db.execute(sql`
        SELECT DISTINCT ON (ref_id)
          ref_id AS "refId",
          id AS "outboxId",
          status,
          recipient,
          error,
          created_at AS "createdAt",
          sent_at AS "sentAt"
        FROM procurement_email_outbox
        WHERE kind = 'purchase_order' AND ref_id = ANY(${ids}::int[])
        ORDER BY ref_id, created_at DESC, id DESC
      `);
      const lastRows = ((lastRes as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (lastRes as unknown as Array<Record<string, unknown>>)) ?? [];
      for (const lr of lastRows) {
        const refId = Number(lr["refId"]);
        if (!Number.isFinite(refId)) continue;
        const createdAt = lr["createdAt"];
        const sentAt = lr["sentAt"];
        lastSendById.set(refId, {
          outboxId: Number(lr["outboxId"]),
          status: String(lr["status"] ?? ""),
          recipient: lr["recipient"] == null ? null : String(lr["recipient"]),
          error: lr["error"] == null ? null : String(lr["error"]),
          createdAt: createdAt instanceof Date
            ? createdAt.toISOString()
            : (createdAt as string | null) ?? null,
          sentAt: sentAt instanceof Date
            ? sentAt.toISOString()
            : (sentAt as string | null) ?? null,
        });
      }
    }

    res.json(
      rows.map((r) => ({
        ...r,
        subtotal: Number(r.subtotal),
        vat: Number(r.vat),
        total: Number(r.total),
        exchangeRate: Number(r.exchangeRate),
        approvedAt: r.approvedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        lastSend: lastSendById.get(r.id) ?? null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "list POs failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/purchase-orders", async (req, res) => {
  let body: z.infer<typeof CreatePoBody>;
  try {
    body = CreatePoBody.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: "بيانات غير صالحة", details: err.issues }); return; }
    res.status(400).json({ error: "Bad request" }); return;
  }
  try {
    const out = await db.transaction(async (tx) => {
      const [supplier] = await tx
        .select()
        .from(suppliersTable)
        .where(eq(suppliersTable.id, body.supplierId))
        .limit(1);
      if (!supplier) throw httpErr(404, "المورد غير موجود");

      // Defaults: currency from supplier, tax per-line falls back to
      // the supplier's defaultTax when the input didn't override it.
      const currency = body.currencyCode ?? supplier.defaultCurrency ?? "SAR";
      const supplierDefaultTax = Number(supplier.defaultTax ?? 15);
      let subtotal = 0;
      let vat = 0;
      const lineInserts: Array<{
        productId: number | null; description: string; quantity: string;
        unitPrice: string; taxRate: string; lineTotal: string;
      }> = [];
      for (const ln of body.lines) {
        // The PoLineInput zod schema applies a default of 15 when taxRate
        // is missing. To honor the supplier's defaultTax we also override
        // when the caller explicitly omitted the field on the request.
        const taxRate = (req.body?.lines?.find?.((rl: { description?: string }, i: number) =>
          rl?.description === ln.description && i === body.lines.indexOf(ln),
        )?.taxRate == null)
          ? supplierDefaultTax
          : ln.taxRate;
        const sub = ln.quantity * ln.unitPrice;
        const t = sub * (taxRate / 100);
        subtotal += sub;
        vat += t;
        lineInserts.push({
          productId: ln.productId ?? null,
          description: ln.description,
          quantity: String(ln.quantity),
          unitPrice: String(ln.unitPrice),
          taxRate: String(taxRate),
          lineTotal: (sub + t).toFixed(2),
        });
      }
      const total = subtotal + vat;
      const reference = await nextSeq("PO", new Date().getUTCFullYear());

      const [po] = await tx
        .insert(purchaseOrdersTable)
        .values({
          reference,
          supplierId: supplier.id,
          supplierName: supplier.name,
          warehouseId: body.warehouseId ?? null,
          status: "draft",
          orderDate: body.orderDate ?? new Date().toISOString().slice(0, 10),
          expectedDate: body.expectedDate ?? null,
          currencyCode: currency,
          exchangeRate: String(body.exchangeRate),
          subtotal: subtotal.toFixed(2),
          vat: vat.toFixed(2),
          total: total.toFixed(2),
          notes: body.notes ?? null,
          requisitionId: body.requisitionId ?? null,
          rfqId: body.rfqId ?? null,
          agreementId: body.agreementId ?? null,
          requiresApproval: total >= PO_APPROVAL_THRESHOLD,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      for (const li of lineInserts) {
        await tx.insert(purchaseOrderLinesTable).values({ ...li, poId: po.id });
      }
      // If converted from a requisition, mark it.
      if (body.requisitionId) {
        await tx
          .update(purchaseRequisitionsTable)
          .set({ status: "converted" })
          .where(eq(purchaseRequisitionsTable.id, body.requisitionId));
      }
      return po;
    });
    void recordAudit(req, { action: "create", entity: "purchase_order", details: out.reference });
    // Automation hook: rules with trigger.type='record_created' on the
    // 'purchase_order' entity are evaluated against the new row so admins
    // can auto-notify on big-ticket POs, kick off webhooks, etc.
    void triggerEvent("record_created", "purchase_order", {
      id: out.id,
      total: Number(out.total),
      supplierId: out.supplierId,
      currencyCode: out.currencyCode,
    });
    res.status(201).json(out); return;
  } catch (err) {
    req.log.error({ err }, "create PO failed");
    respondError(res, err); return;
  }
});

router.get("/procurement/purchase-orders/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
    if (!po) { res.status(404).json({ error: "not found" }); return; }
    const lines = await db
      .select()
      .from(purchaseOrderLinesTable)
      .where(eq(purchaseOrderLinesTable.poId, id));
    const receipts = await db
      .select({
        id: goodsReceiptsTable.id,
        reference: goodsReceiptsTable.reference,
        receivedAt: goodsReceiptsTable.receivedAt,
        notes: goodsReceiptsTable.notes,
      })
      .from(goodsReceiptsTable)
      .where(eq(goodsReceiptsTable.poId, id))
      .orderBy(desc(goodsReceiptsTable.receivedAt));
    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.poId, id))
      .orderBy(desc(invoicesTable.createdAt));
    const outboxResult = await db.execute(sql`
      SELECT id, recipient, subject, attachment_filename, status, error,
             created_at, sent_at
        FROM procurement_email_outbox
       WHERE kind = 'purchase_order' AND ref_id = ${id}
       ORDER BY created_at DESC
    `);
    const outboxRows = (outboxResult as unknown as { rows?: Array<Record<string, unknown>> }).rows
      ?? (outboxResult as unknown as Array<Record<string, unknown>>);
    return res.json({
      ...po,
      subtotal: Number(po.subtotal),
      vat: Number(po.vat),
      total: Number(po.total),
      exchangeRate: Number(po.exchangeRate),
      approvedAt: po.approvedAt?.toISOString() ?? null,
      createdAt: po.createdAt.toISOString(),
      lines: lines.map((l) => ({
        ...l,
        quantity: Number(l.quantity),
        receivedQty: Number(l.receivedQty),
        billedQty: Number(l.billedQty),
        unitPrice: Number(l.unitPrice),
        taxRate: Number(l.taxRate),
        lineTotal: Number(l.lineTotal),
      })),
      receipts: receipts.map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString() })),
      invoices: invoices.map((i) => ({
        ...i,
        amount: Number(i.amount),
        dueDate: i.dueDate?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      })),
      outbox: outboxRows.map((r) => ({
        id: r.id,
        recipient: r.recipient,
        subject: r.subject,
        attachmentFilename: r.attachment_filename,
        status: r.status,
        error: r.error,
        createdAt: r.created_at instanceof Date
          ? r.created_at.toISOString()
          : r.created_at,
        sentAt: r.sent_at instanceof Date
          ? r.sent_at.toISOString()
          : r.sent_at,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "get PO failed");
    respondError(res, err); return;
  }
});

// Core PO confirm transition. Extracted so both the HTTP route and the
// workflow-engine onApprove handler can run the exact same finalization
// (status -> confirmed, blanket-agreement consumption, audit, event).
async function finalizePurchaseOrderConfirm(
  id: number,
  actor: { userId: number | null; reference?: string },
): Promise<void> {
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
  if (!po) throw httpErr(404, "not found");
  if (po.status !== "draft" && po.status !== "pending_approval") return; // idempotent
  await db.transaction(async (tx) => {
    await tx
      .update(purchaseOrdersTable)
      .set({
        status: "confirmed",
        approvedAt: new Date(),
        approvedBy: actor.userId,
      })
      .where(eq(purchaseOrdersTable.id, id));
    if (po.agreementId) {
      const [ag] = await tx
        .select()
        .from(blanketAgreementsTable)
        .where(eq(blanketAgreementsTable.id, po.agreementId));
      if (ag && ag.status === "active") {
        const committed = Number(ag.totalCommittedValue);
        const released = Number(ag.releasedValue);
        const newReleased = released + Number(po.total);
        if (newReleased > committed + 0.01) {
          throw httpErr(409, `هذا الأمر يتجاوز الرصيد المتبقي على الاتفاقية ${ag.reference}.`);
        }
        await tx
          .update(blanketAgreementsTable)
          .set({ releasedValue: newReleased.toFixed(2) })
          .where(eq(blanketAgreementsTable.id, ag.id));
        const lines = await tx
          .select()
          .from(purchaseOrderLinesTable)
          .where(eq(purchaseOrderLinesTable.poId, id));
        for (const ln of lines) {
          if (!ln.productId) continue;
          await tx
            .update(blanketAgreementItemsTable)
            .set({
              releasedQty: sql`${blanketAgreementItemsTable.releasedQty} + ${Number(ln.quantity)}`,
            })
            .where(
              and(
                eq(blanketAgreementItemsTable.agreementId, ag.id),
                eq(blanketAgreementItemsTable.productId, ln.productId),
              ),
            );
        }
      }
    }
  });
  void triggerEvent("state_changed", "purchase_order", { id, total: Number(po.total) }, "confirmed");
  // Module hook: WhatsApp/SMS supplier confirmation. Runs after the
  // commit so the supplier never gets a notification for a PO that
  // failed to persist.
  void notifySupplierPoConfirmed(id);
}

// Workflow-engine handler: when an approval chain completes, finalize the
// PO confirm transition (status, agreement consumption, event) atomically
// without requiring the submitter to re-confirm. Failures propagate so the
// engine can roll the request back to pending and keep workflow + record
// state consistent.
registerOnApprove("purchase_order", async (recordId) => {
  await finalizePurchaseOrderConfirm(recordId, { userId: null });
});

// On reject / changes-requested, unlock the PO so the submitter can edit
// and resubmit. Without this the document would stay stuck in
// "pending_approval" forever.
registerOnReject("purchase_order", async (recordId) => {
  try {
    await db
      .update(purchaseOrdersTable)
      .set({ status: "draft" })
      .where(eq(purchaseOrdersTable.id, recordId));
  } catch (err) {
    logger.error({ err, recordId }, "PO onReject revert failed");
  }
});

// ---------------------------------------------------------------------------
// Workflow-engine integration: Payment Run execute.
//   * /procurement/payment-runs/:id/execute opens an approval chain when a
//     rule matches; the run is locked into "pending_approval" and a 202 is
//     returned.
//   * On approve we *finalize* the run by invoking the same
//     finalizePaymentRunExecute helper used by the route, so the JE is
//     posted, supplier balances and invoices are updated automatically.
//   * On reject we revert to draft so the submitter can adjust + re-submit.
// ---------------------------------------------------------------------------
async function finalizePaymentRunExecute(
  id: number,
  sessionUserId: number | null,
): Promise<{ journalEntryId: number; total: number }> {
  return await db.transaction(async (tx) => {
    const [run] = await tx.select().from(paymentRunsTable).where(eq(paymentRunsTable.id, id));
    if (!run) throw httpErr(404, "not found");
    if (run.status !== "draft" && run.status !== "pending_approval")
      throw httpErr(409, "الدفع تم تنفيذه مسبقاً.");
    const lines = await tx.select().from(paymentRunLinesTable).where(eq(paymentRunLinesTable.runId, id));
    if (lines.length === 0) throw httpErr(409, "لا توجد بنود في هذه الدفعة.");
    const invIds = lines.map((l) => l.invoiceId).filter((x): x is number => x != null);
    if (invIds.length > 0) {
      const invs = await tx.select().from(invoicesTable).where(inArray(invoicesTable.id, invIds));
      for (const inv of invs) {
        if (inv.status === "paid" || inv.status === "failed") {
          throw httpErr(
            409,
            `الفاتورة #${inv.id} لم تعد قابلة للدفع (الحالة: ${inv.status}). أعد فتح الدفعة.`,
          );
        }
      }
    }
    const cashKey = run.paymentMethod === "cash" ? "cash" : "bank";
    const total = lines.reduce((s, l) => s + Number(l.amount), 0);
    const journalLines: Array<{
      systemKey: string; debit?: number; credit?: number; description?: string;
    }> = lines.map((l) => ({
      systemKey: "ap",
      debit: Number(l.amount),
      description: `سداد للمورد #${l.supplierId}`,
    }));
    journalLines.push({
      systemKey: cashKey,
      credit: total,
      description: `دفعة ${run.reference}`,
    });
    const je = await postJournalEntry(
      tx,
      {
        entryDate: new Date(run.paymentDate),
        description: `دفعة موردين — ${run.reference}`,
        reference: run.reference,
        source: "payment",
        sourceRef: run.reference,
        createdBy: sessionUserId,
        status: "posted",
      },
      journalLines,
    );
    for (const ln of lines) {
      await tx
        .update(suppliersTable)
        .set({ balance: sql`${suppliersTable.balance} - ${Number(ln.amount)}` })
        .where(eq(suppliersTable.id, ln.supplierId));
      await tx
        .update(paymentRunLinesTable)
        .set({ journalEntryId: je.id })
        .where(eq(paymentRunLinesTable.id, ln.id));
      if (ln.invoiceId) {
        await tx
          .update(invoicesTable)
          .set({ status: "paid" })
          .where(eq(invoicesTable.id, ln.invoiceId));
      }
    }
    await tx
      .update(paymentRunsTable)
      .set({ status: "executed", executedAt: new Date() })
      .where(eq(paymentRunsTable.id, id));
    return { journalEntryId: je.id, total };
  });
}
registerOnApprove("payment_run", async (recordId) => {
  // Rethrow on failure: actOnApproval rolls the request back to pending
  // and surfaces the error so workflow + document state stay consistent.
  // Logging is kept for observability.
  try {
    await finalizePaymentRunExecute(recordId, null);
    void triggerEvent("state_changed", "payment_run", { id: recordId }, "executed");
  } catch (err) {
    logger.error({ err, recordId }, "payment_run onApprove finalize failed");
    throw err;
  }
});
registerOnReject("payment_run", async (recordId) => {
  try {
    await db
      .update(paymentRunsTable)
      .set({ status: "draft" })
      .where(eq(paymentRunsTable.id, recordId));
  } catch (err) {
    logger.error({ err, recordId }, "payment_run onReject revert failed");
  }
});

router.post("/procurement/purchase-orders/:id/confirm", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
    if (!po) { res.status(404).json({ error: "not found" }); return; }
    if (po.status !== "draft") { res.status(409).json({ error: "أمر الشراء ليس بحالة مسودة." }); return; }
    // Workflow-engine hook: if a configurable approval rule matches, queue
    // the confirm and respond 202. The registered onApprove handler will
    // run finalizePurchaseOrderConfirm when the chain completes.
    const submission = await submitForApproval({
      docType: "purchase_order",
      recordId: id,
      recordRef: po.reference,
      amount: Number(po.total),
      branchId: null,
      submittedByUserId: req.session?.userId ?? null,
      submittedByName: (req.session as { userName?: string } | undefined)?.userName ?? null,
    });
    if (submission.required) {
      // Lock the document into a real "pending_approval" business state so
      // it can't be re-confirmed or further edited while the chain is open.
      // The onApprove handler accepts both draft and pending_approval as
      // input, and the onReject handler reverts back to draft.
      await db
        .update(purchaseOrdersTable)
        .set({ status: "pending_approval" })
        .where(eq(purchaseOrdersTable.id, id));
      res.status(202).json({
        ok: false,
        pendingApproval: true,
        approvalRequestId: submission.requestId,
        message: "أمر الشراء بانتظار الاعتماد",
      });
      return;
    }
    // Legacy hard-coded threshold gate (only applies when no configurable
    // workflow rule matched). Once an admin configures an approval rule for
    // purchase_order, the engine takes over end-to-end.
    if (po.requiresApproval && !po.approvedAt) {
      res.status(409).json({
        error: `أمر الشراء يتطلب اعتماد المدير (تجاوز ${PO_APPROVAL_THRESHOLD} ر.س).`,
      });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(purchaseOrdersTable)
        .set({ status: "confirmed" })
        .where(eq(purchaseOrdersTable.id, id))
        .returning();
      // Blanket-agreement call-off: when the PO is released against an
      // active agreement, consume committed value (and per-line qty) from
      // the agreement so the remaining commitment shrinks.
      if (po.agreementId) {
        const [ag] = await tx
          .select()
          .from(blanketAgreementsTable)
          .where(eq(blanketAgreementsTable.id, po.agreementId));
        if (ag && ag.status === "active") {
          const committed = Number(ag.totalCommittedValue);
          const released = Number(ag.releasedValue);
          const newReleased = released + Number(po.total);
          if (newReleased > committed + 0.01) {
            throw httpErr(
              409,
              `هذا الأمر يتجاوز الرصيد المتبقي على الاتفاقية ${ag.reference}.`,
            );
          }
          await tx
            .update(blanketAgreementsTable)
            .set({ releasedValue: newReleased.toFixed(2) })
            .where(eq(blanketAgreementsTable.id, ag.id));
          // Per-item consumption (best-effort: match by productId)
          const lines = await tx
            .select()
            .from(purchaseOrderLinesTable)
            .where(eq(purchaseOrderLinesTable.poId, id));
          for (const ln of lines) {
            if (!ln.productId) continue;
            await tx
              .update(blanketAgreementItemsTable)
              .set({
                releasedQty: sql`${blanketAgreementItemsTable.releasedQty} + ${Number(ln.quantity)}`,
              })
              .where(
                and(
                  eq(blanketAgreementItemsTable.agreementId, ag.id),
                  eq(blanketAgreementItemsTable.productId, ln.productId),
                ),
              );
          }
        }
      }
      return u;
    });
    void recordAudit(req, { action: "confirm", entity: "purchase_order", details: updated.reference });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "confirm PO failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/purchase-orders/:id/approve", async (req, res) => {
  try {
    const role = req.session?.role;
    if (role !== "owner" && role !== "manager") {
      res.status(403).json({ error: "اعتماد أوامر الشراء مقصور على المدير/المالك." }); return;
    }
    const id = Number(req.params.id);
    const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
    if (!po) { res.status(404).json({ error: "not found" }); return; }
    if (!po.requiresApproval) {
      res.status(409).json({ error: "أمر الشراء لا يستوجب اعتماداً." }); return;
    }
    if (po.approvedAt) {
      res.status(409).json({ error: "أمر الشراء مُعتمد مسبقاً." }); return;
    }
    if (po.status !== "draft" && po.status !== "confirmed") {
      res.status(409).json({ error: `لا يمكن اعتماد أمر شراء بحالة "${po.status}".` }); return;
    }
    const [updated] = await db
      .update(purchaseOrdersTable)
      .set({ approvedBy: req.session?.userId ?? null, approvedAt: new Date() })
      .where(eq(purchaseOrdersTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "not found" }); return; }
    void recordAudit(req, { action: "approve", entity: "purchase_order", details: updated.reference });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "approve PO failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/purchase-orders/:id/cancel", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
    if (!po) { res.status(404).json({ error: "not found" }); return; }
    if (po.status === "fully_received" || po.status === "closed") {
      res.status(409).json({ error: "لا يمكن إلغاء أمر شراء مستلم/مغلق." }); return;
    }
    await db.update(purchaseOrdersTable).set({ status: "cancelled" }).where(eq(purchaseOrdersTable.id, id));
    void recordAudit(req, {
      action: "cancel", entity: "purchase_order", details: po.reference, severity: "warning",
    });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "cancel PO failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/purchase-orders/:id/close", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
    if (!po) { res.status(404).json({ error: "not found" }); return; }
    // Lifecycle: only POs that are fully received may be closed. Cancellation
    // is a separate transition and goes through /cancel; closing a draft or
    // partially-received PO would short-circuit the audit trail.
    if (po.status !== "fully_received") {
      res.status(409).json({
        error: `لا يمكن إغلاق أمر شراء بحالة "${po.status}". يجب استلامه بالكامل أولاً.`,
      });
      return;
    }
    await db.update(purchaseOrdersTable).set({ status: "closed" }).where(eq(purchaseOrdersTable.id, id));
    void recordAudit(req, { action: "close", entity: "purchase_order", details: po.reference });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "close PO failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// Send confirmed PO to supplier with bilingual PDF
//   * Generates a bilingual (Arabic/English) PDF using pdfkit
//   * Dispatches via the configured SMTP mailer with the PDF attached
//   * Stamps sent_to_supplier_at + sent_to_supplier_email so the UI can
//     show "Sent on <date>" and prevent accidental double-sends.
//   * Also exposes a preview endpoint that just streams the PDF back so
//     procurement staff can verify the document before emailing.
// =========================================================================
const SendPoBody = z.object({
  to: z.string().email().optional(),
  subject: z.string().optional(),
  message: z.string().optional(),
});

// Re-render a PO's email payload (PDF + subject + body) from the latest
// DB state. Used by the background retry worker so each redispatch
// reflects current line totals / supplier contact rather than the stale
// snapshot stored on the original outbox row. Returns { ok: false } when
// the PO no longer exists or its lifecycle no longer allows sending.
export async function renderPurchaseOrderForRetry(id: number): Promise<
  | {
      ok: true;
      pdf: Buffer;
      po: typeof purchaseOrdersTable.$inferSelect;
      subject: string;
      body: string;
      attachmentFilename: string;
    }
  | { ok: false; status: 400 | 404 | 409; error: string }
> {
  if (!Number.isFinite(id)) return { ok: false, status: 400, error: "Bad id" };
  const [po] = await db
    .select()
    .from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.id, id));
  if (!po) return { ok: false, status: 404, error: "أمر الشراء غير موجود" };
  const sendable = ["confirmed", "partially_received", "fully_received", "closed"];
  if (!sendable.includes(po.status)) {
    return {
      ok: false,
      status: 409,
      error: `لا يمكن إرسال أمر شراء بحالة "${po.status}".`,
    };
  }
  const lines = await db
    .select()
    .from(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.poId, id));
  const [supplier] = await db
    .select()
    .from(suppliersTable)
    .where(eq(suppliersTable.id, po.supplierId));
  const pdf = await buildPurchaseOrderPdf(
    {
      reference: po.reference,
      orderDate: po.orderDate,
      expectedDate: po.expectedDate,
      currencyCode: po.currencyCode,
      subtotal: Number(po.subtotal),
      vat: Number(po.vat),
      total: Number(po.total),
      notes: po.notes,
      supplier: {
        name: supplier?.name ?? po.supplierName,
        email: supplier?.email ?? null,
        phone: supplier?.phone ?? null,
        address: supplier?.address ?? null,
        vatNumber: supplier?.vatNumber ?? null,
      },
      lines: lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        taxRate: Number(l.taxRate),
        lineTotal: Number(l.lineTotal),
      })),
    },
    await getCompanyInfo(),
  );
  const subject = `Purchase Order ${po.reference} / أمر شراء`;
  const body = [
    `Dear ${supplier?.name ?? po.supplierName},`,
    ``,
    `Please find attached purchase order ${po.reference} for ${po.total} ${po.currencyCode}.`,
    `Kindly confirm receipt and proceed with preparation.`,
    ``,
    `---`,
    ``,
    `السلام عليكم،`,
    ``,
    `نرفق لكم أمر الشراء رقم ${po.reference} بقيمة ${po.total} ${po.currencyCode}.`,
    `يرجى تأكيد الاستلام والبدء بالتجهيز.`,
    ``,
    `مع التحية.`,
  ].join("\n");
  return {
    ok: true,
    pdf,
    po,
    subject,
    body,
    attachmentFilename: `PO-${po.reference}.pdf`,
  };
}

async function loadPoForPdf(id: number) {
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
  if (!po) throw httpErr(404, "أمر الشراء غير موجود");
  const lines = await db
    .select()
    .from(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.poId, id));
  const [supplier] = await db
    .select()
    .from(suppliersTable)
    .where(eq(suppliersTable.id, po.supplierId));
  return {
    po,
    supplier,
    pdfInput: {
      reference: po.reference,
      orderDate: po.orderDate,
      expectedDate: po.expectedDate,
      currencyCode: po.currencyCode,
      subtotal: Number(po.subtotal),
      vat: Number(po.vat),
      total: Number(po.total),
      notes: po.notes,
      supplier: {
        name: supplier?.name ?? po.supplierName,
        email: supplier?.email ?? null,
        phone: supplier?.phone ?? null,
        address: supplier?.address ?? null,
        vatNumber: supplier?.vatNumber ?? null,
      },
      lines: lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        taxRate: Number(l.taxRate),
        lineTotal: Number(l.lineTotal),
      })),
    },
  };
}

router.get("/procurement/purchase-orders/:id/pdf", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { po, pdfInput } = await loadPoForPdf(id);
    const buf = await buildPurchaseOrderPdf(pdfInput, await getCompanyInfo());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="PO-${po.reference}.pdf"`,
    );
    res.send(buf);
  } catch (err) {
    req.log.error({ err }, "PO pdf failed");
    respondError(res, err); return;
  }
});

/**
 * Dispatch a PO to a supplier and record the attempt in the
 * `procurement_email_outbox`. Used by both the initial send route and the
 * retry route so every attempt — success or failure — leaves a row in the
 * outbox audit trail.
 */
export async function dispatchPurchaseOrder(opts: {
  poId: number;
  toOverride?: string;
  subjectOverride?: string;
  messageOverride?: string;
  userId: number | null;
  retryOf?: number;
}): Promise<{
  status: number;
  payload: Record<string, unknown>;
  audit?: { details: string };
}> {
  const { po, supplier, pdfInput } = await loadPoForPdf(opts.poId);
  const sendable = ["confirmed", "partially_received", "fully_received", "closed"];
  if (!sendable.includes(po.status)) {
    return {
      status: 409,
      payload: {
        error: `لا يمكن إرسال أمر شراء بحالة "${po.status}". يجب تأكيده أولاً.`,
      },
    };
  }
  const recipient = opts.toOverride ?? supplier?.email ?? null;
  if (!recipient) {
    return { status: 400, payload: { error: "لا يوجد بريد إلكتروني للمورد" } };
  }
  const pdf = await buildPurchaseOrderPdf(pdfInput, await getCompanyInfo());
  const subject = opts.subjectOverride ?? `Purchase Order ${po.reference} / أمر شراء`;
  const emailBody = opts.messageOverride ?? [
    `Dear ${supplier?.name ?? po.supplierName},`,
    ``,
    `Please find attached purchase order ${po.reference} for ${po.total} ${po.currencyCode}.`,
    `Kindly confirm receipt and proceed with preparation.`,
    ``,
    `---`,
    ``,
    `السلام عليكم،`,
    ``,
    `نرفق لكم أمر الشراء رقم ${po.reference} بقيمة ${po.total} ${po.currencyCode}.`,
    `يرجى تأكيد الاستلام والبدء بالتجهيز.`,
    ``,
    `مع التحية.`,
  ].join("\n");
  const attachmentFilename = `PO-${po.reference}.pdf`;

  const dispatch = await sendMail({
    to: recipient,
    subject,
    body: emailBody,
    attachments: [{
      filename: attachmentFilename,
      content: pdf,
      contentType: "application/pdf",
    }],
  });

  const outboxStatus = dispatch.sent ? "sent" : "failed";
  const errorMsg = dispatch.sent ? null : dispatch.reason ?? "delivery failed";

  // Insert the outbox row (always, regardless of success) and — only when
  // the dispatch actually went out — stamp the convenience fields on the PO
  // itself so existing UI keeps working.
  const outboxId = await db.transaction(async (tx) => {
    const inserted = await tx.execute(sql`
      INSERT INTO procurement_email_outbox
        (kind, ref_id, reference, recipient, subject, body,
         attachment_filename, status, error, created_by, sent_at,
         retry_of, attempts)
      VALUES ('purchase_order', ${po.id}, ${po.reference}, ${recipient},
              ${subject}, ${emailBody}, ${attachmentFilename},
              ${outboxStatus}, ${errorMsg}, ${opts.userId},
              ${dispatch.sent ? sql`now()` : sql`null`},
              ${opts.retryOf ?? null}, 0)
      RETURNING id;
    `);
    const rows = (inserted as unknown as { rows?: Array<Record<string, unknown>> }).rows
      ?? (inserted as unknown as Array<Record<string, unknown>>);
    if (dispatch.sent) {
      await tx
        .update(purchaseOrdersTable)
        .set({ sentToSupplierAt: new Date(), sentToSupplierEmail: recipient })
        .where(eq(purchaseOrdersTable.id, po.id));
    }
    return rows?.[0]?.id as number | undefined;
  });

  if (!dispatch.sent) {
    return {
      status: 502,
      payload: {
        ok: false,
        dispatched: false,
        sentTo: recipient,
        outboxId,
        outboxStatus,
        mailerConfigured: isMailerConfigured(),
        reason: dispatch.reason,
      },
    };
  }
  return {
    status: 200,
    payload: {
      ok: true,
      dispatched: true,
      sentTo: recipient,
      sentAt: new Date().toISOString(),
      outboxId,
      outboxStatus,
      mailerConfigured: true,
    },
    audit: { details: `${po.reference} → ${recipient}` },
  };
}

router.post("/procurement/purchase-orders/:id/send", async (req, res) => {
  let body: z.infer<typeof SendPoBody>;
  try {
    body = SendPoBody.parse(req.body ?? {});
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: "بيانات غير صالحة", details: err.issues }); return; }
    res.status(400).json({ error: "Bad request" }); return;
  }
  try {
    const id = Number(req.params.id);
    const result = await dispatchPurchaseOrder({
      poId: id,
      toOverride: body.to,
      subjectOverride: body.subject,
      messageOverride: body.message,
      userId: req.session?.userId ?? null,
    });
    if (result.audit) {
      void recordAudit(req, {
        action: "send", entity: "purchase_order", details: result.audit.details,
      });
    }
    res.status(result.status).json(result.payload);
  } catch (err) {
    req.log.error({ err }, "send PO failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// PO email outbox — list every dispatch attempt for a PO, and retry a
// failed/queued row. The outbox is the durable audit trail; retrying just
// kicks off another attempt (which writes a brand new row).
// =========================================================================
router.get("/procurement/purchase-orders/:id/outbox", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await db.execute(sql`
      SELECT id, recipient, subject, attachment_filename, status, error,
             created_by, created_at, sent_at
        FROM procurement_email_outbox
       WHERE kind = 'purchase_order' AND ref_id = ${id}
       ORDER BY created_at DESC
    `);
    const rows = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows
      ?? (result as unknown as Array<Record<string, unknown>>);
    res.json({
      entries: rows.map((r) => ({
        id: r.id,
        recipient: r.recipient,
        subject: r.subject,
        attachmentFilename: r.attachment_filename,
        status: r.status,
        error: r.error,
        createdBy: r.created_by,
        createdAt: r.created_at instanceof Date
          ? r.created_at.toISOString()
          : r.created_at,
        sentAt: r.sent_at instanceof Date
          ? r.sent_at.toISOString()
          : r.sent_at,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "list PO outbox failed");
    respondError(res, err); return;
  }
});

router.post(
  "/procurement/purchase-orders/:id/outbox/:outboxId/retry",
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const outboxId = Number(req.params.outboxId);
      const result = await db.execute(sql`
        SELECT id, recipient, subject, body, status
          FROM procurement_email_outbox
         WHERE id = ${outboxId}
           AND kind = 'purchase_order'
           AND ref_id = ${id}
      `);
      const rows = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (result as unknown as Array<Record<string, unknown>>);
      const row = rows?.[0];
      if (!row) { res.status(404).json({ error: "السجل غير موجود" }); return; }
      if (row.status === "sent") {
        res.status(409).json({ error: "تم الإرسال بنجاح مسبقاً، لا حاجة لإعادة المحاولة" });
        return;
      }
      const dispatch = await dispatchPurchaseOrder({
        poId: id,
        toOverride: row.recipient as string,
        subjectOverride: row.subject as string,
        messageOverride: row.body as string,
        userId: req.session?.userId ?? null,
      });
      if (dispatch.audit) {
        void recordAudit(req, {
          action: "send_retry", entity: "purchase_order",
          details: dispatch.audit.details,
        });
      }
      res.status(dispatch.status).json(dispatch.payload);
    } catch (err) {
      req.log.error({ err }, "retry PO outbox failed");
      respondError(res, err); return;
    }
  },
);

// =========================================================================
// GOODS RECEIPTS — posts stock + Dr Inventory / Cr GR-IR
// =========================================================================
const GrnLineInput = z.object({
  poLineId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive(),
  // Optional lot/serial/barcode for tracked products. The stock engine
  // requires lotId for lot-tracked receipts and serialId for serial-
  // tracked products; we resolve a lotNumber to a lot row here.
  lotNumber: z.string().trim().min(1).optional(),
  expiryDate: z.string().optional(),
  serialId: z.coerce.number().int().positive().optional(),
  barcode: z.string().trim().min(1).optional(),
});
const CreateGrnBody = z.object({
  poId: z.coerce.number().int().positive(),
  warehouseId: z.coerce.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(GrnLineInput).min(1),
});

router.post("/procurement/goods-receipts", async (req, res) => {
  let body: z.infer<typeof CreateGrnBody>;
  try {
    body = CreateGrnBody.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: "بيانات غير صالحة", details: err.issues }); return; }
    res.status(400).json({ error: "Bad request" }); return;
  }
  try {
    const out = await db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, body.poId));
      if (!po) throw httpErr(404, "أمر الشراء غير موجود");
      if (po.status !== "confirmed" && po.status !== "partially_received") {
        throw httpErr(409, `لا يمكن استلام بضاعة على أمر شراء بحالة ${po.status}`);
      }
      // Segregation of Duties: the user who created the purchase order
      // cannot also be the user who confirms physical receipt of the
      // goods. Allowing both signatures from one human defeats the
      // standard fraud control (fictitious receipts → fictitious
      // payables). The rule applies to every role including owner —
      // emergencies should route through the configured approval matrix
      // (workflow-engine) instead of being side-stepped at this layer.
      const sessionUserId = req.session?.userId ?? null;
      if (
        sessionUserId != null &&
        po.createdBy != null &&
        sessionUserId === po.createdBy
      ) {
        throw httpErr(
          403,
          "لا يمكن استلام بضاعة على أمر شراء قمت بإنشائه (مبدأ فصل المهام). يجب على مستخدم آخر تسجيل الاستلام.",
        );
      }
      const warehouseId = body.warehouseId ?? po.warehouseId ?? (await getDefaultWarehouseId(tx));
      const reference = await nextSeq("GRN", new Date().getUTCFullYear());

      const [grn] = await tx
        .insert(goodsReceiptsTable)
        .values({
          reference,
          poId: po.id,
          warehouseId,
          receivedBy: req.session?.userId ?? null,
          notes: body.notes ?? null,
        })
        .returning();

      let totalValue = 0;
      for (const ln of body.lines) {
        const [poLine] = await tx
          .select()
          .from(purchaseOrderLinesTable)
          .where(eq(purchaseOrderLinesTable.id, ln.poLineId));
        if (!poLine || poLine.poId !== po.id) {
          throw httpErr(400, "سطر أمر الشراء غير صالح");
        }
        const remaining = Number(poLine.quantity) - Number(poLine.receivedQty);
        if (ln.quantity > remaining + 0.0001) {
          throw httpErr(
            409,
            `الكمية المستلمة (${ln.quantity}) تتجاوز المتبقي على السطر (${remaining}).`,
          );
        }
        if (!poLine.productId) {
          throw httpErr(400, "لا يمكن استلام سطر بدون منتج مرتبط.");
        }
        const unitCost = Number(poLine.unitPrice);
        await tx.insert(goodsReceiptLinesTable).values({
          grnId: grn.id,
          poLineId: poLine.id,
          productId: poLine.productId,
          quantity: String(ln.quantity),
          unitCost: String(unitCost),
        });
        await tx
          .update(purchaseOrderLinesTable)
          .set({ receivedQty: sql`${purchaseOrderLinesTable.receivedQty} + ${ln.quantity}` })
          .where(eq(purchaseOrderLinesTable.id, poLine.id));

        // Resolve lot for lot-tracked products if a lotNumber was scanned.
        let lotId: number | undefined;
        if (ln.lotNumber) {
          lotId = await getOrCreateLot(
            tx,
            poLine.productId,
            ln.lotNumber,
            ln.expiryDate ?? null,
            po.reference,
          );
        }
        await recordStockMove(tx, {
          productId: poLine.productId,
          quantity: ln.quantity,
          unitCost,
          kind: "receipt",
          toWarehouseId: warehouseId,
          sourceType: "goods_receipt",
          sourceId: grn.id,
          sourceRef: grn.reference,
          createdBy: req.session?.userId ?? null,
          notes: ln.barcode
            ? `استلام بضاعة على أمر الشراء ${po.reference} (Barcode: ${ln.barcode})`
            : `استلام بضاعة على أمر الشراء ${po.reference}`,
          lotId,
          serialId: ln.serialId,
          // We post our own balanced GR-IR journal below.
          skipJournal: true,
        });
        totalValue += ln.quantity * unitCost;
      }

      // Update PO header status.
      const linesAfter = await tx
        .select({
          q: purchaseOrderLinesTable.quantity,
          r: purchaseOrderLinesTable.receivedQty,
        })
        .from(purchaseOrderLinesTable)
        .where(eq(purchaseOrderLinesTable.poId, po.id));
      const totalQ = linesAfter.reduce((s, l) => s + Number(l.q), 0);
      const totalR = linesAfter.reduce((s, l) => s + Number(l.r), 0);
      const newStatus = totalR <= 0 ? po.status
        : totalR + 0.0001 >= totalQ ? "fully_received" : "partially_received";
      await tx.update(purchaseOrdersTable).set({ status: newStatus }).where(eq(purchaseOrdersTable.id, po.id));

      // Post Dr Inventory / Cr GR-IR for the receipt value.
      let journalEntryId: number | null = null;
      if (totalValue > 0) {
        const result = await postJournalEntry(
          tx,
          {
            entryDate: new Date(),
            description: `استلام بضاعة — ${po.reference}`,
            reference: grn.reference,
            source: "system",
            sourceRef: `GRN-${grn.id}`,
            createdBy: req.session?.userId ?? null,
            status: "posted",
          },
          [
            { systemKey: "inventory", debit: totalValue, description: "استلام بضاعة" },
            { systemKey: "gr_ir", credit: totalValue, description: po.supplierName },
          ],
        );
        journalEntryId = result.id;
      }
      return { grn, journalEntryId, totalValue };
    });
    void recordAudit(req, {
      action: "create", entity: "goods_receipt",
      details: `${out.grn.reference} بقيمة ${out.totalValue.toFixed(2)}`,
    });
    res.status(201).json({ ...out.grn, receivedAt: out.grn.receivedAt.toISOString(), journalEntryId: out.journalEntryId }); return;
  } catch (err) {
    req.log.error({ err }, "create GRN failed");
    respondError(res, err); return;
  }
});

router.get("/procurement/goods-receipts", async (req, res) => {
  try {
    const poId = req.query.poId ? Number(req.query.poId) : undefined;
    const rows = await db
      .select({
        id: goodsReceiptsTable.id,
        reference: goodsReceiptsTable.reference,
        poId: goodsReceiptsTable.poId,
        warehouseId: goodsReceiptsTable.warehouseId,
        receivedAt: goodsReceiptsTable.receivedAt,
        notes: goodsReceiptsTable.notes,
        poReference: purchaseOrdersTable.reference,
        supplierName: purchaseOrdersTable.supplierName,
      })
      .from(goodsReceiptsTable)
      .leftJoin(purchaseOrdersTable, eq(goodsReceiptsTable.poId, purchaseOrdersTable.id))
      .where(poId ? eq(goodsReceiptsTable.poId, poId) : undefined)
      .orderBy(desc(goodsReceiptsTable.receivedAt));
    res.json(rows.map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "list GRNs failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// 3-WAY MATCHING — Validate an invoice draft against PO + GRN
// =========================================================================
const MatchBody = z.object({
  poId: z.coerce.number().int().positive(),
  lines: z.array(z.object({
    poLineId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0),
  })).min(1),
});

router.post("/procurement/match", async (req, res) => {
  let body: z.infer<typeof MatchBody>;
  try {
    body = MatchBody.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: "بيانات غير صالحة", details: err.issues }); return; }
    res.status(400).json({ error: "Bad request" }); return;
  }
  try {
    const issues: string[] = [];
    const ok: Array<{ poLineId: number; status: "ok" | "warn" | "fail"; reason?: string }> = [];
    const poLines = await db
      .select()
      .from(purchaseOrderLinesTable)
      .where(eq(purchaseOrderLinesTable.poId, body.poId));
    const byId = new Map(poLines.map((l) => [l.id, l]));

    for (const ln of body.lines) {
      const pol = byId.get(ln.poLineId);
      if (!pol) {
        issues.push(`السطر ${ln.poLineId} لا ينتمي لأمر الشراء.`);
        ok.push({ poLineId: ln.poLineId, status: "fail", reason: "Line not found" });
        continue;
      }
      const expectedPrice = Number(pol.unitPrice);
      const tolerance = expectedPrice * (PO_INVOICE_PRICE_TOLERANCE_PCT / 100);
      const priceDiff = Math.abs(ln.unitPrice - expectedPrice);
      const billable = Number(pol.receivedQty) - Number(pol.billedQty);
      let status: "ok" | "warn" | "fail" = "ok";
      let reason: string | undefined;
      if (ln.quantity > billable + 0.0001) {
        status = "fail";
        reason = `الكمية ${ln.quantity} تتجاوز ما يمكن فوترته (${billable}).`;
        issues.push(reason);
      } else if (priceDiff > tolerance) {
        status = "warn";
        reason = `سعر الفاتورة ${ln.unitPrice} يخرج عن نطاق التسامح ±${PO_INVOICE_PRICE_TOLERANCE_PCT}% (المتوقع ${expectedPrice}).`;
        issues.push(reason);
      }
      ok.push({ poLineId: pol.id, status, reason });
    }
    res.json({
      matched: issues.length === 0,
      tolerancePct: PO_INVOICE_PRICE_TOLERANCE_PCT,
      lines: ok,
      issues,
    });
  } catch (err) {
    req.log.error({ err }, "match failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// AP AGING REPORT
// =========================================================================
router.get("/procurement/ap-aging", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT s.id           AS supplier_id,
             s.name         AS supplier_name,
             s.payment_terms_days::int AS payment_terms_days,
             COALESCE(SUM(CASE WHEN i.due_date IS NULL OR i.due_date >= now()
                               THEN i.amount ELSE 0 END), 0)::float8 AS current_due,
             COALESCE(SUM(CASE WHEN i.due_date < now() AND i.due_date >= now() - interval '30 days'
                               THEN i.amount ELSE 0 END), 0)::float8 AS days_1_30,
             COALESCE(SUM(CASE WHEN i.due_date < now() - interval '30 days'
                                AND i.due_date >= now() - interval '60 days'
                               THEN i.amount ELSE 0 END), 0)::float8 AS days_31_60,
             COALESCE(SUM(CASE WHEN i.due_date < now() - interval '60 days'
                                AND i.due_date >= now() - interval '90 days'
                               THEN i.amount ELSE 0 END), 0)::float8 AS days_61_90,
             COALESCE(SUM(CASE WHEN i.due_date < now() - interval '90 days'
                               THEN i.amount ELSE 0 END), 0)::float8 AS days_over_90,
             COALESCE(SUM(i.amount), 0)::float8 AS total_outstanding
        FROM suppliers s
        LEFT JOIN invoices i
          ON i.supplier_id = s.id
         -- Aging only counts open AP: exclude failed and paid invoices
         -- so that executing a payment run actually clears the buckets.
         AND i.status NOT IN ('failed', 'paid')
       GROUP BY s.id
      HAVING COALESCE(SUM(i.amount), 0) > 0
       ORDER BY total_outstanding DESC
    `);
    const rows = rowsOf<{
      supplier_id: number; supplier_name: string; payment_terms_days: number;
      current_due: number; days_1_30: number; days_31_60: number; days_61_90: number;
      days_over_90: number; total_outstanding: number;
    }>(result);
    res.json(rows.map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      paymentTermsDays: Number(r.payment_terms_days ?? 30),
      currentDue: Number(r.current_due),
      days1To30: Number(r.days_1_30),
      days31To60: Number(r.days_31_60),
      days61To90: Number(r.days_61_90),
      daysOver90: Number(r.days_over_90),
      totalOutstanding: Number(r.total_outstanding),
    })));
  } catch (err) {
    req.log.error({ err }, "AP aging failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// PAYMENT RUNS
// =========================================================================
// Each payment-run line MUST reference a specific open AP invoice. This
// keeps the supplier ledger and AP aging consistent: executing a run
// marks exactly those invoices paid and decrements the supplier balance
// by the same amount.
const PaymentLineInput = z.object({
  supplierId: z.coerce.number().int().positive(),
  invoiceId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
});
const CreatePaymentRunBody = z.object({
  paymentDate: z.string().optional(),
  paymentMethod: z.enum(["cash", "bank"]).default("bank"),
  bankAccountId: z.coerce.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(PaymentLineInput).min(1),
});

router.get("/procurement/payment-runs", financeGuard, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(paymentRunsTable)
      .orderBy(desc(paymentRunsTable.createdAt));
    res.json(rows.map((r) => ({
      ...r,
      totalAmount: Number(r.totalAmount),
      executedAt: r.executedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "list payment runs failed");
    respondError(res, err); return;
  }
});

router.post(
  "/procurement/payment-runs",
  financeGuard,
  // Pre-flight financial-limit cap per role for AP payment runs. The
  // workflow tab exposes this as `ap.payment_amount`. Value = sum of body
  // line amounts; admins with no cap configured are unaffected.
  requireFinancialLimit("ap.payment_amount", (req) => {
    const lines = (req.body?.lines ?? []) as Array<{ amount?: number }>;
    return lines.reduce((s, l) => s + Number(l.amount ?? 0), 0);
  }),
  async (req, res) => {
  let body: z.infer<typeof CreatePaymentRunBody>;
  try {
    body = CreatePaymentRunBody.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: "بيانات غير صالحة", details: err.issues }); return; }
    res.status(400).json({ error: "Bad request" }); return;
  }
  try {
    const out = await db.transaction(async (tx) => {
      // Validate every payment line: the invoice must exist, belong to
      // the indicated supplier, still be open (not paid/failed), and the
      // amount must not exceed the invoice total. This enforces the
      // explicit-invoice-selection requirement and keeps AP aging
      // consistent after execute.
      const invIds = body.lines.map((l) => l.invoiceId);
      const invs = await tx.select().from(invoicesTable).where(inArray(invoicesTable.id, invIds));
      const invById = new Map(invs.map((i) => [i.id, i]));
      // Reject any invoice already attached to another (draft or executed)
      // payment run. This prevents the same invoice from being paid twice
      // across runs.
      const linked = await tx
        .select({ invoiceId: paymentRunLinesTable.invoiceId, status: paymentRunsTable.status })
        .from(paymentRunLinesTable)
        .leftJoin(paymentRunsTable, eq(paymentRunsTable.id, paymentRunLinesTable.runId))
        .where(
          and(
            inArray(paymentRunLinesTable.invoiceId, invIds),
            inArray(paymentRunsTable.status, ["draft", "executed"]),
          ),
        );
      const linkedSet = new Set(
        linked.map((l) => l.invoiceId).filter((x): x is number => x != null),
      );
      // Aggregate to catch the same invoice being targeted twice in one run.
      const sumByInvoice = new Map<number, number>();
      for (const ln of body.lines) {
        const inv = invById.get(ln.invoiceId);
        if (!inv) throw httpErr(404, `الفاتورة #${ln.invoiceId} غير موجودة.`);
        if (inv.supplierId !== ln.supplierId) {
          throw httpErr(409, `الفاتورة #${ln.invoiceId} لا تعود إلى المورد المحدد.`);
        }
        if (inv.status === "paid" || inv.status === "failed") {
          throw httpErr(409, `الفاتورة #${ln.invoiceId} ليست مفتوحة (الحالة: ${inv.status}).`);
        }
        if (linkedSet.has(ln.invoiceId)) {
          throw httpErr(409, `الفاتورة #${ln.invoiceId} مرتبطة بدفعة أخرى بالفعل.`);
        }
        sumByInvoice.set(ln.invoiceId, (sumByInvoice.get(ln.invoiceId) ?? 0) + ln.amount);
      }
      // Settlement model: payment-run lines must FULLY settle the
      // invoice. We don't yet track partial paid_amount on invoices, and
      // the executor unconditionally marks linked invoices "paid", so
      // accepting partial amounts here would leave the ledger
      // inconsistent. Enforce equality (within rounding tolerance).
      for (const [invId, paid] of sumByInvoice) {
        const inv = invById.get(invId)!;
        const due = Number(inv.amount);
        if (Math.abs(paid - due) > 0.01) {
          throw httpErr(
            409,
            `مبلغ الدفع للفاتورة #${invId} يجب أن يساوي رصيدها بالكامل (${due}). تم إدخال ${paid}.`,
          );
        }
      }

      const total = body.lines.reduce((s, l) => s + l.amount, 0);
      const reference = await nextSeq("PMT", new Date().getUTCFullYear());
      const [run] = await tx
        .insert(paymentRunsTable)
        .values({
          reference,
          paymentDate: body.paymentDate ?? new Date().toISOString().slice(0, 10),
          paymentMethod: body.paymentMethod,
          bankAccountId: body.bankAccountId ?? null,
          totalAmount: total.toFixed(2),
          status: "draft",
          notes: body.notes ?? null,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      for (const ln of body.lines) {
        await tx.insert(paymentRunLinesTable).values({
          runId: run.id,
          supplierId: ln.supplierId,
          invoiceId: ln.invoiceId,
          amount: ln.amount.toFixed(2),
        });
      }
      return run;
    });
    void recordAudit(req, { action: "create", entity: "payment_run", details: out.reference });
    res.status(201).json(out); return;
  } catch (err) {
    req.log.error({ err }, "create payment run failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/payment-runs/:id/execute", financeGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    // Strict gate: only a "draft" run may be acted on from this route.
    //   * draft → submit to workflow engine; if a rule matches the run is
    //     locked into "pending_approval" and 202 is returned. The
    //     onApprove("payment_run") handler is the ONLY caller allowed to
    //     finalize a pending_approval run (it invokes the helper with no
    //     status check bypass — the helper itself enforces the same
    //     "draft|pending_approval" precondition).
    //   * pending_approval → reject the manual call (would otherwise let
    //     a finance user execute without waiting for the chain).
    //   * executed/cancelled → 409.
    const [pre] = await db.select().from(paymentRunsTable).where(eq(paymentRunsTable.id, id));
    if (!pre) { res.status(404).json({ error: "not found" }); return; }
    if (pre.status === "pending_approval") {
      res.status(202).json({
        ok: false,
        pendingApproval: true,
        message: "تنفيذ الدفعة بانتظار الاعتماد — لا يمكن التنفيذ يدوياً قبل اكتمال سلسلة الاعتماد.",
      });
      return;
    }
    if (pre.status !== "draft") {
      res.status(409).json({ error: `حالة الدفعة (${pre.status}) لا تسمح بالتنفيذ.` });
      return;
    }
    const submission = await submitForApproval({
      docType: "payment_run",
      recordId: id,
      recordRef: pre.reference,
      amount: Number(pre.totalAmount),
      submittedByUserId: req.session?.userId ?? null,
      submittedByName: (req.session as { userName?: string } | undefined)?.userName ?? null,
    });
    if (submission.required) {
      await db
        .update(paymentRunsTable)
        .set({ status: "pending_approval" })
        .where(eq(paymentRunsTable.id, id));
      res.status(202).json({
        ok: false,
        pendingApproval: true,
        approvalRequestId: submission.requestId,
        message: "تنفيذ الدفعة بانتظار الاعتماد",
      });
      return;
    }
    // No rule matched → finalize inline. Delegated to the shared helper
    // so /execute and the workflow-engine onApprove path always run
    // identical logic.
    const result = await finalizePaymentRunExecute(id, req.session?.userId ?? null);
    void recordAudit(req, {
      action: "execute", entity: "payment_run",
      details: `JE#${result.journalEntryId} بإجمالي ${result.total.toFixed(2)}`,
      severity: "warning",
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err }, "execute payment run failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// BLANKET AGREEMENTS
// =========================================================================
const BlanketItemInput = z.object({
  productId: z.coerce.number().int().positive(),
  agreedPrice: z.coerce.number().min(0),
  agreedQty: z.coerce.number().positive(),
});
const CreateBlanketBody = z.object({
  supplierId: z.coerce.number().int().positive(),
  startDate: z.string(),
  endDate: z.string(),
  notes: z.string().nullable().optional(),
  items: z.array(BlanketItemInput).min(1),
});

router.get("/procurement/agreements", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: blanketAgreementsTable.id,
        reference: blanketAgreementsTable.reference,
        supplierId: blanketAgreementsTable.supplierId,
        supplierName: suppliersTable.name,
        startDate: blanketAgreementsTable.startDate,
        endDate: blanketAgreementsTable.endDate,
        totalCommittedValue: blanketAgreementsTable.totalCommittedValue,
        releasedValue: blanketAgreementsTable.releasedValue,
        status: blanketAgreementsTable.status,
        notes: blanketAgreementsTable.notes,
      })
      .from(blanketAgreementsTable)
      .leftJoin(suppliersTable, eq(blanketAgreementsTable.supplierId, suppliersTable.id))
      .orderBy(desc(blanketAgreementsTable.id));
    res.json(rows.map((r) => ({
      ...r,
      totalCommittedValue: Number(r.totalCommittedValue),
      releasedValue: Number(r.releasedValue),
    })));
  } catch (err) {
    req.log.error({ err }, "list agreements failed");
    respondError(res, err); return;
  }
});

router.post("/procurement/agreements", async (req, res) => {
  let body: z.infer<typeof CreateBlanketBody>;
  try {
    body = CreateBlanketBody.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ error: "بيانات غير صالحة", details: err.issues }); return; }
    res.status(400).json({ error: "Bad request" }); return;
  }
  try {
    const out = await db.transaction(async (tx) => {
      const total = body.items.reduce((s, i) => s + i.agreedPrice * i.agreedQty, 0);
      const reference = await nextSeq("BPA", new Date().getUTCFullYear());
      const [ag] = await tx
        .insert(blanketAgreementsTable)
        .values({
          reference,
          supplierId: body.supplierId,
          startDate: body.startDate,
          endDate: body.endDate,
          totalCommittedValue: total.toFixed(2),
          notes: body.notes ?? null,
          status: "active",
        })
        .returning();
      for (const it of body.items) {
        await tx.insert(blanketAgreementItemsTable).values({
          agreementId: ag.id,
          productId: it.productId,
          agreedPrice: String(it.agreedPrice),
          agreedQty: String(it.agreedQty),
        });
      }
      return ag;
    });
    void recordAudit(req, { action: "create", entity: "blanket_agreement", details: out.reference });
    res.status(201).json(out); return;
  } catch (err) {
    req.log.error({ err }, "create agreement failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// Open AP invoices — drives the payment-run dialog
// =========================================================================
router.get("/procurement/open-invoices", async (req, res) => {
  try {
    const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
    const conds = [
      sql`${invoicesTable.status} NOT IN ('paid','failed')`,
      sql`${invoicesTable.supplierId} IS NOT NULL`,
      // Exclude invoices already attached to any draft/executed payment-run line
      // so the picker can't propose double-paying the same invoice.
      sql`${invoicesTable.id} NOT IN (
        SELECT prl.invoice_id FROM payment_run_lines prl
        JOIN payment_runs pr ON pr.id = prl.run_id
        WHERE prl.invoice_id IS NOT NULL AND pr.status IN ('draft','executed')
      )`,
    ];
    if (supplierId) conds.push(eq(invoicesTable.supplierId, supplierId));
    const rows = await db
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        supplierId: invoicesTable.supplierId,
        supplierName: invoicesTable.supplierName,
        amount: invoicesTable.amount,
        dueDate: invoicesTable.dueDate,
        status: invoicesTable.status,
      })
      .from(invoicesTable)
      .where(and(...conds))
      .orderBy(desc(invoicesTable.dueDate));
    res.json(rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
    })));
  } catch (err) {
    req.log.error({ err }, "list open invoices failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// SUGGESTIONS for AI scanner — find candidate POs to auto-link an invoice
// =========================================================================
router.get("/procurement/po-suggestions", async (req, res) => {
  try {
    let supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
    const supplierName = (req.query.supplierName as string | undefined)?.trim();
    const amount = req.query.amount ? Number(req.query.amount) : undefined;

    // Allow callers (e.g. the AI scanner UI) to pass a supplier name; we
    // resolve it to one or more supplier ids via case-insensitive match.
    if (!supplierId && supplierName) {
      const matches = await db
        .select({ id: suppliersTable.id })
        .from(suppliersTable)
        .where(sql`lower(${suppliersTable.name}) LIKE ${`%${supplierName.toLowerCase()}%`}`);
      if (matches.length === 0) { res.json([]); return; }
      // Take the first match for ranking; the result still includes
      // supplierId/supplierName so the UI can render which supplier the
      // PO belongs to.
      supplierId = matches[0].id;
    }
    if (!supplierId) { res.json([]); return; }
    const rows = await db
      .select()
      .from(purchaseOrdersTable)
      .where(
        and(
          eq(purchaseOrdersTable.supplierId, supplierId),
          inArray(purchaseOrdersTable.status, ["confirmed", "partially_received", "fully_received"]),
        ),
      )
      .orderBy(desc(purchaseOrdersTable.orderDate));
    const ranked = rows.map((r) => {
      const total = Number(r.total);
      const distance = amount != null ? Math.abs(total - amount) / Math.max(total, 1) : 1;
      return {
        id: r.id,
        reference: r.reference,
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        orderDate: r.orderDate,
        total,
        status: r.status,
        confidence: Number((1 - Math.min(distance, 1)).toFixed(2)),
      };
    }).sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    res.json(ranked);
  } catch (err) {
    req.log.error({ err }, "PO suggestions failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// SUPPLIER LEDGER — chronological AP movements (invoices in / payments out)
// =========================================================================
router.get("/procurement/supplier-ledger", async (req, res) => {
  try {
    const supplierId = req.query.supplierId ? Number(req.query.supplierId) : null;
    if (!supplierId) { res.status(400).json({ error: "supplierId is required" }); return; }
    const [supplier] = await db
      .select()
      .from(suppliersTable)
      .where(eq(suppliersTable.id, supplierId));
    if (!supplier) { res.status(404).json({ error: "not found" }); return; }
    const invs = await db
      .select({
        id: invoicesTable.id,
        date: invoicesTable.invoiceDate,
        ref: invoicesTable.invoiceNumber,
        amount: invoicesTable.amount,
        status: invoicesTable.status,
      })
      .from(invoicesTable)
      .where(eq(invoicesTable.supplierId, supplierId));
    const pays = await db
      .select({
        id: paymentRunLinesTable.id,
        runId: paymentRunLinesTable.runId,
        amount: paymentRunLinesTable.amount,
        invoiceId: paymentRunLinesTable.invoiceId,
        runStatus: paymentRunsTable.status,
        runRef: paymentRunsTable.reference,
        runDate: paymentRunsTable.paymentDate,
      })
      .from(paymentRunLinesTable)
      .leftJoin(paymentRunsTable, eq(paymentRunsTable.id, paymentRunLinesTable.runId))
      .where(eq(paymentRunLinesTable.supplierId, supplierId));
    const entries = [
      ...invs.map((i) => ({
        kind: "invoice" as const,
        date: i.date ? (typeof i.date === "string" ? i.date : i.date.toISOString().slice(0, 10)) : null,
        reference: i.ref,
        debit: 0,
        credit: Number(i.amount),
        status: i.status,
        sourceId: i.id,
      })),
      ...pays
        .filter((p) => p.runStatus === "executed")
        .map((p) => ({
          kind: "payment" as const,
          date: p.runDate,
          reference: p.runRef ?? `PMT#${p.runId}`,
          debit: Number(p.amount),
          credit: 0,
          status: p.runStatus,
          sourceId: p.runId,
        })),
    ].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
    let running = 0;
    const ledger = entries.map((e) => {
      running += e.credit - e.debit;
      return { ...e, runningBalance: Number(running.toFixed(2)) };
    });
    res.json({
      supplier: { id: supplier.id, name: supplier.name, balance: Number(supplier.balance) },
      entries: ledger,
    });
  } catch (err) {
    req.log.error({ err }, "supplier ledger failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// REPORTS
// =========================================================================
router.get("/procurement/reports/top-suppliers", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 10), 50);
    const rows = await db
      .select({
        supplierId: purchaseOrdersTable.supplierId,
        supplierName: purchaseOrdersTable.supplierName,
        spend: sql<number>`COALESCE(SUM(${purchaseOrdersTable.total}), 0)`,
        orders: sql<number>`COUNT(*)`,
      })
      .from(purchaseOrdersTable)
      .where(inArray(purchaseOrdersTable.status, ["confirmed", "partially_received", "fully_received", "closed"]))
      .groupBy(purchaseOrdersTable.supplierId, purchaseOrdersTable.supplierName)
      .orderBy(sql`COALESCE(SUM(${purchaseOrdersTable.total}), 0) DESC`)
      .limit(limit);
    res.json(rows.map((r) => ({ ...r, spend: Number(r.spend), orders: Number(r.orders) })));
  } catch (err) {
    req.log.error({ err }, "top suppliers report failed");
    respondError(res, err); return;
  }
});

router.get("/procurement/reports/open-pos-by-supplier", async (req, res) => {
  try {
    const rows = await db
      .select({
        supplierId: purchaseOrdersTable.supplierId,
        supplierName: purchaseOrdersTable.supplierName,
        openCount: sql<number>`COUNT(*)`,
        openValue: sql<number>`COALESCE(SUM(${purchaseOrdersTable.total}), 0)`,
      })
      .from(purchaseOrdersTable)
      .where(inArray(purchaseOrdersTable.status, ["confirmed", "partially_received"]))
      .groupBy(purchaseOrdersTable.supplierId, purchaseOrdersTable.supplierName)
      .orderBy(sql`COALESCE(SUM(${purchaseOrdersTable.total}), 0) DESC`);
    res.json(rows.map((r) => ({
      ...r,
      openCount: Number(r.openCount),
      openValue: Number(r.openValue),
    })));
  } catch (err) {
    req.log.error({ err }, "open POs by supplier failed");
    respondError(res, err); return;
  }
});

router.get("/procurement/reports/payment-forecast", async (req, res) => {
  try {
    // Bucket open AP invoices by week-of-due-date for the next 12 weeks.
    // Past-due invoices fall into the "overdue" bucket.
    const rows = await db
      .select({
        id: invoicesTable.id,
        amount: invoicesTable.amount,
        dueDate: invoicesTable.dueDate,
        supplierName: invoicesTable.supplierName,
      })
      .from(invoicesTable)
      .where(
        and(
          sql`${invoicesTable.status} NOT IN ('paid','failed')`,
          sql`${invoicesTable.supplierId} IS NOT NULL`,
        ),
      );
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const buckets: Record<string, { label: string; total: number; count: number }> = {
      overdue: { label: "متأخر", total: 0, count: 0 },
    };
    for (let w = 0; w < 12; w++) {
      buckets[`w${w}`] = {
        label: `أسبوع +${w}`,
        total: 0,
        count: 0,
      };
    }
    for (const r of rows) {
      const amt = Number(r.amount);
      if (!r.dueDate) {
        buckets.overdue.total += amt;
        buckets.overdue.count += 1;
        continue;
      }
      const due = new Date(r.dueDate);
      due.setUTCHours(0, 0, 0, 0);
      const diffDays = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
      if (diffDays < 0) {
        buckets.overdue.total += amt;
        buckets.overdue.count += 1;
      } else {
        const wk = Math.min(Math.floor(diffDays / 7), 11);
        buckets[`w${wk}`].total += amt;
        buckets[`w${wk}`].count += 1;
      }
    }
    res.json(
      Object.entries(buckets).map(([key, b]) => ({
        bucket: key,
        label: b.label,
        total: Number(b.total.toFixed(2)),
        count: b.count,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "payment forecast failed");
    respondError(res, err); return;
  }
});

router.get("/procurement/reports/grn-vs-invoice-gap", async (req, res) => {
  try {
    // Per PO line: received_qty * unit_price (goods received value) vs
    // billed_qty * unit_price (invoiced value). Gap = received - billed.
    const rows = await db
      .select({
        poId: purchaseOrdersTable.id,
        reference: purchaseOrdersTable.reference,
        supplierName: purchaseOrdersTable.supplierName,
        receivedValue: sql<number>`COALESCE(SUM(${purchaseOrderLinesTable.receivedQty} * ${purchaseOrderLinesTable.unitPrice}), 0)`,
        billedValue: sql<number>`COALESCE(SUM(${purchaseOrderLinesTable.billedQty} * ${purchaseOrderLinesTable.unitPrice}), 0)`,
      })
      .from(purchaseOrdersTable)
      .leftJoin(purchaseOrderLinesTable, eq(purchaseOrderLinesTable.poId, purchaseOrdersTable.id))
      .where(inArray(purchaseOrdersTable.status, ["confirmed", "partially_received", "fully_received"]))
      .groupBy(purchaseOrdersTable.id, purchaseOrdersTable.reference, purchaseOrdersTable.supplierName);
    const out = rows
      .map((r) => ({
        ...r,
        receivedValue: Number(r.receivedValue),
        billedValue: Number(r.billedValue),
        gap: Number(r.receivedValue) - Number(r.billedValue),
      }))
      .filter((r) => Math.abs(r.gap) > 0.01)
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "grn vs invoice gap failed");
    respondError(res, err); return;
  }
});

// =========================================================================
// STATS — top of /procurement page
// =========================================================================
router.get("/procurement/stats", async (req, res) => {
  try {
    const [stats] = await db
      .select({
        openPOs: sql<number>`count(*) FILTER (WHERE ${purchaseOrdersTable.status} IN ('draft','confirmed','partially_received'))`,
        awaitingApproval: sql<number>`count(*) FILTER (WHERE ${purchaseOrdersTable.status} = 'draft' AND ${purchaseOrdersTable.requiresApproval} = true AND ${purchaseOrdersTable.approvedAt} IS NULL)`,
        committedValue: sql<number>`COALESCE(SUM(${purchaseOrdersTable.total}) FILTER (WHERE ${purchaseOrdersTable.status} IN ('confirmed','partially_received')), 0)`,
      })
      .from(purchaseOrdersTable);
    const [ap] = await db
      .select({ totalAp: sql<number>`COALESCE(SUM(balance), 0)` })
      .from(suppliersTable);
    res.json({
      openPOs: Number(stats.openPOs),
      awaitingApproval: Number(stats.awaitingApproval),
      committedValue: Number(stats.committedValue),
      totalAp: Number(ap.totalAp),
      approvalThreshold: PO_APPROVAL_THRESHOLD,
      priceTolerancePct: PO_INVOICE_PRICE_TOLERANCE_PCT,
    });
  } catch (err) {
    req.log.error({ err }, "stats failed");
    respondError(res, err); return;
  }
});

export default router;
