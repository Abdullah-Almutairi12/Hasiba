import { Router } from "express";
import {
  db,
  customersTable,
  customerInvoicesTable,
  customerReceiptsTable,
  creditNotesTable,
  salesOrdersTable,
  quotationsTable,
  opportunitiesTable,
  opportunityStagesTable,
  pricelistsTable,
  companiesTable,
  usersTable,
} from "@workspace/db";
import type { AuditConsent } from "@workspace/db";
import { ilike, or, sql, desc, eq, inArray, and, isNotNull } from "drizzle-orm";
import { CreateCustomerBody } from "@workspace/api-zod";
import { z } from "zod";
import {
  salesWriteGuard,
  customerReadGuard,
} from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";
import { ScopedDb, getCompanyId } from "../lib/scoped-db";
import { assertLinkedCompanyAllowed } from "../lib/assert-linked-company";

const router = Router();

/**
 * Task #259 — read-time PII / sales-figure redaction for customer
 * endpoints, driven by the VIEWER's own `auditConsent`. Owners always
 * bypass redaction (accountable for the company). For every other
 * role:
 *   - `customerPii=false` → phone/email/billing/shipping addresses /
 *     tax number replaced with "—"
 *   - `salesDetails=false` → totalSpent / creditLimit collapsed to 0
 * Consent is a per-user opt-in; rows themselves are never mutated.
 */
const REDACTED = "—";
async function loadViewerConsent(
  userId: number | undefined,
): Promise<AuditConsent | null> {
  if (typeof userId !== "number") return null;
  const [row] = await db
    .select({ adminPrefs: usersTable.adminPrefs })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row?.adminPrefs?.auditConsent ?? null;
}
function redactCustomer<T extends Record<string, unknown>>(
  c: T,
  consent: AuditConsent | null,
  role: string | undefined,
): T {
  if (role === "owner") return c;
  const piiOff = consent?.customerPii === false;
  const salesOff = consent?.salesDetails === false;
  if (!piiOff && !salesOff) return c;
  return {
    ...c,
    ...(piiOff
      ? {
          phone: REDACTED,
          email: REDACTED,
          taxNumber: REDACTED,
          billingAddress: REDACTED,
          shippingAddress: REDACTED,
        }
      : {}),
    ...(salesOff
      ? {
          totalSpent: 0,
          creditLimit: 0,
        }
      : {}),
  };
}

/**
 * GET /customers — list customers for the active tenant.
 *
 * `linkedOnly=1` narrows the result to customers wired to a sibling
 * company (intercompany mirror prerequisite). `linkedCompanyName` is
 * resolved via LEFT JOIN so the listing UI can show a "مرتبط بـ <name>"
 * badge without N+1 lookups.
 */
router.get("/customers", customerReadGuard, async (req, res) => {
  try {
    const { search } = req.query;
    const linkedOnly = req.query["linkedOnly"] === "1" || req.query["linkedOnly"] === "true";
    const scoped = new ScopedDb(getCompanyId(req));
    const customers = await db
      .select({
        row: customersTable,
        linkedCompanyName: companiesTable.name,
      })
      .from(customersTable)
      .leftJoin(companiesTable, eq(companiesTable.id, customersTable.linkedCompanyId))
      .where(
        and(
          scoped.scope(customersTable),
          search
            ? or(
                ilike(customersTable.name, `%${search}%`),
                ilike(customersTable.phone ?? "", `%${search}%`)
              )
            : sql`true`,
          linkedOnly ? isNotNull(customersTable.linkedCompanyId) : sql`true`,
        )
      )
      .orderBy(desc(customersTable.createdAt));

    const consent = await loadViewerConsent(req.session?.userId);
    const role = req.session?.role;
    res.json(
      customers.map(({ row: c, linkedCompanyName }) =>
        redactCustomer(
          {
            ...c,
            totalSpent: Number(c.totalSpent),
            creditLimit: Number(c.creditLimit ?? 0),
            createdAt: c.createdAt.toISOString(),
            linkedCompanyName: linkedCompanyName ?? null,
          },
          consent,
          role,
        ),
      ),
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching customers");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/customers", salesWriteGuard, async (req, res) => {
  try {
    const Extended = CreateCustomerBody.extend({
      segment: z.enum(["retail", "wholesale", "vip", "distributor"]).optional(),
      defaultPricelistId: z.number().int().nullable().optional(),
      paymentTermsDays: z.number().int().min(0).optional(),
      creditLimit: z.number().min(0).optional(),
      taxNumber: z.string().nullable().optional(),
      billingAddress: z.string().nullable().optional(),
      shippingAddress: z.string().nullable().optional(),
      // Phase-5: when set, sales invoices to this customer are mirrored
      // into the linked sibling company as supplier invoices.
      linkedCompanyId: z.number().int().nullable().optional(),
    });
    const body = Extended.parse(req.body);
    const scoped = new ScopedDb(getCompanyId(req));
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "غير مسجل دخول" }); return; }
    const linkedCompanyId = await assertLinkedCompanyAllowed(userId, body.linkedCompanyId);
    const [customer] = await db
      .insert(customersTable)
      .values(scoped.stamp({
        name: body.name,
        phone: body.phone ?? null,
        email: body.email ?? null,
        segment: body.segment ?? "retail",
        defaultPricelistId: body.defaultPricelistId ?? null,
        paymentTermsDays: body.paymentTermsDays ?? 0,
        creditLimit: String(body.creditLimit ?? 0),
        taxNumber: body.taxNumber ?? null,
        billingAddress: body.billingAddress ?? null,
        shippingAddress: body.shippingAddress ?? null,
        linkedCompanyId,
      }))
      .returning();

    res.status(201).json({
      ...customer,
      totalSpent: Number(customer.totalSpent),
      creditLimit: Number(customer.creditLimit ?? 0),
      createdAt: customer.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating customer");
    handleRouteError(err, res);
  }
});

router.patch("/customers/:id", salesWriteGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = z.object({
      name: z.string().optional(),
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      segment: z.enum(["retail", "wholesale", "vip", "distributor"]).optional(),
      defaultPricelistId: z.number().int().nullable().optional(),
      paymentTermsDays: z.number().int().min(0).optional(),
      creditLimit: z.number().min(0).optional(),
      taxNumber: z.string().nullable().optional(),
      billingAddress: z.string().nullable().optional(),
      shippingAddress: z.string().nullable().optional(),
      linkedCompanyId: z.number().int().nullable().optional(),
    });
    const b = Body.parse(req.body);
    const scoped = new ScopedDb(getCompanyId(req));
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "غير مسجل دخول" }); return; }
    // Validate the link target before touching the row so a forbidden link
    // never half-succeeds. `undefined` means the user didn't send the field.
    if (b.linkedCompanyId !== undefined) {
      await assertLinkedCompanyAllowed(userId, b.linkedCompanyId);
    }
    const patch: Partial<typeof customersTable.$inferInsert> = {};
    if (b.name !== undefined) patch.name = b.name;
    if (b.phone !== undefined) patch.phone = b.phone;
    if (b.email !== undefined) patch.email = b.email;
    if (b.segment !== undefined) patch.segment = b.segment;
    if (b.defaultPricelistId !== undefined) patch.defaultPricelistId = b.defaultPricelistId;
    if (b.paymentTermsDays !== undefined) patch.paymentTermsDays = b.paymentTermsDays;
    if (b.taxNumber !== undefined) patch.taxNumber = b.taxNumber;
    if (b.billingAddress !== undefined) patch.billingAddress = b.billingAddress;
    if (b.shippingAddress !== undefined) patch.shippingAddress = b.shippingAddress;
    if (b.creditLimit !== undefined) patch.creditLimit = String(b.creditLimit);
    if (b.linkedCompanyId !== undefined) patch.linkedCompanyId = b.linkedCompanyId;
    // Tenant scope: prevents mutating another company's customer row.
    const [row] = await db
      .update(customersTable)
      .set(patch)
      .where(and(eq(customersTable.id, id), scoped.scope(customersTable)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...row, totalSpent: Number(row.totalSpent), creditLimit: Number(row.creditLimit ?? 0), createdAt: row.createdAt.toISOString() });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// Customer 360 — full view of a single customer.
// Receipts and AR/overdue/credit metrics are finance-only data: cashier,
// sales, marketing and auditor roles can see the customer's CRM/sales
// surface but must not see cash collection or outstanding-balance
// figures. We therefore gate those fields at runtime by role rather
// than 403-ing the whole endpoint, so non-finance roles still get the
// quotations/orders/opps view they legitimately need.
router.get("/customers/:id/360", customerReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const scoped = new ScopedDb(getCompanyId(req));
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(and(eq(customersTable.id, id), scoped.scope(customersTable)));
    if (!customer) { res.status(404).json({ error: "العميل غير موجود" }); return; }

    const role = req.session?.role;
    const canSeeFinance = role === "owner" || role === "manager" || role === "accountant";

    const [invoices, receipts, orders, quotes, opps, pricelist] = await Promise.all([
      db
        .select()
        .from(customerInvoicesTable)
        .where(eq(customerInvoicesTable.customerId, id))
        .orderBy(desc(customerInvoicesTable.createdAt))
        .limit(50),
      canSeeFinance
        ? db
            .select()
            .from(customerReceiptsTable)
            .where(eq(customerReceiptsTable.customerId, id))
            .orderBy(desc(customerReceiptsTable.createdAt))
            .limit(50)
        : Promise.resolve([] as Array<typeof customerReceiptsTable.$inferSelect>),
      db
        .select()
        .from(salesOrdersTable)
        .where(eq(salesOrdersTable.customerId, id))
        .orderBy(desc(salesOrdersTable.createdAt))
        .limit(50),
      db
        .select()
        .from(quotationsTable)
        .where(eq(quotationsTable.customerId, id))
        .orderBy(desc(quotationsTable.createdAt))
        .limit(50),
      db
        .select({
          id: opportunitiesTable.id,
          name: opportunitiesTable.name,
          stageId: opportunitiesTable.stageId,
          stageName: opportunityStagesTable.nameAr,
          isWon: opportunityStagesTable.isWon,
          isLost: opportunityStagesTable.isLost,
          expectedRevenue: opportunitiesTable.expectedRevenue,
          probability: opportunitiesTable.probability,
          expectedCloseDate: opportunitiesTable.expectedCloseDate,
        })
        .from(opportunitiesTable)
        .leftJoin(opportunityStagesTable, eq(opportunityStagesTable.id, opportunitiesTable.stageId))
        .where(eq(opportunitiesTable.customerId, id))
        .orderBy(desc(opportunitiesTable.updatedAt))
        .limit(50),
      customer.defaultPricelistId
        ? db.select().from(pricelistsTable).where(eq(pricelistsTable.id, customer.defaultPricelistId)).limit(1)
        : Promise.resolve([]),
    ]);

    // Aggregate issued/applied credit notes per invoice so the AR balance
    // matches /sales/reports/ar-aging — a fully credited invoice should
    // contribute 0 to the customer's outstanding balance even if the
    // invoice row's amount_paid is still 0.
    const credits = await db
      .select({
        invoiceId: creditNotesTable.invoiceId,
        sum: sql<number>`coalesce(sum(${creditNotesTable.total}::numeric), 0)`,
      })
      .from(creditNotesTable)
      .where(
        and(
          eq(creditNotesTable.customerId, id),
          inArray(creditNotesTable.status, ["issued", "applied"]),
        ),
      )
      .groupBy(creditNotesTable.invoiceId);
    const creditByInv = new Map(credits.filter((c) => c.invoiceId != null).map((c) => [c.invoiceId as number, Number(c.sum)]));
    const outstanding = (i: typeof invoices[number]) =>
      Math.max(0, Number(i.total) - Number(i.amountPaid) - (creditByInv.get(i.id) ?? 0));
    const arOpenInvoices = invoices.filter((i) => ["open", "partially_paid"].includes(i.status));
    const arBalance = arOpenInvoices.reduce((a, i) => a + outstanding(i), 0);
    const today = new Date().toISOString().slice(0, 10);
    const overdue = arOpenInvoices
      .filter((i) => (i.dueDate ?? i.invoiceDate) < today)
      .reduce((a, i) => a + outstanding(i), 0);

    const consent = await loadViewerConsent(req.session?.userId);
    res.json({
      customer: redactCustomer(
        {
          ...customer,
          totalSpent: Number(customer.totalSpent),
          creditLimit: Number(customer.creditLimit ?? 0),
          createdAt: customer.createdAt.toISOString(),
        },
        consent,
        role,
      ),
      pricelist: pricelist[0] ?? null,
      summary: {
        // Finance-only fields: omitted (null) for sales/cashier/marketing/
        // auditor so the UI can still render the rest of the page without
        // leaking AR balance, overdue, or credit availability.
        arBalance: canSeeFinance ? +arBalance.toFixed(2) : null,
        overdue: canSeeFinance ? +overdue.toFixed(2) : null,
        creditAvailable: canSeeFinance
          ? +(Number(customer.creditLimit ?? 0) - arBalance).toFixed(2)
          : null,
        invoiceCount: invoices.length,
        openOpportunities: opps.filter((o) => !o.isWon && !o.isLost).length,
        openOrders: orders.filter((o) => !["done", "cancelled", "invoiced"].includes(o.status)).length,
      },
      quotations: quotes.map(serializeMoneyDoc),
      orders: orders.map(serializeMoneyDoc),
      invoices: invoices.map(serializeMoneyDoc),
      receipts: canSeeFinance
        ? receipts.map((r) => ({ ...r, amount: Number(r.amount) }))
        : [],
      opportunities: opps.map((o) => ({ ...o, expectedRevenue: Number(o.expectedRevenue) })),
      canSeeFinance,
    });
  } catch (err) {
    req.log.error({ err }, "customer 360");
    handleRouteError(err, res);
  }
});

function serializeMoneyDoc<T extends Record<string, unknown>>(d: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...d };
  for (const k of ["subtotal", "discount", "vat", "total", "amountPaid", "amount"]) {
    if (out[k] != null) out[k] = Number(out[k] as string | number);
  }
  if (out.createdAt instanceof Date) out.createdAt = out.createdAt.toISOString();
  return out;
}

export default router;
