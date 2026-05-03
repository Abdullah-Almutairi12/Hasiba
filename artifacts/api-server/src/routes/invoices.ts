import express, { Router } from "express";
import { z, ZodError } from "zod";
import rateLimit from "express-rate-limit";
import QRCode from "qrcode";
import { db, invoicesTable, productsTable, categoriesTable, suppliersTable } from "@workspace/db";
import { postJournalEntry } from "../lib/journal-posting";
import { eq, sql, desc, ilike } from "drizzle-orm";
import { CreateInvoiceBody, UpdateInvoiceBody } from "@workspace/api-zod";
import { extractInvoiceFromImage, type ExtractedInvoice } from "../lib/invoice-extractor";
import { requireRole, financeGuard, invoiceReadGuard } from "../middlewares/require-role";
import { uploadBufferToPrivateObject } from "./storage";
import { findOrCreateSupplier } from "./suppliers";
import { recordAudit } from "../lib/audit";

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
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(status ? eq(invoicesTable.status, status as string) : sql`true`)
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
    const [invoice] = await db
      .insert(invoicesTable)
      .values({
        invoiceNumber: body.invoiceNumber,
        supplierName: body.supplierName,
        amount: String(body.amount),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        status: "pending",
        confidence: null,
      })
      .returning();

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

    const [stats] = await db
      .select({
        todayCount: sql<number>`count(*) filter (where ${invoicesTable.createdAt} >= ${today.toISOString()})`,
        processingCount: sql<number>`count(*) filter (where ${invoicesTable.status} = 'processing')`,
        needsReviewCount: sql<number>`count(*) filter (where ${invoicesTable.status} = 'needs_review')`,
      })
      .from(invoicesTable);

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
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
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
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
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

    const tlvBase64 = buildZatcaQrPayload({
      sellerName: SELLER_NAME,
      vatNumber: VAT_NUMBER,
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
      sellerName: SELLER_NAME,
      vatNumber: VAT_NUMBER,
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

    // Audit guard: once an invoice is marked done, financial fields are
    // frozen — only status transitions are allowed. Modifying amount or
    // supplier on a finalised invoice would break ZATCA traceability and
    // the accounting trail.
    const [current] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!current) return res.status(404).json({ error: "Not found" });
    if (current.status === "done" && (body.amount !== undefined || body.supplierName)) {
      return res.status(409).json({
        error: "لا يمكن تعديل فاتورة مكتملة. أنشئ إشعار دائن/مدين بدلاً من ذلك.",
      });
    }

    const updateData: Record<string, unknown> = {};
    if (body.status) updateData.status = body.status;
    if (body.amount !== undefined) updateData.amount = String(body.amount);
    if (body.supplierName) updateData.supplierName = body.supplierName;

    const [updated] = await db.update(invoicesTable).set(updateData).where(eq(invoicesTable.id, id)).returning();
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

  try {
    const result = await db.transaction(async (tx) => {
      // 0) Find or create the supplier so the invoice can be linked to a supplier record.
      // VAT number has a UNIQUE constraint, so we use ON CONFLICT DO UPDATE to
      // make this race-safe under concurrent imports (the conflicting row is
      // returned with its existing id). When VAT is absent we fall back to a
      // name lookup; concurrent name-only inserts may still create duplicates,
      // but those are easy to merge later by hand.
      const trimmedSupplier = body.supplierName.trim();
      let supplierId: number | null = null;
      if (trimmedSupplier) {
        if (body.supplierVatNumber) {
          const [row] = await tx
            .insert(suppliersTable)
            .values({ name: trimmedSupplier, vatNumber: body.supplierVatNumber })
            .onConflictDoUpdate({
              target: suppliersTable.vatNumber,
              // Touch a column so RETURNING fires for the existing row.
              set: { name: sql`${suppliersTable.name}` },
            })
            .returning({ id: suppliersTable.id });
          supplierId = row?.id ?? null;
        } else {
          const [byName] = await tx
            .select({ id: suppliersTable.id })
            .from(suppliersTable)
            .where(eq(suppliersTable.name, trimmedSupplier))
            .limit(1);
          if (byName) {
            supplierId = byName.id;
          } else {
            const [created] = await tx
              .insert(suppliersTable)
              .values({ name: trimmedSupplier })
              .returning({ id: suppliersTable.id });
            supplierId = created?.id ?? null;
          }
        }
      }

      // 1) Insert the invoice header — DB unique constraint on invoice_number guards against races.
      const [invoice] = await tx
        .insert(invoicesTable)
        .values({
          invoiceNumber: body.invoiceNumber,
          supplierId,
          supplierName: body.supplierName,
          amount: String(body.total),
          status: body.confidence >= 0.85 ? "done" : "needs_review",
          confidence: body.confidence,
          fileUrl: body.fileUrl || null,
          invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : null,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
        })
        .returning();
      if (!invoice) throw new Error("Failed to create invoice");

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

      // 2) Inventory: match-or-create per line item.
      if (body.addToInventory) {
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

          if (matchedId) {
            await tx
              .update(productsTable)
              .set({ stock: sql`${productsTable.stock} + ${Math.round(item.quantity)}` })
              .where(eq(productsTable.id, matchedId));
            inventoryUpdates.push({
              productId: matchedId,
              productName: matchedName,
              quantityAdded: Math.round(item.quantity),
              matched: true,
            });
          } else {
            if (defaultCategoryId === null) continue;
            autoSeq += 1;
            const [created] = await tx
              .insert(productsTable)
              .values({
                name: item.description,
                nameAr: item.description,
                sku: `AUTO-${invoice.id}-${autoSeq}`,
                price: String((item.unitPrice * 1.3).toFixed(2)),
                costPrice: String(item.unitPrice.toFixed(2)),
                stock: Math.round(item.quantity),
                minStock: 5,
                categoryId: defaultCategoryId,
                unit: "piece",
              })
              .returning({ id: productsTable.id });
            if (created) {
              newProducts.push({
                productId: created.id,
                name: item.description,
                quantityAdded: Math.round(item.quantity),
              });
            }
          }
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
        if (body.subtotal > 0) {
          lines.push({ systemKey: "inventory", debit: body.subtotal, description: "بضاعة مشتراة" });
        }
        if (body.vat > 0) {
          lines.push({ systemKey: "vat_input", debit: body.vat, description: "ضريبة المدخلات" });
        }
        // If neither subtotal nor vat were supplied, post entire amount to inventory.
        if (lines.length === 0) {
          lines.push({ systemKey: "inventory", debit: body.total });
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
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({
        error: `الفاتورة رقم ${body.invoiceNumber} موجودة مسبقاً.`,
      });
    }
    req.log.error({ err }, "Commit scanned invoice failed");
    const msg = err instanceof Error ? err.message : "فشل حفظ الفاتورة";
    return res.status(500).json({ error: msg });
  }
});

// Hint to keep `ExtractedInvoice` type referenced in this file.
export type _ExtractedInvoiceRef = ExtractedInvoice;

export default router;
