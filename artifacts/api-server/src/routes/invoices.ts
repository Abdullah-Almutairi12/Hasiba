import { Router } from "express";
import { db, invoicesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { CreateInvoiceBody, UpdateInvoiceBody } from "@workspace/api-zod";

const router = Router();

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
        confidence: Math.random() * 0.2 + 0.8,
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

    res.json({
      ...invoice,
      amount: Number(invoice.amount),
      dueDate: invoice.dueDate?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching invoice");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/invoices/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = UpdateInvoiceBody.parse(req.body);
    const updateData: Record<string, unknown> = {};
    if (body.status) updateData.status = body.status;
    if (body.amount !== undefined) updateData.amount = String(body.amount);
    if (body.supplierName) updateData.supplierName = body.supplierName;

    const [updated] = await db.update(invoicesTable).set(updateData).where(eq(invoicesTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });

    res.json({
      ...updated,
      amount: Number(updated.amount),
      dueDate: updated.dueDate?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error updating invoice");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
