import { Router } from "express";
import QRCode from "qrcode";
import { db, invoicesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { CreateInvoiceBody, UpdateInvoiceBody } from "@workspace/api-zod";

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

router.get("/invoices", async (req, res) => {
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

router.post("/invoices", async (req, res) => {
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

router.get("/invoices/stats", async (req, res) => {
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

router.get("/invoices/:id", async (req, res) => {
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

router.get("/invoices/:id/zatca-qr", async (req, res) => {
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

router.patch("/invoices/:id", async (req, res) => {
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

export default router;
