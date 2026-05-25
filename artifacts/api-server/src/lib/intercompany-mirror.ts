import {
  customersTable,
  suppliersTable,
  customerInvoicesTable,
  customerInvoiceLinesTable,
  invoicesTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  salesOrdersTable,
  salesOrderLinesTable,
  companiesTable,
  userCompaniesTable,
  intercompanyLinksTable,
  auditLogsTable,
  creditNotesTable,
  creditNoteLinesTable,
  db as defaultDb,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { logger } from "./logger";

/**
 * Drizzle transaction handle compatible with both `db` and `db.transaction`
 * inner callback. Mirror functions accept this so they always run inside the
 * caller's transaction (transactional integrity guardrail of Phase 5).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = typeof defaultDb | PgTransaction<any, any, any>;

export interface MirrorActor {
  userId: number | null;
  userName: string | null;
}

export class IntercompanyMirrorError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "IntercompanyMirrorError";
  }
}

/**
 * Phase-5 permission guard. Mirroring writes data to a sibling company,
 * so the active user MUST hold finance-capable access (owner / manager /
 * accountant) on BOTH the source and target companies. Throws
 * `IntercompanyMirrorError('FORBIDDEN', ...)` otherwise.
 */
async function assertCrossCompanyFinanceAccess(
  tx: Tx,
  actor: MirrorActor,
  sourceCompanyId: number,
  targetCompanyId: number,
): Promise<void> {
  if (!actor.userId) {
    throw new IntercompanyMirrorError("FORBIDDEN", "intercompany mirror requires an authenticated user");
  }
  const rows = await tx
    .select({ companyId: userCompaniesTable.companyId, role: userCompaniesTable.role })
    .from(userCompaniesTable)
    .where(
      and(
        eq(userCompaniesTable.userId, actor.userId),
        inArray(userCompaniesTable.companyId, [sourceCompanyId, targetCompanyId]),
      ),
    );
  const allowed = new Set(["owner", "manager", "accountant"]);
  const byCompany = new Map(rows.map((r) => [r.companyId, r.role]));
  for (const cid of [sourceCompanyId, targetCompanyId]) {
    const role = byCompany.get(cid);
    if (!role || !allowed.has(role)) {
      throw new IntercompanyMirrorError(
        "FORBIDDEN",
        `intercompany mirror denied: user lacks finance role on company ${cid}`,
      );
    }
  }
}

/**
 * Find an existing supplier in `targetCompanyId` that represents
 * `sourceCompanyId` (linked_company_id = source). If none exists we
 * auto-provision one using the source company's display name — this
 * is the recommended manual setup, but auto-create avoids breaking the
 * issuing transaction the first time an intercompany invoice is raised.
 */
async function resolveCounterpartySupplier(
  tx: Tx,
  targetCompanyId: number,
  sourceCompanyId: number,
): Promise<number> {
  const [existing] = await tx
    .select({ id: suppliersTable.id })
    .from(suppliersTable)
    .where(
      and(
        eq(suppliersTable.companyId, targetCompanyId),
        eq(suppliersTable.linkedCompanyId, sourceCompanyId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [sourceCo] = await tx
    .select({ name: companiesTable.name, vat: companiesTable.vatNumber })
    .from(companiesTable)
    .where(eq(companiesTable.id, sourceCompanyId));
  if (!sourceCo) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", `source company ${sourceCompanyId} not found`);
  }
  const [created] = await tx
    .insert(suppliersTable)
    .values({
      companyId: targetCompanyId,
      linkedCompanyId: sourceCompanyId,
      name: sourceCo.name,
      vatNumber: sourceCo.vat ?? null,
      notes: "Auto-created by intercompany mirror",
    })
    .returning({ id: suppliersTable.id });
  if (!created) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", "failed to provision counterparty supplier");
  }
  return created.id;
}

/**
 * Reverse direction: find a customer in `targetCompanyId` that represents
 * `sourceCompanyId`, auto-creating one when none exists.
 */
async function resolveCounterpartyCustomer(
  tx: Tx,
  targetCompanyId: number,
  sourceCompanyId: number,
): Promise<{ id: number; name: string }> {
  const [existing] = await tx
    .select({ id: customersTable.id, name: customersTable.name })
    .from(customersTable)
    .where(
      and(
        eq(customersTable.companyId, targetCompanyId),
        eq(customersTable.linkedCompanyId, sourceCompanyId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [sourceCo] = await tx
    .select({ name: companiesTable.name, vat: companiesTable.vatNumber })
    .from(companiesTable)
    .where(eq(companiesTable.id, sourceCompanyId));
  if (!sourceCo) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", `source company ${sourceCompanyId} not found`);
  }
  const [created] = await tx
    .insert(customersTable)
    .values({
      companyId: targetCompanyId,
      linkedCompanyId: sourceCompanyId,
      name: sourceCo.name,
      taxNumber: sourceCo.vat ?? null,
    })
    .returning({ id: customersTable.id, name: customersTable.name });
  if (!created) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", "failed to provision counterparty customer");
  }
  return created;
}

async function writeAudit(
  tx: Tx,
  actor: MirrorActor,
  companyId: number,
  action: string,
  details: string,
): Promise<void> {
  await tx.insert(auditLogsTable).values({
    userId: actor.userId,
    userName: actor.userName ?? "نظام",
    action,
    entity: "intercompany_link",
    details,
    ipAddress: "internal",
    severity: "info",
    companyId,
  });
}

export interface MirrorSalesInvoiceInput {
  invoiceId: number;
  sourceCompanyId: number;
  actor: MirrorActor;
  tx?: Tx;
}

/**
 * Phase-5 mirror: customer invoice in source company → supplier invoice
 * in target (linked) company. Idempotent: if the link already exists the
 * existing row is returned untouched.
 *
 * Guardrails:
 *   - Caller MUST run this inside the same transaction that created the
 *     source invoice (`tx` arg) so a mirror failure rolls back the source.
 *   - Loops are prevented by skipping invoices already flagged
 *     `isIntercompany`.
 *   - Writes use the provided `tx` directly (bypassing scopedDb) and
 *     explicitly stamp `companyId = targetCompanyId` on every row.
 */
export async function mirrorSalesInvoice(
  input: MirrorSalesInvoiceInput,
): Promise<{ linkId: number; targetInvoiceId: number } | null> {
  const tx = input.tx ?? (defaultDb as unknown as Tx);
  const [inv] = await tx
    .select()
    .from(customerInvoicesTable)
    .where(eq(customerInvoicesTable.id, input.invoiceId));
  if (!inv) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", `sales invoice ${input.invoiceId} not found`);
  }
  if (inv.isIntercompany) return null; // loop guard

  const [customer] = await tx
    .select({ linkedCompanyId: customersTable.linkedCompanyId, name: customersTable.name })
    .from(customersTable)
    .where(eq(customersTable.id, inv.customerId));
  if (!customer?.linkedCompanyId) return null; // not an intercompany customer

  const targetCompanyId = customer.linkedCompanyId;
  if (targetCompanyId === input.sourceCompanyId) {
    throw new IntercompanyMirrorError(
      "INVALID_REFERENCE",
      "customer.linkedCompanyId equals source company — self-mirror not allowed",
    );
  }

  await assertCrossCompanyFinanceAccess(tx, input.actor, input.sourceCompanyId, targetCompanyId);

  // Idempotency: existing link wins.
  const [existingLink] = await tx
    .select()
    .from(intercompanyLinksTable)
    .where(
      and(
        eq(intercompanyLinksTable.kind, "sales_invoice"),
        eq(intercompanyLinksTable.sourceDocId, inv.id),
      ),
    );
  if (existingLink) {
    return { linkId: existingLink.id, targetInvoiceId: existingLink.targetDocId };
  }

  const supplierId = await resolveCounterpartySupplier(tx, targetCompanyId, input.sourceCompanyId);
  const lines = await tx
    .select()
    .from(customerInvoiceLinesTable)
    .where(eq(customerInvoiceLinesTable.invoiceId, inv.id));

  const [sourceCo] = await tx
    .select({ name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, input.sourceCompanyId));

  const mirrorInvoiceNumber = `IC-${inv.reference}-C${targetCompanyId}`;
  const linesPayload = lines.map((l) => ({
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    taxRate: Number(l.taxRate),
    lineTotal: Number(l.lineTotal),
  }));
  const notesBlob = JSON.stringify({
    mirrorOf: { kind: "sales_invoice", id: inv.id, reference: inv.reference },
    subtotal: Number(inv.subtotal),
    vat: Number(inv.vat),
    discount: Number(inv.discount),
    total: Number(inv.total),
    lines: linesPayload,
  });

  const [mirror] = await tx
    .insert(invoicesTable)
    .values({
      invoiceNumber: mirrorInvoiceNumber,
      supplierId,
      supplierName: sourceCo?.name ?? "Intercompany",
      amount: String(Number(inv.total).toFixed(2)),
      status: "pending",
      invoiceDate: inv.invoiceDate ? new Date(inv.invoiceDate) : new Date(),
      dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
      notes: notesBlob,
      isLocked: false,
      companyId: targetCompanyId,
      isIntercompany: true,
      counterpartyCompanyId: input.sourceCompanyId,
    })
    .returning({ id: invoicesTable.id });
  if (!mirror) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", "failed to insert mirror supplier invoice");
  }

  // Stamp counterpartyCompanyId on the source for symmetry.
  await tx
    .update(customerInvoicesTable)
    .set({ counterpartyCompanyId: targetCompanyId })
    .where(eq(customerInvoicesTable.id, inv.id));

  const [link] = await tx
    .insert(intercompanyLinksTable)
    .values({
      kind: "sales_invoice",
      sourceCompanyId: input.sourceCompanyId,
      sourceDocId: inv.id,
      sourceRef: inv.reference,
      targetCompanyId,
      targetDocId: mirror.id,
      targetRef: mirrorInvoiceNumber,
      status: "matched",
    })
    .returning({ id: intercompanyLinksTable.id });
  if (!link) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", "failed to insert intercompany link");
  }

  await writeAudit(
    tx,
    input.actor,
    input.sourceCompanyId,
    "intercompany_mirror_created",
    `Intercompany mirror created: ${inv.reference} → ${mirrorInvoiceNumber} (company ${targetCompanyId})`,
  );

  // Phase 3 — Transfer Pricing & Agreement guardrail. Non-blocking:
  // an alert is raised on a >±15% deviation and again if no active
  // intercompany agreement covers the pair on the invoice date.
  try {
    const { runTransferPricingCheck } = await import("./compliance/transfer-pricing");
    await runTransferPricingCheck({
      tx,
      sourceCompanyId: input.sourceCompanyId,
      targetCompanyId,
      refType: "sales_invoice",
      refId: inv.id,
      ref: inv.reference,
      refDate: inv.invoiceDate ? new Date(inv.invoiceDate) : new Date(),
      lines: lines.map((l) => ({
        productId: l.productId ?? null,
        description: l.description,
        unitPrice: Number(l.unitPrice),
        quantity: Number(l.quantity),
      })),
    });
  } catch (err) {
    // Compliance failures must NOT roll back the mirror.
    logger.warn(
      { err, sourceCompanyId: input.sourceCompanyId, targetCompanyId, refType: "sales_invoice", refId: inv.id },
      "transfer-pricing check failed; mirror committed without compliance alert",
    );
  }

  return { linkId: link.id, targetInvoiceId: mirror.id };
}

export interface MirrorPurchaseOrderInput {
  poId: number;
  sourceCompanyId: number;
  actor: MirrorActor;
  tx?: Tx;
}

/**
 * Phase-5 mirror: purchase order in source company → sales order in
 * target (linked) company. Same guardrails as mirrorSalesInvoice.
 */
export async function mirrorPurchaseOrder(
  input: MirrorPurchaseOrderInput,
): Promise<{ linkId: number; targetSoId: number } | null> {
  const tx = input.tx ?? (defaultDb as unknown as Tx);
  const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, input.poId));
  if (!po) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", `purchase order ${input.poId} not found`);
  }
  if (po.isIntercompany) return null;

  const [supplier] = await tx
    .select({ linkedCompanyId: suppliersTable.linkedCompanyId })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, po.supplierId));
  if (!supplier?.linkedCompanyId) return null;

  const targetCompanyId = supplier.linkedCompanyId;
  if (targetCompanyId === input.sourceCompanyId) {
    throw new IntercompanyMirrorError(
      "INVALID_REFERENCE",
      "supplier.linkedCompanyId equals source company — self-mirror not allowed",
    );
  }

  await assertCrossCompanyFinanceAccess(tx, input.actor, input.sourceCompanyId, targetCompanyId);

  const [existingLink] = await tx
    .select()
    .from(intercompanyLinksTable)
    .where(
      and(
        eq(intercompanyLinksTable.kind, "purchase_order"),
        eq(intercompanyLinksTable.sourceDocId, po.id),
      ),
    );
  if (existingLink) {
    return { linkId: existingLink.id, targetSoId: existingLink.targetDocId };
  }

  const customer = await resolveCounterpartyCustomer(tx, targetCompanyId, input.sourceCompanyId);
  const lines = await tx
    .select()
    .from(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.poId, po.id));

  const mirrorRef = `IC-${po.reference}-C${targetCompanyId}`;
  const [so] = await tx
    .insert(salesOrdersTable)
    .values({
      reference: mirrorRef,
      customerId: customer.id,
      customerName: customer.name,
      status: "confirmed",
      orderDate: po.orderDate,
      expectedDate: po.expectedDate,
      currencyCode: po.currencyCode,
      subtotal: String(po.subtotal),
      discount: "0",
      vat: String(po.vat),
      total: String(po.total),
      notes: `Mirror of PO ${po.reference} (intercompany)`,
      source: "manual",
    })
    .returning({ id: salesOrdersTable.id });
  if (!so) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", "failed to insert mirror sales order");
  }

  for (const ln of lines) {
    await tx.insert(salesOrderLinesTable).values({
      soId: so.id,
      productId: ln.productId,
      description: ln.description,
      quantity: String(ln.quantity),
      unitPrice: String(ln.unitPrice),
      taxRate: String(ln.taxRate),
      lineTotal: String(ln.lineTotal),
    });
  }

  await tx
    .update(purchaseOrdersTable)
    .set({ counterpartyCompanyId: targetCompanyId })
    .where(eq(purchaseOrdersTable.id, po.id));

  const [link] = await tx
    .insert(intercompanyLinksTable)
    .values({
      kind: "purchase_order",
      sourceCompanyId: input.sourceCompanyId,
      sourceDocId: po.id,
      sourceRef: po.reference,
      targetCompanyId,
      targetDocId: so.id,
      targetRef: mirrorRef,
      status: "matched",
    })
    .returning({ id: intercompanyLinksTable.id });
  if (!link) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", "failed to insert intercompany link");
  }

  await writeAudit(
    tx,
    input.actor,
    input.sourceCompanyId,
    "intercompany_mirror_created",
    `Intercompany mirror created: PO ${po.reference} → SO ${mirrorRef} (company ${targetCompanyId})`,
  );

  // Phase 3 — Transfer Pricing & Agreement guardrail (PO leg).
  try {
    const { runTransferPricingCheck } = await import("./compliance/transfer-pricing");
    await runTransferPricingCheck({
      tx,
      sourceCompanyId: input.sourceCompanyId,
      targetCompanyId,
      refType: "purchase_order",
      refId: po.id,
      ref: po.reference,
      refDate: po.orderDate ? new Date(po.orderDate) : new Date(),
      lines: lines.map((l) => ({
        productId: l.productId ?? null,
        description: l.description,
        unitPrice: Number(l.unitPrice),
        quantity: Number(l.quantity),
      })),
    });
  } catch (err) {
    logger.warn(
      { err, sourceCompanyId: input.sourceCompanyId, targetCompanyId, refType: "purchase_order", refId: po.id },
      "transfer-pricing check failed; mirror committed without compliance alert",
    );
  }

  return { linkId: link.id, targetSoId: so.id };
}

/**
 * Void an existing mirror link. The mirror document is "neutralised"
 * (status flipped to cancelled-equivalent) and the link is marked void.
 * Used when the source document is reversed/cancelled.
 */
export async function voidMirror(linkId: number, actor: MirrorActor): Promise<void> {
  await defaultDb.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Tx;
    const [link] = await tx
      .select()
      .from(intercompanyLinksTable)
      .where(eq(intercompanyLinksTable.id, linkId));
    if (!link) {
      throw new IntercompanyMirrorError("INVALID_REFERENCE", `link ${linkId} not found`);
    }
    if (link.status === "void") return;

    await assertCrossCompanyFinanceAccess(tx, actor, link.sourceCompanyId, link.targetCompanyId);

    if (link.kind === "sales_invoice") {
      await tx
        .update(invoicesTable)
        .set({ status: "cancelled", notes: sql`coalesce(${invoicesTable.notes}, '') || ' [intercompany void]'` })
        .where(eq(invoicesTable.id, link.targetDocId));
    } else if (link.kind === "purchase_order") {
      await tx
        .update(salesOrdersTable)
        .set({ status: "cancelled" })
        .where(eq(salesOrdersTable.id, link.targetDocId));
    }
    await tx
      .update(intercompanyLinksTable)
      .set({ status: "void", updatedAt: new Date() })
      .where(eq(intercompanyLinksTable.id, linkId));

    await writeAudit(
      tx,
      actor,
      link.sourceCompanyId,
      "intercompany_mirror_voided",
      `Voided intercompany mirror ${link.sourceRef} → ${link.targetRef}`,
    );
  });
}

/**
 * Internal helper: void a mirror for a given source document inside the
 * caller's transaction. Used by source-side cancel/reverse routes that
 * already authorised the actor on the source company — we deliberately
 * skip the cross-company access check because the mirror cascade must
 * always succeed when the source-side action succeeds (otherwise the
 * sibling company is left stranded with a live mirror of a cancelled
 * source). Idempotent: no-op when no link exists or the link is already
 * void. Returns the link row that was voided, if any.
 */
export async function voidMirrorForSourceTx(
  tx: Tx,
  kind: "sales_invoice" | "purchase_order" | "credit_note",
  sourceDocId: number,
  actor: MirrorActor,
): Promise<{ linkId: number; targetDocId: number } | null> {
  const [link] = await tx
    .select()
    .from(intercompanyLinksTable)
    .where(
      and(
        eq(intercompanyLinksTable.kind, kind),
        eq(intercompanyLinksTable.sourceDocId, sourceDocId),
      ),
    );
  if (!link) return null;
  if (link.status === "void") {
    return { linkId: link.id, targetDocId: link.targetDocId };
  }

  if (link.kind === "sales_invoice" || link.kind === "credit_note") {
    await tx
      .update(invoicesTable)
      .set({
        status: "cancelled",
        notes: sql`coalesce(${invoicesTable.notes}, '') || ' [intercompany void]'`,
      })
      .where(eq(invoicesTable.id, link.targetDocId));
  } else if (link.kind === "purchase_order") {
    await tx
      .update(salesOrdersTable)
      .set({ status: "cancelled" })
      .where(eq(salesOrdersTable.id, link.targetDocId));
  }

  await tx
    .update(intercompanyLinksTable)
    .set({ status: "void", updatedAt: new Date() })
    .where(eq(intercompanyLinksTable.id, link.id));

  await writeAudit(
    tx,
    actor,
    link.sourceCompanyId,
    "intercompany_mirror_voided",
    `Auto-voided intercompany mirror ${link.sourceRef} → ${link.targetRef} (source cancelled/reversed)`,
  );
  return { linkId: link.id, targetDocId: link.targetDocId };
}

export interface MirrorCreditNoteInput {
  noteId: number;
  sourceCompanyId: number;
  actor: MirrorActor;
  tx?: Tx;
}

/**
 * Phase-5 mirror: credit note in source company → debit note (negative
 * supplier invoice) in target (linked) company. Only fires when the
 * underlying customer invoice has an existing sales_invoice mirror link
 * — a free-form CN against a non-mirrored invoice has no counterparty
 * to mirror to and is silently skipped.
 *
 * The debit note is persisted as a row in `invoices` (supplier invoices)
 * with a negative `amount`, `status='cancelled'` to signal it's a
 * contra-document, and `isIntercompany=true`. Linked via
 * `intercompany_links.kind='credit_note'` so /intercompany page can
 * surface it next to the original sales-invoice mirror.
 */
export async function mirrorCreditNote(
  input: MirrorCreditNoteInput,
): Promise<{ linkId: number; targetDocId: number } | null> {
  const tx = input.tx ?? (defaultDb as unknown as Tx);
  const [note] = await tx
    .select()
    .from(creditNotesTable)
    .where(eq(creditNotesTable.id, input.noteId));
  if (!note) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", `credit note ${input.noteId} not found`);
  }
  if (!note.invoiceId) return null;

  // Mirror only when the underlying customer invoice was itself mirrored.
  const [invLink] = await tx
    .select()
    .from(intercompanyLinksTable)
    .where(
      and(
        eq(intercompanyLinksTable.kind, "sales_invoice"),
        eq(intercompanyLinksTable.sourceDocId, note.invoiceId),
      ),
    );
  if (!invLink) return null;
  const targetCompanyId = invLink.targetCompanyId;
  if (targetCompanyId === input.sourceCompanyId) return null;

  // Idempotency.
  const [existingLink] = await tx
    .select()
    .from(intercompanyLinksTable)
    .where(
      and(
        eq(intercompanyLinksTable.kind, "credit_note"),
        eq(intercompanyLinksTable.sourceDocId, note.id),
      ),
    );
  if (existingLink) {
    return { linkId: existingLink.id, targetDocId: existingLink.targetDocId };
  }

  // No cross-company access check here: the parent sales_invoice mirror
  // was already authorised at creation time, and finalize/approval flows
  // for credit notes can run without an HTTP session (e.g. workflow
  // onApprove callbacks with actor.userId=null). Treat this as a trusted
  // internal cascade — same rationale as voidMirrorForSourceTx.

  const supplierId = await resolveCounterpartySupplier(tx, targetCompanyId, input.sourceCompanyId);
  const [sourceCo] = await tx
    .select({ name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, input.sourceCompanyId));

  const cnLines = await tx
    .select()
    .from(creditNoteLinesTable)
    .where(eq(creditNoteLinesTable.noteId, note.id));
  const linesPayload = cnLines.map((l) => ({
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    taxRate: Number(l.taxRate),
    lineTotal: Number(l.lineTotal),
  }));
  const mirrorRef = `IC-${note.reference}-C${targetCompanyId}`;
  const notesBlob = JSON.stringify({
    mirrorOf: { kind: "credit_note", id: note.id, reference: note.reference },
    debitNoteAgainst: invLink.targetRef,
    subtotal: Number(note.subtotal),
    vat: Number(note.vat),
    total: Number(note.total),
    lines: linesPayload,
  });

  const [mirror] = await tx
    .insert(invoicesTable)
    .values({
      invoiceNumber: mirrorRef,
      supplierId,
      supplierName: sourceCo?.name ?? "Intercompany",
      amount: String((-Number(note.total)).toFixed(2)),
      status: "cancelled",
      invoiceDate: note.noteDate ? new Date(note.noteDate) : new Date(),
      dueDate: null,
      notes: notesBlob,
      isLocked: false,
      companyId: targetCompanyId,
      isIntercompany: true,
      counterpartyCompanyId: input.sourceCompanyId,
    })
    .returning({ id: invoicesTable.id });
  if (!mirror) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", "failed to insert mirror debit note");
  }

  const [link] = await tx
    .insert(intercompanyLinksTable)
    .values({
      kind: "credit_note",
      sourceCompanyId: input.sourceCompanyId,
      sourceDocId: note.id,
      sourceRef: note.reference,
      targetCompanyId,
      targetDocId: mirror.id,
      targetRef: mirrorRef,
      status: "matched",
    })
    .returning({ id: intercompanyLinksTable.id });
  if (!link) {
    throw new IntercompanyMirrorError("INVALID_REFERENCE", "failed to insert intercompany credit-note link");
  }

  await writeAudit(
    tx,
    input.actor,
    input.sourceCompanyId,
    "intercompany_mirror_created",
    `Intercompany debit-note mirror created: CN ${note.reference} → ${mirrorRef} (company ${targetCompanyId})`,
  );
  return { linkId: link.id, targetDocId: mirror.id };
}

/**
 * Force-resync a mirror: re-emit the mirror document from the current
 * source state. Implemented as void + re-create so we never silently
 * mutate a posted document in a sibling company.
 */
export async function resyncMirror(linkId: number, actor: MirrorActor): Promise<void> {
  await defaultDb.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Tx;
    const [link] = await tx
      .select()
      .from(intercompanyLinksTable)
      .where(eq(intercompanyLinksTable.id, linkId));
    if (!link) {
      throw new IntercompanyMirrorError("INVALID_REFERENCE", `link ${linkId} not found`);
    }
    await assertCrossCompanyFinanceAccess(tx, actor, link.sourceCompanyId, link.targetCompanyId);

    // Neutralise current mirror.
    if (link.kind === "sales_invoice") {
      await tx
        .update(invoicesTable)
        .set({ status: "cancelled" })
        .where(eq(invoicesTable.id, link.targetDocId));
    } else if (link.kind === "purchase_order") {
      await tx
        .update(salesOrdersTable)
        .set({ status: "cancelled" })
        .where(eq(salesOrdersTable.id, link.targetDocId));
    }

    // Drop the link so the re-mirror call below is allowed to create a new one.
    await tx.delete(intercompanyLinksTable).where(eq(intercompanyLinksTable.id, linkId));

    if (link.kind === "sales_invoice") {
      await mirrorSalesInvoice({
        invoiceId: link.sourceDocId,
        sourceCompanyId: link.sourceCompanyId,
        actor,
        tx,
      });
    } else if (link.kind === "purchase_order") {
      await mirrorPurchaseOrder({
        poId: link.sourceDocId,
        sourceCompanyId: link.sourceCompanyId,
        actor,
        tx,
      });
    }

    await writeAudit(
      tx,
      actor,
      link.sourceCompanyId,
      "intercompany_mirror_resynced",
      `Resynced intercompany mirror ${link.sourceRef} → ${link.targetRef}`,
    );
  });
}
