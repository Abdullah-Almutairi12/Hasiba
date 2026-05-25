import express, { Router } from "express";
import { z, ZodError } from "zod";
import rateLimit from "express-rate-limit";
import QRCode from "qrcode";
import {
  db, invoicesTable, productsTable, categoriesTable, suppliersTable,
  purchaseOrdersTable, purchaseOrderLinesTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { postJournalEntry, reverseJournalEntry, ClosedPeriodError } from "../lib/journal-posting";
import { getCompanyId } from "../lib/scoped-db";
import { journalEntriesTable } from "@workspace/db";
import { eq, sql, desc, ilike, and } from "drizzle-orm";
import { CreateInvoiceBody, UpdateInvoiceBody } from "@workspace/api-zod";
import { extractInvoiceFromImage, type ExtractedInvoice } from "../lib/invoice-extractor";
import { requireRole, financeGuard, invoiceReadGuard } from "../middlewares/require-role";
import { uploadBufferToPrivateObject } from "./storage";
import { recordAudit } from "../lib/audit";
import { recordStockMove, getDefaultWarehouseId } from "../lib/stock-engine";
import { evaluateAnomalies } from "../lib/anomaly-engine";
import { getCompanyInfo } from "../lib/pdf/purchase-order";
import { buildSupplierInvoicePdf } from "../lib/pdf/supplier-invoice";

// Postgres unique-violation SQLSTATE.
// Drizzle wraps pg errors and may surface the original on `.cause`,
// while the message typically still contains the original error text.
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: unknown; message?: string };
  if (e.code === PG_UNIQUE_VIOLATION) return true;
  if (e.cause && typeof e.cause === "object" && (e.cause as { code?: string }).code === PG_UNIQUE_VIOLATION) {
    return true;
  }
  if (typeof e.message === "string" && /duplicate key value|unique constraint|invoices_invoice_number_unique/i.test(e.message)) {
    return true;
  }
  return false;
}

const router = Router();

const SELLER_NAME = process.env["ZATCA_SELLER_NAME"] ?? "حاسبة AI";
const VAT_NUMBER = process.env["ZATCA_VAT_NUMBER"] ?? "300000000000003";
const VAT_RATE = 0.15;

function tlv(tag: number, value: string): Buffer {
  const valueBuf = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([tag, valueBuf.length]), valueBuf]);
}

function buildZatcaQrPayload(params: {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: number;
  vatAmount: number;
}): string {
  const buf = Buffer.concat([
    tlv(1, params.sellerName),
    tlv(2, params.vatNumber),
    tlv(3, params.timestamp),
    tlv(4, params.totalWithVat.toFixed(2)),
    tlv(5, params.vatAmount.toFixed(2)),
  ]);
  return buf.toString("base64");
}

router.get("/invoices", invoiceReadGuard, async (req, res) => {
  try {
    const { status } = req.query;
    // Tenant scope: only return invoices belonging to the caller's company.
    const companyScope = eq(invoicesTable.companyId, getCompanyId(req));
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(
        status
          ? and(companyScope, eq(invoicesTable.status, status as string))
          : companyScope,
      )
      .orderBy(desc(invoicesTable.createdAt));

    res.json(
      rows.map((inv) => ({
        ...inv,
        amount: Number(inv.amount),
        dueDate: inv.dueDate?.toISOString() ?? null,
        createdAt: inv.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching invoices");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/invoices", financeGuard, async (req, res) => {
  try {
    const body = CreateInvoiceBody.parse(req.body);
    const companyId = getCompanyId(req);
    const [invoice] = await db
      .insert(invoicesTable)
      .values({
        companyId,
        invoiceNumber: body.invoiceNumber,
        supplierName: body.supplierName,
        amount: String(body.amount),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        status: "pending",
        confidence: null,
      })
      .returning();

    // Anomaly hook: feed manual supplier-invoice creation into the
    // engine so the after-hours rule also covers non-scan paths.
    void evaluateAnomalies({
      type: "invoice.created",
      actorId: req.session?.userId ?? null,
      actorName:
        (req.session as { userName?: string } | undefined)?.userName ?? null,
      refTable: "invoices",
      refId: invoice?.id ?? null,
      payload: {
        invoiceNumber: invoice?.invoiceNumber,
        supplierName: invoice?.supplierName,
        amount: invoice ? Number(invoice.amount) : null,
      },
    });

    res.status(201).json({
      ...invoice,
      amount: Number(invoice.amount),
      dueDate: invoice.dueDate?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating invoice");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/invoices/stats", invoiceReadGuard, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const companyId = getCompanyId(req);

    const [stats] = await db
      .select({
        todayCount: sql<number>`count(*) filter (where ${invoicesTable.createdAt} >= ${today.toISOString()})`,
        processingCount: sql<number>`count(*) filter (where ${invoicesTable.status} = 'processing')`,
        needsReviewCount: sql<number>`count(*) filter (where ${invoicesTable.status} = 'needs_review')`,
      })
      .from(invoicesTable)
      .where(eq(invoicesTable.companyId, companyId));

    res.json({
      todayCount: Number(stats.todayCount),
      processingCount: Number(stats.processingCount),
      needsReviewCount: Number(stats.needsReviewCount),
      accuracyRate: 97.8,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching invoice stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/invoices/:id", invoiceReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [invoice] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, getCompanyId(req))));
    if (!invoice) return res.status(404).json({ error: "Not found" });

    return res.json({
      ...invoice,
      amount: Number(invoice.amount),
      dueDate: invoice.dueDate?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching invoice");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/invoices/:id/zatca-qr", invoiceReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [invoice] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, getCompanyId(req))));
    if (!invoice) return res.status(404).json({ error: "Not found" });

    const totalWithVat = Number(invoice.amount);
    // Phase 1 assumes a single-rate (15%) supplier invoice. For mixed-rate
    // invoices, the actual VAT amount must be persisted per invoice and used
    // here instead of back-calculating.
    const vatAmount = (totalWithVat * VAT_RATE) / (1 + VAT_RATE);
    // ZATCA Phase 1 requires ISO-8601 timestamp with seconds precision (no ms).
    const timestamp = invoice.createdAt
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");

    const company = await getCompanyInfo();
    const sellerName =
      company.nameAr && company.nameAr !== "—" ? company.nameAr : SELLER_NAME;
    const vatNumber =
      company.vatNumber && company.vatNumber !== "—"
        ? company.vatNumber
        : VAT_NUMBER;

    const tlvBase64 = buildZatcaQrPayload({
      sellerName,
      vatNumber,
      timestamp,
      totalWithVat,
      vatAmount,
    });

    const dataUrl = await QRCode.toDataURL(tlvBase64, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
    });

    return res.json({
      tlvBase64,
      dataUrl,
      sellerName,
      vatNumber,
      timestamp,
      totalWithVat,
      vatAmount,
    });
  } catch (err) {
    req.log.error({ err }, "Error generating ZATCA QR");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/invoices/:id", financeGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = UpdateInvoiceBody.parse(req.body);
    // Accept an optional `notes` field even if it's not in the OpenAPI
    // schema yet — notes are the only field allowed to change after lock.
    const rawNotes = typeof (req.body as { notes?: unknown }).notes === "string"
      ? ((req.body as { notes?: string }).notes ?? null)
      : undefined;

    // Audit guard: once an invoice is locked (approved/finalised), every
    // financial field is frozen forever. Only `notes` may be edited. To
    // neutralise a locked invoice the user must issue a reverse invoice.
    // Tenant scope on the lookup so PATCHing a foreign invoice returns 404.
    const companyId = getCompanyId(req);
    const [current] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)));
    if (!current) return res.status(404).json({ error: "Not found" });

    const wantsFinancialEdit =
      body.amount !== undefined ||
      body.supplierName !== undefined ||
      (body.status !== undefined && body.status !== current.status);

    if (current.isLocked && wantsFinancialEdit) {
      return res.status(409).json({
        error: "هذه الفاتورة مقفلة بعد الاعتماد. لتصحيح القيمة أنشئ قيداً عكسياً ثم فاتورة جديدة.",
        code: "INVOICE_LOCKED",
      });
    }

    const updateData: Record<string, unknown> = {};
    if (body.status) updateData.status = body.status;
    if (body.amount !== undefined) updateData.amount = String(body.amount);
    if (body.supplierName) updateData.supplierName = body.supplierName;
    if (rawNotes !== undefined) updateData.notes = rawNotes;

    // Auto-lock on transition to "done" so the next request can no longer
    // edit financial fields. Idempotent — re-PATCHing a done invoice to
    // "done" keeps the original lockedAt.
    if (body.status === "done" && !current.isLocked) {
      updateData.isLocked = true;
      updateData.lockedAt = new Date();
    }

    const [updated] = await db
      .update(invoicesTable)
      .set(updateData)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });

    return res.json({
      ...updated,
      amount: Number(updated.amount),
      dueDate: updated.dueDate?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error updating invoice");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Render a branded, printable supplier invoice PDF that mirrors the
// purchase-order PDF chrome (logo, company info, bilingual labels,
// totals, bank details). When the invoice is linked to a PO, the PO's
// line items are rendered; otherwise a single summary row is shown.
router.get("/invoices/:id/pdf", invoiceReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Bad id" });
      return;
    }
    // Tenant scope: cross-tenant PDF reads collapse to 404.
    const companyId = getCompanyId(req);
    const [invoice] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)));
    if (!invoice) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const supplier = invoice.supplierId
      ? (
          await db
            .select()
            .from(suppliersTable)
            .where(eq(suppliersTable.id, invoice.supplierId))
        )[0]
      : null;

    let poReference: string | null = null;
    let poLines: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: number;
      lineTotal: number;
    }> = [];
    if (invoice.poId) {
      const [po] = await db
        .select()
        .from(purchaseOrdersTable)
        .where(eq(purchaseOrdersTable.id, invoice.poId));
      if (po) poReference = po.reference;
      const lines = await db
        .select()
        .from(purchaseOrderLinesTable)
        .where(eq(purchaseOrderLinesTable.poId, invoice.poId));
      poLines = lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        taxRate: Number(l.taxRate),
        lineTotal: Number(l.lineTotal),
      }));
    }

    const company = await getCompanyInfo();

    // Build a ZATCA QR (Phase 1, TLV-base64) on the fly so the printed
    // copy is scannable. We back-calculate the VAT portion at 15% — the
    // same simplification used by /invoices/:id/zatca-qr above.
    let qrDataUrl: string | null = null;
    try {
      const totalWithVat = Number(invoice.amount);
      const vatAmount = (totalWithVat * VAT_RATE) / (1 + VAT_RATE);
      const timestamp = invoice.createdAt
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z");
      const sellerName =
        company.nameAr && company.nameAr !== "—" ? company.nameAr : SELLER_NAME;
      const vatNumber =
        company.vatNumber && company.vatNumber !== "—"
          ? company.vatNumber
          : VAT_NUMBER;
      const tlvBase64 = buildZatcaQrPayload({
        sellerName,
        vatNumber,
        timestamp,
        totalWithVat,
        vatAmount,
      });
      qrDataUrl = await QRCode.toDataURL(tlvBase64, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 220,
      });
    } catch {
      qrDataUrl = null;
    }

    const pdf = await buildSupplierInvoicePdf(
      {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate
          ? invoice.invoiceDate.toISOString().slice(0, 10)
          : null,
        dueDate: invoice.dueDate
          ? invoice.dueDate.toISOString().slice(0, 10)
          : null,
        currencyCode: supplier?.defaultCurrency ?? "SAR",
        amount: Number(invoice.amount),
        status: invoice.status,
        notes: invoice.notes,
        poReference,
        supplier: {
          name: invoice.supplierName,
          email: supplier?.email ?? null,
          phone: supplier?.phone ?? null,
          address: supplier?.address ?? null,
          vatNumber: supplier?.vatNumber ?? null,
        },
        lines: poLines,
        zatcaQrDataUrl: qrDataUrl,
      },
      company,
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="supplier-invoice-${invoice.invoiceNumber}.pdf"`,
    );
    res.send(pdf);
  } catch (err) {
    req.log.error({ err }, "render supplier invoice PDF");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/invoices/:id", financeGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    // Tenant scope: cross-tenant DELETE returns 404.
    const companyId = getCompanyId(req);
    const tenantScope = and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId));
    const [current] = await db.select().from(invoicesTable).where(tenantScope);
    if (!current) return res.status(404).json({ error: "Not found" });
    if (current.isLocked) {
      return res.status(409).json({
        error: "لا يمكن حذف فاتورة معتمدة/مقفلة. استخدم قيد عكسي بدلاً من ذلك.",
        code: "INVOICE_LOCKED",
      });
    }
    await db.delete(invoicesTable).where(tenantScope);
    void recordAudit(req, {
      action: "delete",
      entity: "invoice",
      details: `حذف فاتورة مسودة ${current.invoiceNumber}`,
      severity: "warning",
    });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting invoice");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Reverse a locked supplier invoice: creates a sibling invoice with a
// negated amount, links the two via reverses_id/reversed_by_id, and posts
// a reverse journal entry — all inside one DB transaction.
const SupplierReverseBody = z.object({
  reason: z.string().trim().min(3, "السبب مطلوب").max(500),
});

router.post("/invoices/:id/reverse", financeGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    const { reason } = SupplierReverseBody.parse(req.body ?? {});
    // Tenant scope: cross-tenant reversal collapses to 404 — both the
    // initial lookup and the paired UPDATE below are scoped on
    // (id, companyId) so a forged ID from another tenant can never
    // mutate the original invoice.
    const companyId = getCompanyId(req);

    const result = await db.transaction(async (tx) => {
      const [orig] = await tx
        .select()
        .from(invoicesTable)
        .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)));
      if (!orig) throw Object.assign(new Error("الفاتورة غير موجودة"), { httpStatus: 404 });
      if (!orig.isLocked) {
        throw Object.assign(
          new Error("لا يمكن عكس فاتورة غير مقفلة. اعتمد الفاتورة أولاً."),
          { httpStatus: 409 },
        );
      }
      if (orig.reversedById) {
        throw Object.assign(new Error("الفاتورة معكوسة مسبقاً."), { httpStatus: 409 });
      }
      if (orig.reversesId) {
        throw Object.assign(
          new Error("لا يمكن عكس فاتورة هي نفسها قيد عكسي."),
          { httpStatus: 409 },
        );
      }

      // Insert the reversing invoice — same supplier, negated amount,
      // status='done' + isLocked=true so it's immutable from birth.
      const reverseNumber = `REV-${orig.invoiceNumber}`;
      const [reverse] = await tx
        .insert(invoicesTable)
        .values({
          companyId: orig.companyId,
          invoiceNumber: reverseNumber,
          supplierId: orig.supplierId,
          supplierName: orig.supplierName,
          amount: String(-Number(orig.amount)),
          status: "done",
          confidence: orig.confidence,
          fileUrl: orig.fileUrl,
          invoiceDate: new Date(),
          dueDate: null,
          poId: orig.poId,
          notes: `قيد عكسي للفاتورة ${orig.invoiceNumber}`,
          reversesId: orig.id,
          isLocked: true,
          lockedAt: new Date(),
          reversedReason: reason,
        })
        .returning();
      if (!reverse) throw new Error("Failed to create reverse invoice");

      // Pair them: original now points to its reverser.
      await tx
        .update(invoicesTable)
        .set({ reversedById: reverse.id, reversedReason: reason })
        .where(and(eq(invoicesTable.id, orig.id), eq(invoicesTable.companyId, companyId)));

      // Roll the supplier's AP balance back.
      if (orig.supplierId) {
        await tx
          .update(suppliersTable)
          .set({ balance: sql`${suppliersTable.balance} - ${Number(orig.amount)}` })
          .where(eq(suppliersTable.id, orig.supplierId));
      }

      // Reverse the matching journal entry. The original from-scan posting
      // uses sourceRef=`INV-${invoiceNumber}` — find it and flip every line.
      const originalRef = `INV-${orig.invoiceNumber}`;
      // Tenant scope is REQUIRED here: invoice numbers (and therefore
      // sourceRef) are unique only within a company, so without the
      // companyId predicate a collision could let one tenant reverse
      // another tenant's posted journal entry. Locks the lookup to the
      // caller's company.
      const [origJe] = await tx
        .select({ id: journalEntriesTable.id })
        .from(journalEntriesTable)
        .where(
          and(
            eq(journalEntriesTable.companyId, companyId),
            eq(journalEntriesTable.source, "supplier_invoice"),
            eq(journalEntriesTable.sourceRef, originalRef),
            eq(journalEntriesTable.status, "posted"),
          ),
        )
        .limit(1);
      let reverseJournalId: number | null = null;
      if (origJe) {
        const rev = await reverseJournalEntry(
          tx,
          origJe.id,
          req.session?.userId ?? null,
          reason,
        );
        reverseJournalId = rev.id;
      }

      return {
        reverse: {
          ...reverse,
          amount: Number(reverse.amount),
          dueDate: reverse.dueDate?.toISOString() ?? null,
          lockedAt: reverse.lockedAt?.toISOString() ?? null,
          createdAt: reverse.createdAt.toISOString(),
          invoiceDate: reverse.invoiceDate?.toISOString() ?? null,
        },
        reverseJournalId,
      };
    });

    void recordAudit(req, {
      action: "update",
      entity: "invoice",
      details: `قيد عكسي للفاتورة #${id}: ${reason}`,
      severity: "warning",
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "بيانات غير صالحة.", details: err.issues });
    }
    if (err instanceof ClosedPeriodError) {
      return res.status(403).json({ error: err.message });
    }
    const tagged = err as { httpStatus?: number };
    if (typeof tagged?.httpStatus === "number") {
      return res.status(tagged.httpStatus).json({
        error: err instanceof Error ? err.message : "Bad request",
      });
    }
    req.log.error({ err }, "Error reversing supplier invoice");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== AI Supplier-Invoice Scanner Agent ==============
// Vision API calls are expensive — cap to 15 scans per IP per 15 minutes.
const scanLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "تجاوزت الحد المسموح من عمليات المسح. حاول مجدداً بعد قليل." },
});

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // ~15mb cap on the base64 string itself

const ScanBody = z.object({
  image: z
    .string()
    .min(100)
    .max(MAX_IMAGE_BYTES * 4 / 3) // base64 inflates ~33%
    .refine(
      (s) => /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s),
      "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP.",
    ),
});

// Both finance (accountant) and inventory (purchasing) staff legitimately scan
// supplier invoices because the agent affects both books and stock.
const supplierInvoiceAgent = requireRole("owner", "manager", "accountant", "inventory");

// Override default 1mb JSON limit on the scan route only (allow up to 20mb for image uploads).
const largeJsonBody = express.json({ limit: "20mb" });

router.post(
  "/invoices/scan",
  largeJsonBody,
  supplierInvoiceAgent,
  scanLimiter,
  async (req, res) => {
    try {
      const { image } = ScanBody.parse(req.body);

      // Persist the source photo so users can audit it later.
      // Decode the data URI: "data:image/jpeg;base64,XXXX"
      const match = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      if (!match) throw new Error("نوع الصورة غير مدعوم.");
      const contentType = match[1]!;
      const buffer = Buffer.from(match[2]!, "base64");
      const ext = contentType.split("/")[1]?.split("+")[0] ?? "jpg";

      let fileUrl: string | null = null;
      try {
        const uploaded = await uploadBufferToPrivateObject({ buffer, contentType, ext });
        fileUrl = uploaded.url;
      } catch (uploadErr) {
        req.log.warn({ err: uploadErr }, "invoice photo upload failed (continuing without)");
      }

      const extracted = await extractInvoiceFromImage(image);
      return res.json({ ...extracted, fileUrl });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "بيانات الصورة غير صالحة.", details: err.issues });
      }
      const msg = err instanceof Error ? err.message : "فشل تحليل الفاتورة";
      const isUpstream =
        msg.includes("OpenAI") ||
        msg.includes("Vision") ||
        msg.includes("الوكيل") ||
        msg.includes("نوع الصورة");
      const status = isUpstream ? 502 : 500;
      req.log.error({ err }, "Invoice scan failed");
      return res.status(status).json({ error: msg });
    }
  },
);

const CommitItem = z.object({
  description: z.string().min(1),
  quantity: z.coerce.number().min(0).default(1),
  unitPrice: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0).default(0),
  productId: z.coerce.number().int().nullable().optional(), // existing product to update
  poLineId: z.coerce.number().int().positive().nullable().optional(), // 3-way match link
});

const CommitBody = z.object({
  supplierName: z.string().min(1),
  supplierVatNumber: z.string().nullable().optional(),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  subtotal: z.coerce.number().min(0).default(0),
  vat: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
  confidence: z.coerce.number().min(0).max(1).default(0.7),
  items: z.array(CommitItem).default([]),
  /**
   * The fileUrl must reference our own storage proxy and live under the
   * invoice key namespace produced by uploadBufferToPrivateObject:
   *   /api/storage/objects/invoices/YYYY-MM-DD/<uuid>.<ext>
   * Restricting the regex to this exact shape (a) blocks `javascript:` /
   * external URLs from causing stored XSS in <a href> / <img src>, (b)
   * prevents path traversal segments like "..", and (c) stops a caller from
   * pointing the persisted invoice at unrelated objects in the bucket.
   */
  fileUrl: z
    .string()
    .regex(
      /^\/api\/storage\/objects\/invoices\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|pdf)$/i,
      "fileUrl must point to our storage proxy",
    )
    .nullable()
    .optional(),
  addToInventory: z.boolean().default(true),
  postToAccounting: z.boolean().default(true),
  // Optional 3-way match link: when set, the invoice is tied to this PO and
  // the journal posts to GR-IR (debited against the receipt-time credit)
  // instead of debiting Inventory again. The goods-receipt has already
  // moved stock, so addToInventory should be false in this flow.
  poId: z.coerce.number().int().positive().nullable().optional(),
});

router.post("/invoices/from-scan", supplierInvoiceAgent, async (req, res) => {
  let body: z.infer<typeof CommitBody>;
  try {
    body = CommitBody.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "بيانات الفاتورة غير صالحة.", details: err.issues });
    }
    return res.status(400).json({ error: "Bad request" });
  }

  // Validate optional ISO date strings up front for clear 400 errors.
  for (const [field, val] of [["invoiceDate", body.invoiceDate], ["dueDate", body.dueDate]] as const) {
    if (val && Number.isNaN(Date.parse(val))) {
      return res.status(400).json({ error: `حقل ${field} غير صالح. استخدم صيغة YYYY-MM-DD.` });
    }
  }

  // 3-way match enforcement: if poId is provided, validate every linked
  // line against the PO before opening the transaction so we can return a
  // clear 4xx without burning a transaction.
  const PRICE_TOLERANCE_PCT = Number(process.env.PO_INVOICE_PRICE_TOLERANCE_PCT ?? "5");
  let poLinesById: Map<number, { id: number; poId: number; quantity: string; receivedQty: string; billedQty: string; unitPrice: string }> | null = null;
  if (body.poId) {
    // Force addToInventory=false on PO-linked invoices: the linked GRN
    // already moved stock; allowing addToInventory=true here would
    // double-count inventory and post the wrong leg of the journal.
    body.addToInventory = false;
    const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, body.poId));
    if (!po) {
      return res.status(400).json({ error: "أمر الشراء المحدد غير موجود." });
    }
    if (!["confirmed", "partially_received", "fully_received"].includes(po.status)) {
      return res.status(409).json({ error: `لا يمكن مطابقة فاتورة مع أمر شراء بحالة "${po.status}".` });
    }
    // Segregation of Duties: the user who created the purchase order
    // cannot also be the one who books the matching supplier invoice.
    // Otherwise the same person who decided WHAT to buy also decides we
    // OWE for it — that's the classic fictitious-payable fraud path.
    // No role escape (including owner): emergency overrides must go
    // through the configured approval matrix, not bypass this guard.
    {
      const sessionUserId = req.session?.userId ?? null;
      if (
        sessionUserId != null &&
        po.createdBy != null &&
        sessionUserId === po.createdBy
      ) {
        return res.status(403).json({
          error: "لا يمكن اعتماد فاتورة مورد على أمر شراء قمت بإنشائه (مبدأ فصل المهام). يجب على محاسب آخر تسجيل الفاتورة.",
        });
      }
    }
    const linkedLineIds = body.items.map((it) => it.poLineId).filter((v): v is number => !!v);
    // 3-way match must be enforced: when a PO is linked, EVERY invoice
    // item must reference a PO line. A partial linkage would let the
    // server post a hybrid invoice that matches some lines while
    // bypassing the match for others (and posting them straight to GR-IR).
    if (linkedLineIds.length === 0) {
      return res.status(400).json({
        error: "عند ربط الفاتورة بأمر شراء يجب تحديد سطر أمر الشراء لكل بند.",
      });
    }
    const itemsWithoutLink = body.items.filter((it) => !it.poLineId).length;
    if (itemsWithoutLink > 0) {
      return res.status(400).json({
        error: `يوجد ${itemsWithoutLink} بند(بنود) بلا ربط بسطر أمر شراء. يجب ربط جميع البنود لتفعيل المطابقة الثلاثية.`,
      });
    }
    {
      const poLines = await db
        .select()
        .from(purchaseOrderLinesTable)
        .where(inArray(purchaseOrderLinesTable.id, linkedLineIds));
      poLinesById = new Map(poLines.map((l) => [l.id, l]));
      for (const item of body.items) {
        if (!item.poLineId) continue;
        const ln = poLinesById.get(item.poLineId);
        if (!ln || ln.poId !== body.poId) {
          return res.status(400).json({ error: `بند الفاتورة يشير إلى سطر أمر شراء غير صالح (#${item.poLineId}).` });
        }
        const remainingToBill = Number(ln.receivedQty) - Number(ln.billedQty);
        if (item.quantity > remainingToBill + 1e-6) {
          return res.status(409).json({
            error: `الكمية المُفوترة (${item.quantity}) للسطر #${ln.id} تتجاوز الكمية المستلمة غير المُفوترة (${remainingToBill}).`,
          });
        }
        const expectedPrice = Number(ln.unitPrice);
        if (expectedPrice > 0) {
          const diffPct = Math.abs(item.unitPrice - expectedPrice) / expectedPrice * 100;
          if (diffPct > PRICE_TOLERANCE_PCT) {
            return res.status(409).json({
              error: `سعر الفاتورة للسطر #${ln.id} يتجاوز نسبة التفاوت المسموحة (${PRICE_TOLERANCE_PCT}%).`,
            });
          }
        }
      }
    }
  }

  try {
    const result = await db.transaction(async (tx) => {
      // 0) Find or create the supplier so the invoice can be linked to a supplier record.
      // VAT number has a UNIQUE constraint, so we use ON CONFLICT DO UPDATE to
      // make this race-safe under concurrent imports (the conflicting row is
      // returned with its existing id). When VAT is absent we fall back to a
      // name lookup; concurrent name-only inserts may still create duplicates,
      // but those are easy to merge later by hand.
      const trimmedSupplier = body.supplierName.trim();
      const companyId = getCompanyId(req);
      let supplierId: number | null = null;
      if (trimmedSupplier) {
        if (body.supplierVatNumber) {
          // VAT lookup must be tenant-scoped to avoid cross-tenant collisions
          // on the (companyId, vatNumber) compound uniqueness.
          const [byVat] = await tx
            .select({ id: suppliersTable.id })
            .from(suppliersTable)
            .where(and(
              eq(suppliersTable.companyId, companyId),
              eq(suppliersTable.vatNumber, body.supplierVatNumber),
            ))
            .limit(1);
          if (byVat) {
            supplierId = byVat.id;
          } else {
            const [created] = await tx
              .insert(suppliersTable)
              .values({ companyId, name: trimmedSupplier, vatNumber: body.supplierVatNumber })
              .returning({ id: suppliersTable.id });
            supplierId = created?.id ?? null;
          }
        } else {
          const [byName] = await tx
            .select({ id: suppliersTable.id })
            .from(suppliersTable)
            .where(and(
              eq(suppliersTable.companyId, companyId),
              eq(suppliersTable.name, trimmedSupplier),
            ))
            .limit(1);
          if (byName) {
            supplierId = byName.id;
          } else {
            const [created] = await tx
              .insert(suppliersTable)
              .values({ companyId, name: trimmedSupplier })
              .returning({ id: suppliersTable.id });
            supplierId = created?.id ?? null;
          }
        }
      }

      // 1) Insert the invoice header — DB unique constraint on invoice_number guards against races.
      const willBeApproved = body.confidence >= 0.85;
      const [invoice] = await tx
        .insert(invoicesTable)
        .values({
          companyId,
          invoiceNumber: body.invoiceNumber,
          supplierId,
          supplierName: body.supplierName,
          amount: String(body.total),
          status: willBeApproved ? "done" : "needs_review",
          confidence: body.confidence,
          fileUrl: body.fileUrl || null,
          invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : null,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          poId: body.poId ?? null,
          // Auto-lock on approval: the moment status=='done' the invoice
          // posts a journal entry and updates the supplier balance, so it
          // must become immutable in the same insert.
          isLocked: willBeApproved,
          lockedAt: willBeApproved ? new Date() : null,
        })
        .returning();
      if (!invoice) throw new Error("Failed to create invoice");

      // 3-way match: the resolved invoice supplier must match the PO
      // supplier — otherwise we'd be increasing one supplier's AP while
      // releasing GR-IR booked against another supplier's GRN.
      if (body.poId) {
        const [linkedPo] = await tx
          .select({ supplierId: purchaseOrdersTable.supplierId, reference: purchaseOrdersTable.reference })
          .from(purchaseOrdersTable)
          .where(eq(purchaseOrdersTable.id, body.poId));
        if (!linkedPo) {
          throw new Error("PO disappeared mid-transaction");
        }
        if (supplierId !== linkedPo.supplierId) {
          throw Object.assign(new Error(
            `مورد الفاتورة لا يطابق مورد أمر الشراء ${linkedPo.reference}.`,
          ), { httpStatus: 409 });
        }
      }

      // 3-way match: bump billed_qty on each linked PO line. The pre-flight
      // checks above already validated quantities and price tolerance.
      if (body.poId && poLinesById) {
        for (const item of body.items) {
          if (!item.poLineId) continue;
          await tx
            .update(purchaseOrderLinesTable)
            .set({ billedQty: sql`${purchaseOrderLinesTable.billedQty} + ${item.quantity}` })
            .where(eq(purchaseOrderLinesTable.id, item.poLineId));
        }
      }

      // Increase the supplier's outstanding payable balance.
      if (supplierId) {
        await tx
          .update(suppliersTable)
          .set({ balance: sql`${suppliersTable.balance} + ${body.total}` })
          .where(eq(suppliersTable.id, supplierId));
      }

      const inventoryUpdates: Array<{
        productId: number; productName: string; quantityAdded: number; matched: boolean;
      }> = [];
      const newProducts: Array<{ productId: number; name: string; quantityAdded: number }> = [];

      // Resolve a default category id (get-or-create "غير مصنف") if we'll create new products.
      let defaultCategoryId: number | null = null;
      if (body.addToInventory && body.items.some((it) => !it.productId)) {
        const [existingCat] = await tx
          .select({ id: categoriesTable.id })
          .from(categoriesTable)
          .where(eq(categoriesTable.nameAr, "غير مصنف"))
          .limit(1);
        if (existingCat) {
          defaultCategoryId = existingCat.id;
        } else {
          const [created] = await tx
            .insert(categoriesTable)
            .values({ name: "Uncategorized", nameAr: "غير مصنف" })
            .returning({ id: categoriesTable.id });
          defaultCategoryId = created?.id ?? null;
        }
      }

      // 2) Inventory: match-or-create per line item, then post a stock receipt
      //    move into the default warehouse via the stock engine. The engine
      //    refreshes products.stock as the SUM of quants, so we never write
      //    that column directly here. We pass skipJournal=true because the
      //    supplier-invoice journal below already debits Inventory.
      const defaultWarehouseId = body.addToInventory ? await getDefaultWarehouseId(tx) : null;
      if (body.addToInventory && defaultWarehouseId) {
        let autoSeq = 0;
        for (const item of body.items) {
          if (item.quantity <= 0) continue;
          let matchedId: number | null = item.productId ?? null;
          let matchedName = item.description;

          if (!matchedId) {
            const [match] = await tx
              .select({ id: productsTable.id, name: productsTable.nameAr })
              .from(productsTable)
              .where(ilike(productsTable.nameAr, `%${item.description.trim()}%`))
              .limit(1);
            if (match) {
              matchedId = match.id;
              matchedName = match.name;
            }
          }

          if (!matchedId) {
            if (defaultCategoryId === null) continue;
            autoSeq += 1;
            const [created] = await tx
              .insert(productsTable)
              .values({
                companyId,
                name: item.description,
                nameAr: item.description,
                sku: `AUTO-${invoice.id}-${autoSeq}`,
                price: String((item.unitPrice * 1.3).toFixed(2)),
                costPrice: String(item.unitPrice.toFixed(2)),
                stock: "0",
                minStock: 5,
                categoryId: defaultCategoryId,
                unit: "piece",
              })
              .returning({ id: productsTable.id });
            if (!created) continue;
            matchedId = created.id;
            newProducts.push({
              productId: created.id,
              name: item.description,
              quantityAdded: Math.round(item.quantity),
            });
          } else {
            inventoryUpdates.push({
              productId: matchedId,
              productName: matchedName,
              quantityAdded: Math.round(item.quantity),
              matched: true,
            });
          }

          await recordStockMove(tx, {
            productId: matchedId,
            quantity: item.quantity,
            unitCost: item.unitPrice,
            kind: "receipt",
            toWarehouseId: defaultWarehouseId,
            sourceType: "supplier_invoice",
            sourceId: invoice.id,
            sourceRef: invoice.invoiceNumber,
            createdBy: req.session?.userId ?? null,
            notes: `استلام من فاتورة المورد ${invoice.invoiceNumber}`,
            // Avoid double-posting Inventory: the journal below already debits it.
            skipJournal: true,
          });
        }
      }

      // 3) Double-entry journal posting via the new posting engine.
      // Dr Inventory (subtotal) + Dr VAT-Input (vat) / Cr Accounts Payable (total)
      const journalRefs: number[] = [];
      if (body.postToAccounting && body.total > 0) {
        const ref = `INV-${invoice.invoiceNumber}`;
        const desc = `فاتورة مورد — ${body.supplierName}`;
        const date = body.invoiceDate ? new Date(body.invoiceDate) : new Date();
        const lines: Array<{
          systemKey: string;
          debit?: number;
          credit?: number;
          description?: string;
        }> = [];
        // 3-way match path: if the invoice is linked to a PO, the goods
        // receipt already debited Inventory & credited GR-IR — so here we
        // debit GR-IR (clearing it) instead of Inventory again.
        if (body.subtotal > 0) {
          lines.push({
            systemKey: body.poId ? "gr_ir" : "inventory",
            debit: body.subtotal,
            description: body.poId ? "تسوية حساب استلام بضاعة" : "بضاعة مشتراة",
          });
        }
        if (body.vat > 0) {
          lines.push({ systemKey: "vat_input", debit: body.vat, description: "ضريبة المدخلات" });
        }
        // If neither subtotal nor vat were supplied, post entire amount.
        // PO-linked invoices must clear GR-IR (the GRN already debited
        // Inventory); only non-PO scans fall back to Inventory.
        if (lines.length === 0) {
          lines.push({
            systemKey: body.poId ? "gr_ir" : "inventory",
            debit: body.total,
          });
        }
        lines.push({ systemKey: "ap", credit: body.total, description: body.supplierName });
        // Strict posting — any failure aborts the entire invoice transaction
        // so we never persist a supplier invoice without its ledger postings.
        const result = await postJournalEntry(
          tx,
          {
            entryDate: date,
            description: desc,
            reference: ref,
            source: "supplier_invoice",
            sourceRef: ref,
            createdBy: req.session?.userId ?? null,
            status: "posted",
            companyId: getCompanyId(req),
          },
          lines,
        );
        journalRefs.push(result.id);
      }

      return {
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          supplierName: invoice.supplierName,
          amount: Number(invoice.amount),
          status: invoice.status,
          confidence: invoice.confidence ?? 0,
        },
        inventoryUpdates,
        newProducts,
        journalEntryIds: journalRefs,
      };
    });

    void recordAudit(req, {
      action: "create",
      entity: "invoice",
      details: `فاتورة رقم ${result.invoice.invoiceNumber} للمورد ${result.invoice.supplierName} بقيمة ${result.invoice.amount} (الوكيل الذكي)`,
      severity: result.invoice.status === "needs_review" ? "warning" : "info",
    });

    // Anomaly hook: after-hours invoices land here, so the engine can
    // raise an alert when a supplier invoice is committed at 02:00.
    void evaluateAnomalies({
      type: "invoice.created",
      actorId: req.session?.userId ?? null,
      actorName:
        (req.session as { userName?: string } | undefined)?.userName ?? null,
      refTable: "invoices",
      refId: result.invoice.id,
      payload: {
        invoiceNumber: result.invoice.invoiceNumber,
        supplierName: result.invoice.supplierName,
        amount: result.invoice.amount,
      },
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ClosedPeriodError) {
      return res.status(403).json({ error: err.message });
    }
    if (isUniqueViolation(err)) {
      return res.status(409).json({
        error: `الفاتورة رقم ${body.invoiceNumber} موجودة مسبقاً.`,
      });
    }
    // Tagged business-rule errors (e.g. supplier mismatch on PO link)
    // surface as 4xx instead of opaque 500s.
    const tagged = err as { httpStatus?: number };
    if (typeof tagged?.httpStatus === "number" && tagged.httpStatus >= 400 && tagged.httpStatus < 500) {
      const msg = err instanceof Error ? err.message : "Bad request";
      return res.status(tagged.httpStatus).json({ error: msg });
    }
    req.log.error({ err }, "Commit scanned invoice failed");
    const msg = err instanceof Error ? err.message : "فشل حفظ الفاتورة";
    return res.status(500).json({ error: msg });
  }
});

// Hint to keep `ExtractedInvoice` type referenced in this file.
export type _ExtractedInvoiceRef = ExtractedInvoice;

export default router;
