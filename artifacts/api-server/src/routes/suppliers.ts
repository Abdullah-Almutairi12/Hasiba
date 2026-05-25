import { Router } from "express";
import { z, ZodError } from "zod";
import { db, suppliersTable, invoicesTable } from "@workspace/db";
import { eq, ilike, or, sql, desc } from "drizzle-orm";
import { requireRole, supplierReadGuard } from "../middlewares/require-role";
import { recordAudit } from "../lib/audit";
import { ScopedDb, getCompanyId } from "../lib/scoped-db";
import { and } from "drizzle-orm";

const router = Router();
// Suppliers are written by both finance (accounting) and inventory (purchasing).
const supplierWriteGuard = requireRole("owner", "manager", "accountant", "inventory");

// All supplier reads (list, detail, invoices history) are restricted to roles
// that legitimately need supplier visibility — cashiers, sales, and marketing
// must not see this list. Mount with explicit prefix so the middleware only
// fires for /suppliers/* requests, not unrelated traffic that passes through.
router.use("/suppliers", supplierReadGuard);

const CreateSupplierBody = z.object({
  name: z.string().min(1),
  vatNumber: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Procurement defaults — drive PO/RFQ defaults so users don't have to
  // re-enter currency/tax/terms each time they buy from a supplier.
  paymentTermsDays: z.coerce.number().int().min(0).optional(),
  defaultCurrency: z.string().min(3).max(3).optional(),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
  defaultTax: z.coerce.number().min(0).max(100).optional(),
});

router.get("/suppliers", async (req, res) => {
  try {
    const search = (req.query["search"] as string | undefined)?.trim();
    const scoped = new ScopedDb(getCompanyId(req));

    const rows = await db
      .select({
        id: suppliersTable.id,
        name: suppliersTable.name,
        vatNumber: suppliersTable.vatNumber,
        email: suppliersTable.email,
        phone: suppliersTable.phone,
        address: suppliersTable.address,
        balance: suppliersTable.balance,
        paymentTermsDays: suppliersTable.paymentTermsDays,
        defaultCurrency: suppliersTable.defaultCurrency,
        leadTimeDays: suppliersTable.leadTimeDays,
        defaultTax: suppliersTable.defaultTax,
        invoicesCount: sql<number>`(select count(*) from ${invoicesTable} where ${invoicesTable.supplierId} = ${suppliersTable.id})`,
        createdAt: suppliersTable.createdAt,
      })
      .from(suppliersTable)
      .where(
        and(
          scoped.scope(suppliersTable),
          search
            ? or(ilike(suppliersTable.name, `%${search}%`), ilike(suppliersTable.vatNumber, `%${search}%`))
            : sql`true`,
        ),
      )
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

router.post("/suppliers", supplierWriteGuard, async (req, res) => {
  try {
    const body = CreateSupplierBody.parse(req.body);
    const scoped = new ScopedDb(getCompanyId(req));
    const [created] = await db
      .insert(suppliersTable)
      .values(scoped.stamp({
        name: body.name,
        vatNumber: body.vatNumber || null,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
        notes: body.notes || null,
        ...(body.paymentTermsDays != null ? { paymentTermsDays: body.paymentTermsDays } : {}),
        ...(body.defaultCurrency ? { defaultCurrency: body.defaultCurrency } : {}),
        ...(body.leadTimeDays != null ? { leadTimeDays: body.leadTimeDays } : {}),
        ...(body.defaultTax != null ? { defaultTax: String(body.defaultTax) } : {}),
      }))
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

    const scoped = new ScopedDb(getCompanyId(req));
    const [supplier] = await db
      .select()
      .from(suppliersTable)
      .where(and(eq(suppliersTable.id, id), scoped.scope(suppliersTable)));
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
  companyId: number;
  name: string;
  vatNumber?: string | null;
}): Promise<number> {
  const trimmed = opts.name.trim();
  if (!trimmed) throw new Error("supplier name required");

  // Lookups MUST be tenant-scoped — two different tenants can legitimately
  // have a supplier with the same VAT or name, and bleeding rows across
  // tenants would create cross-tenant journal postings.
  if (opts.vatNumber) {
    const [byVat] = await db
      .select({ id: suppliersTable.id })
      .from(suppliersTable)
      .where(and(
        eq(suppliersTable.companyId, opts.companyId),
        eq(suppliersTable.vatNumber, opts.vatNumber),
      ))
      .limit(1);
    if (byVat) return byVat.id;
  }

  const [byName] = await db
    .select({ id: suppliersTable.id })
    .from(suppliersTable)
    .where(and(
      eq(suppliersTable.companyId, opts.companyId),
      eq(suppliersTable.name, trimmed),
    ))
    .limit(1);
  if (byName) {
    if (opts.vatNumber) {
      await db.update(suppliersTable).set({ vatNumber: opts.vatNumber }).where(eq(suppliersTable.id, byName.id));
    }
    return byName.id;
  }

  const [created] = await db
    .insert(suppliersTable)
    .values({ companyId: opts.companyId, name: trimmed, vatNumber: opts.vatNumber ?? null })
    .returning({ id: suppliersTable.id });
  if (!created) throw new Error("failed to create supplier");
  return created.id;
}

export default router;
