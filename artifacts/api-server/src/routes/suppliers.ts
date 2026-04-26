import { Router } from "express";
import { z, ZodError } from "zod";
import { db, suppliersTable, invoicesTable } from "@workspace/db";
import { eq, ilike, or, sql, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/require-role";
import { recordAudit } from "../lib/audit";

const router = Router();
const accountantOrManager = requireRole("manager", "accountant");

const CreateSupplierBody = z.object({
  name: z.string().min(1),
  vatNumber: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/suppliers", async (req, res) => {
  try {
    const search = (req.query["search"] as string | undefined)?.trim();

    const rows = await db
      .select({
        id: suppliersTable.id,
        name: suppliersTable.name,
        vatNumber: suppliersTable.vatNumber,
        email: suppliersTable.email,
        phone: suppliersTable.phone,
        address: suppliersTable.address,
        balance: suppliersTable.balance,
        invoicesCount: sql<number>`(select count(*) from ${invoicesTable} where ${invoicesTable.supplierId} = ${suppliersTable.id})`,
        createdAt: suppliersTable.createdAt,
      })
      .from(suppliersTable)
      .where(search ? or(ilike(suppliersTable.name, `%${search}%`), ilike(suppliersTable.vatNumber, `%${search}%`)) : sql`true`)
      .orderBy(desc(suppliersTable.createdAt));

    res.json(
      rows.map((r) => ({
        ...r,
        balance: Number(r.balance),
        invoicesCount: Number(r.invoicesCount),
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "list suppliers failed");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/suppliers", accountantOrManager, async (req, res) => {
  try {
    const body = CreateSupplierBody.parse(req.body);
    const [created] = await db
      .insert(suppliersTable)
      .values({
        name: body.name,
        vatNumber: body.vatNumber || null,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
        notes: body.notes || null,
      })
      .returning();
    void recordAudit(req, { action: "create", entity: "supplier", details: `أُضيف المورد ${body.name}` });
    return res.status(201).json(created);
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: "بيانات غير صالحة", details: err.issues });
    // PG unique-violation on suppliers_vat_number_unique → 409 instead of 500.
    const code = (err as { code?: string; cause?: { code?: string } })?.code
      ?? (err as { cause?: { code?: string } })?.cause?.code;
    const message = err instanceof Error ? err.message : "";
    if (code === "23505" || /duplicate key value|suppliers_vat_number_unique/i.test(message)) {
      return res.status(409).json({ error: "يوجد مورد آخر بنفس الرقم الضريبي." });
    }
    req.log.error({ err }, "create supplier failed");
    return res.status(500).json({ error: "internal" });
  }
});

router.get("/suppliers/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });

    const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, id));
    if (!supplier) return res.status(404).json({ error: "not found" });

    // Field set matches the OpenAPI-generated SupplierDetail.recentInvoices schema
    // exactly (supplierName, confidence, fileUrl, createdAt). Keeping these aligned
    // means the frontend can call the codegen client without runtime parse errors.
    const invoices = await db
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        supplierName: invoicesTable.supplierName,
        amount: invoicesTable.amount,
        status: invoicesTable.status,
        confidence: invoicesTable.confidence,
        fileUrl: invoicesTable.fileUrl,
        dueDate: invoicesTable.dueDate,
        createdAt: invoicesTable.createdAt,
      })
      .from(invoicesTable)
      .where(eq(invoicesTable.supplierId, id))
      .orderBy(desc(invoicesTable.createdAt))
      .limit(25);

    return res.json({
      supplier: {
        ...supplier,
        balance: Number(supplier.balance),
        createdAt: supplier.createdAt.toISOString(),
      },
      recentInvoices: invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        supplierName: i.supplierName,
        amount: Number(i.amount),
        status: i.status,
        confidence: i.confidence != null ? Number(i.confidence) : null,
        fileUrl: i.fileUrl ?? null,
        dueDate: i.dueDate ? i.dueDate.toISOString() : null,
        createdAt: i.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "get supplier failed");
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * Find or create a supplier by name (used by invoice scanner agent).
 * Returns the supplier id. Optionally accepts vatNumber to enrich an existing record.
 */
export async function findOrCreateSupplier(opts: {
  name: string;
  vatNumber?: string | null;
}): Promise<number> {
  const trimmed = opts.name.trim();
  if (!trimmed) throw new Error("supplier name required");

  // Try by VAT number first (most reliable identifier in KSA), then by name.
  if (opts.vatNumber) {
    const [byVat] = await db
      .select({ id: suppliersTable.id })
      .from(suppliersTable)
      .where(eq(suppliersTable.vatNumber, opts.vatNumber))
      .limit(1);
    if (byVat) return byVat.id;
  }

  const [byName] = await db
    .select({ id: suppliersTable.id })
    .from(suppliersTable)
    .where(eq(suppliersTable.name, trimmed))
    .limit(1);
  if (byName) {
    if (opts.vatNumber) {
      await db.update(suppliersTable).set({ vatNumber: opts.vatNumber }).where(eq(suppliersTable.id, byName.id));
    }
    return byName.id;
  }

  const [created] = await db
    .insert(suppliersTable)
    .values({ name: trimmed, vatNumber: opts.vatNumber ?? null })
    .returning({ id: suppliersTable.id });
  if (!created) throw new Error("failed to create supplier");
  return created.id;
}

export default router;
