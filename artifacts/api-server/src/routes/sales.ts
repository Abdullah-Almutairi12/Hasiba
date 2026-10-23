import { Router, type RequestHandler } from "express";
import { returnRequestGuard, returnInvoiceBranch, returnAuthorize, returnPolicy, returnFingerprint, assertReturnSnapshot } from "../lib/return-access";
import { z } from "zod";
import {
  db,
  customersTable,
  productsTable,
  warehousesTable,
  pricelistsTable,
  pricelistItemsTable,
  discountRulesTable,
  commissionPlansTable,
  salesRepAssignmentsTable,
  quotationsTable,
  quotationLinesTable,
  salesOrdersTable,
  salesOrderLinesTable,
  deliveryOrdersTable,
  deliveryOrderLinesTable,
  customerInvoicesTable,
  journalEntriesTable,
  customerInvoiceLinesTable,
  customerReceiptsTable,
  customerReceiptAllocationsTable,
  creditNotesTable,
  creditNoteLinesTable,
  usersTable,
  companiesTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { handleRouteError } from "../lib/handle-error";
import { parsePagination } from "../lib/pagination";
import { recordAudit } from "../lib/audit";
import {
  adminGuard,
  financeGuard,
  salesWriteGuard,
  customerReadGuard,
  reportReadGuard,
} from "../middlewares/require-role";
import {
  computeTotals,
  nextRef,
  resolveCustomerPricelist,
  resolvePrice,
  applyDiscountRules,
  applyLineDiscountRules,
} from "../lib/sales-engine";
import { postJournalEntry, reverseJournalEntry, ClosedPeriodError } from "../lib/journal-posting";
import { getCompanyId } from "../lib/scoped-db";
import { financialTransaction, FinancialRequestError } from "../lib/financial-transaction";
import { buildZatcaQrBase64 } from "../lib/zatca-qr";
import { captureIssuer, saveIssuer, documentIssuer } from "../lib/document-identity";
import { recordSaleSellers, recordReturnSellers, cancelSellerInvoice,savedSellerLines,sellerLineDescription } from "../lib/seller-ledger";
import { resolveSellerBranch } from "../lib/seller-policy";
import { returnActor } from "../lib/return-access";
import { printableIssuer } from "../lib/pdf/print-company";
import { getCompanyInfo } from "../lib/pdf/purchase-order";
import { getPrintCompany } from "../lib/pdf/print-company";
import { buildCustomerInvoicePdf } from "../lib/pdf/business-documents";
import QRCode from "qrcode";
import { processInvoiceForZatca } from "../lib/integrations/zatca-phase2";
import { createAwb } from "../lib/integrations/shipping";
import { sendMessage } from "../lib/integrations/messaging";
import { sendByTemplate } from "../lib/integrations/messaging-templates";
import { buildSignedInvoiceQrPath } from "./integrations";
import { recordStockMove, getDefaultWarehouseId } from "../lib/stock-engine";
import { allocateDeliveryIssueCost, originalInvoiceRate, restoreOriginalSaleCost } from "../lib/sales-return-cost";
import { cancelPostedSalesReturn } from "../lib/sales-return-cancellation";
import { requireSupplyReference } from "../lib/supply-chain-scope";
import type { DbOrTx } from "../lib/journal-posting";
import { mirrorSalesInvoice, mirrorCreditNote, voidMirrorForSourceTx } from "../lib/intercompany-mirror";
import {
  sendMail,
  isMailerConfigured,
  recipientStatusesFromDispatch,
} from "../lib/mailer";
import { MAX_ATTEMPTS as INVOICE_EMAIL_MAX_ATTEMPTS } from "../lib/invoice-email-retry-worker";
import { warehousesTable as _warehousesTable } from "@workspace/db";
import {
  submitForApproval,
  registerOnApprove,
  registerOnReject,
  requireFinancialLimit,
  triggerEvent,
} from "../lib/workflow-engine";
import { logger } from "../lib/logger";

const router = Router();

async function validateCreditNoteInventory(
  tx: DbOrTx,
  companyId: number,
  warehouseId: number | null | undefined,
  lines: ReadonlyArray<{ productId?: number | null }>,
): Promise<void> {
  if (warehouseId != null) await requireSupplyReference("warehouse", warehouseId, companyId, tx);
  const productIds = new Set(lines.flatMap(line => line.productId == null ? [] : [line.productId]));
  for (const productId of productIds) await requireSupplyReference("product", productId, companyId, tx);
}

// ---------------------------------------------------------------------------
// Workflow-engine integration: Sales Order confirm transition.
//   * When /sales/orders/:id/transition moves a draft → confirmed and the
//     workflow rule matches, we lock the SO into "pending_approval" and the
//     engine handles the approval chain.
//   * On approve we run finalizeSalesOrderConfirm (idempotent — accepts
//     both draft and pending_approval as input).
//   * On reject we revert to draft so the submitter can edit and resubmit.
// ---------------------------------------------------------------------------
async function finalizeSalesOrderConfirm(id: number): Promise<void> {
  const [so] = await db.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, id));
  if (!so) return;
  if (so.status !== "draft" && so.status !== "pending_approval") return;
  await db.update(salesOrdersTable).set({ status: "confirmed" }).where(eq(salesOrdersTable.id, id));
  void triggerEvent(so.companyId!, "state_changed", "sales_order", { id, total: Number(so.total) }, "confirmed");
}
registerOnApprove("sales_order", async (recordId) => {
  await finalizeSalesOrderConfirm(recordId);
});
registerOnReject("sales_order", async (recordId) => {
  try {
    await db
      .update(salesOrdersTable)
      .set({ status: "draft" })
      .where(eq(salesOrdersTable.id, recordId));
  } catch (err) {
    logger.error({ err, recordId }, "SO onReject revert failed");
  }
});

// ---------------------------------------------------------------------------
// Workflow-engine integration: Credit Note posting + cancellation.
//   * Posting (doc_type=credit_note): when an admin configures a posting
//     approval rule, the CN row + lines are persisted in status='draft'
//     but no JE / inventory restock / invoice settlement happens. After
//     approval, finalizeCreditNoteIssue runs and the CN flips to
//     status='issued'.
//   * Cancellation (doc_type=credit_note_cancel): destructive AR action
//     that can be gated separately. On approve we run the reversal JE +
//     inventory + SO recompute and set status='cancelled'.
// ---------------------------------------------------------------------------
// On approve we run the same finalize helper used by the route, so the
// reversal JE + stock compensation + invoice status recompute fire
// automatically once the chain completes (no second manual click).
async function finalizeCreditNoteCancellation(
  id: number,
  sessionUserId: number | null,
  companyId: number,
): Promise<typeof creditNotesTable.$inferSelect> {
  return await db.transaction(async (tx) => {
    const [note] = await tx.select().from(creditNotesTable).where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.companyId, companyId))).for("update");
    if (!note) throw Object.assign(new Error("Not found"), { status: 404 });
    const control = await tx.execute(sql`SELECT branch_id FROM return_controls WHERE note_id=${id} AND company_id=${companyId}`);
    if (control.rows[0]) await returnAuthorize(sessionUserId ?? -1, companyId, "request", Number(control.rows[0].branch_id), tx);
    const paidRefund = await tx.execute(sql`SELECT id FROM return_payouts WHERE note_id=${id} AND company_id=${companyId} AND status<>'cancelled' LIMIT 1`);
    if (paidRefund.rows.length) throw new FinancialRequestError("لا يمكن إلغاء مرتجع له صرف أو رد محجوز؛ يلزم تصحيح مالي مستقل", 409);
    if (note.status === "cancelled") throw new FinancialRequestError("الإشعار ملغى مسبقاً", 409);
    const posted = note.status === "issued" || note.status === "applied";
    if (!posted && note.status !== "draft" && note.status !== "pending_approval") {
      throw new FinancialRequestError("حالة الإشعار لا تسمح بالإلغاء", 409);
    }
    if (!posted && note.journalEntryId) {
      throw new FinancialRequestError("حالة الإشعار لا تتفق مع قيده؛ يلزم فحص مالي مستقل", 409);
    }
    if (note.invoiceId) {
      const [source] = await tx.select({ soId: customerInvoicesTable.soId }).from(customerInvoicesTable)
        .where(and(eq(customerInvoicesTable.id, note.invoiceId), eq(customerInvoicesTable.companyId, companyId)));
      if (source?.soId) {
        await tx.select({ id: salesOrdersTable.id }).from(salesOrdersTable)
          .where(and(eq(salesOrdersTable.id, source.soId), eq(salesOrdersTable.companyId, companyId))).for("update");
      }
      await tx.select({ id: customerInvoicesTable.id }).from(customerInvoicesTable)
        .where(and(eq(customerInvoicesTable.id, note.invoiceId), eq(customerInvoicesTable.companyId, companyId))).for("update");
    }

    const cnLines = await tx
      .select()
      .from(creditNoteLinesTable)
      .where(eq(creditNoteLinesTable.noteId, note.id));
    // Recheck persisted references as well as new input: older notes may
    // contain cross-company inventory links.
    await validateCreditNoteInventory(tx, note.companyId, note.warehouseId, cnLines);

    if (posted) await cancelPostedSalesReturn(tx, note, cnLines, sessionUserId);

    const touchedSoIds = new Set<number>();
    for (const cn of cnLines) {
      if (!posted) break; // Unissued drafts never changed fulfilment counters.
      if (!cn.invoiceLineId) continue;
      const [il] = await tx
        .select()
        .from(customerInvoiceLinesTable)
        .where(eq(customerInvoiceLinesTable.id, cn.invoiceLineId));
      if (!il?.soLineId) continue;
      const update: Record<string, unknown> = {
        invoicedQty: sql`${salesOrderLinesTable.invoicedQty}::numeric + ${Number(cn.quantity)}`,
      };
      if (note.restock) {
        update.deliveredQty = sql`${salesOrderLinesTable.deliveredQty}::numeric + ${Number(cn.quantity)}`;
      }
      await tx
        .update(salesOrderLinesTable)
        .set(update)
        .where(eq(salesOrderLinesTable.id, il.soLineId));
      const [sl] = await tx
        .select({ soId: salesOrderLinesTable.soId })
        .from(salesOrderLinesTable)
        .where(eq(salesOrderLinesTable.id, il.soLineId));
      if (sl?.soId) touchedSoIds.add(sl.soId);
    }
    for (const soId of touchedSoIds) {
      const sLines = await tx
        .select({
          qty: salesOrderLinesTable.quantity,
          inv: salesOrderLinesTable.invoicedQty,
          del: salesOrderLinesTable.deliveredQty,
        })
        .from(salesOrderLinesTable)
        .where(eq(salesOrderLinesTable.soId, soId));
      const allInvoiced = sLines.every((l) => Number(l.qty) - Number(l.inv) <= 1e-6);
      const allDelivered = sLines.every((l) => Number(l.qty) - Number(l.del) <= 1e-6);
      const next = allInvoiced && allDelivered ? "invoiced" : allDelivered ? "fully_delivered" : "partially_delivered";
      await tx.update(salesOrdersTable).set({ status: next }).where(eq(salesOrdersTable.id, soId));
    }

    const [updated] = await tx
      .update(creditNotesTable)
      .set({ status: "cancelled" })
      .where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.companyId, companyId)))
      .returning();
    await recordReturnSellers(tx,companyId,id,sessionUserId,true);

    // Mirror cascade: if this CN had a debit-note mirror in a sibling
    // company, void it inside the same transaction.
    await voidMirrorForSourceTx(tx, "credit_note", id, {
      userId: sessionUserId,
      userName: null,
    });

    if (note.invoiceId) {
      const [inv] = await tx
        .select()
        .from(customerInvoicesTable)
        .where(eq(customerInvoicesTable.id, note.invoiceId));
      if (inv) {
        const [{ creditsSum }] = await tx
          .select({
            creditsSum: sql<number>`coalesce(sum(${creditNotesTable.total}::numeric), 0)`,
          })
          .from(creditNotesTable)
          .where(
            and(
              eq(creditNotesTable.invoiceId, inv.id),
              inArray(creditNotesTable.status, ["issued", "applied"]),
            ),
          );
        const settled = Number(inv.amountPaid) + Number(creditsSum);
        const nextStatus =
          Number(inv.total) - settled <= 0.01
            ? "paid"
            : Number(inv.amountPaid) > 0
              ? "partially_paid"
              : "open";
        if (nextStatus !== inv.status) {
          await tx
            .update(customerInvoicesTable)
            .set({ status: nextStatus })
            .where(eq(customerInvoicesTable.id, inv.id));
        }
      }
    }
    void triggerEvent(updated.companyId!, "state_changed", "credit_note", { id, total: Number(updated.total) }, "cancelled");
    return updated;
  });
}
registerOnApprove("credit_note_cancel", async (recordId) => {
  // Rethrow on failure: actOnApproval rolls the request back to pending
  // and surfaces the error so workflow + document state stay consistent.
  try {
    // No HTTP session: use the note's saved company and require its
    // customer to agree before finalizing.
    const [row] = await db
      .select({ companyId: creditNotesTable.companyId })
      .from(creditNotesTable)
      .innerJoin(customersTable, and(eq(customersTable.id, creditNotesTable.customerId), eq(customersTable.companyId, creditNotesTable.companyId)))
      .where(eq(creditNotesTable.id, recordId))
      .limit(1);
    if (!row?.companyId) {
      throw new Error(`credit_note_cancel ${recordId}: cannot resolve companyId from customer`);
    }
    await finalizeCreditNoteCancellation(recordId, null, row.companyId);
  } catch (err) {
    logger.error({ err, recordId }, "credit_note_cancel onApprove finalize failed");
    throw err;
  }
});

// ---------------------------------------------------------------------------
// CN posting finalize: runs the JE + invoice settlement + SO line decrements
// for a draft credit note. Used both inline (no posting approval needed) and
// from the registerOnApprove("credit_note") handler when the admin has
// configured a credit_note approval rule.
// ---------------------------------------------------------------------------
async function finalizeCreditNoteIssue(
  noteId: number,
  sessionUserId: number | null,
  companyId: number,
): Promise<typeof creditNotesTable.$inferSelect> {
  return await db.transaction(async (tx) => {
    const [note] = await tx.select().from(creditNotesTable).where(and(eq(creditNotesTable.id, noteId), eq(creditNotesTable.companyId, companyId))).for("update");
    if (!note) throw new Error("الإشعار الدائن غير موجود");
    if (note.status === "issued" || note.status === "applied") return note;
    if (note.status !== "draft" && note.status !== "pending_approval") {
      throw new Error(`لا يمكن ترحيل إشعار في حالة ${note.status}`);
    }
    await assertReturnSnapshot(tx, note.id);
    // SO -> invoice -> issue movements: match invoicing/reversal lock order
    // while reserving or restoring partial-delivery cost allocations.
    if (note.invoiceId) {
      const [source] = await tx.select({ soId: customerInvoicesTable.soId }).from(customerInvoicesTable)
        .where(and(eq(customerInvoicesTable.id, note.invoiceId), eq(customerInvoicesTable.companyId, companyId)));
      if (source?.soId) {
        await tx.select({ id: salesOrdersTable.id }).from(salesOrdersTable)
          .where(and(eq(salesOrdersTable.id, source.soId), eq(salesOrdersTable.companyId, companyId))).for("update");
      }
      await tx.select({ id: customerInvoicesTable.id }).from(customerInvoicesTable)
        .where(and(eq(customerInvoicesTable.id, note.invoiceId), eq(customerInvoicesTable.companyId, companyId))).for("update");
    }
    const cnLines = await tx
      .select()
      .from(creditNoteLinesTable)
      .where(eq(creditNoteLinesTable.noteId, noteId));
    await validateCreditNoteInventory(tx, note.companyId, note.warehouseId, cnLines);
    if (note.restock && !note.warehouseId && cnLines.some((line) => line.productId != null)) {
      throw new FinancialRequestError("يلزم مستودع لإعادة المخزون المرتجع", 409);
    }
    let restockedCost = 0;
    const exchangeRate = await originalInvoiceRate(tx, companyId, note.invoiceId, note.currencyCode);
    // Restock — only if the CN was created with restock=true and a warehouse.
    if (note.restock && note.warehouseId) {
      restockedCost = await restoreOriginalSaleCost(tx, {
        companyId, invoiceId: note.invoiceId, noteId: note.id,
        warehouseId: note.warehouseId, reference: note.reference,
        createdBy: sessionUserId, lines: cnLines,
      });
    }
    // Post offsetting JE.
    const lines: Array<{ systemKey: string; debit?: number; credit?: number; description?: string }> = [
      { systemKey: "sales_returns", debit: Number(note.subtotal), description: "مردودات مبيعات" },
    ];
    if (Number(note.vat) > 0)
      lines.push({ systemKey: "vat_output", debit: Number(note.vat), description: "عكس ضريبة 15%" });
    if (Number(note.total) > 0)
      lines.push({ systemKey: "ar", credit: Number(note.total), description: "تسوية ذمم مدينة (إشعار دائن)" });
    if (restockedCost !== 0) {
      // A cancelled earlier slice may have carried a rounding cent. Allow
      // the cumulative allocation to release that cent in either direction.
      const debit = Math.max(0, restockedCost) / exchangeRate;
      const credit = Math.max(0, -restockedCost) / exchangeRate;
      lines.push({ systemKey: "inventory", debit, credit, description: "إعادة تكلفة المخزون المرتجع الأصلية" });
      lines.push({ systemKey: "cogs", credit: debit, debit: credit, description: "عكس تكلفة البضاعة المرتجعة الأصلية" });
    }
    const je = await postJournalEntry(
      tx,
      {
        entryDate: note.noteDate,
        currencyCode: note.currencyCode,
        exchangeRate,
        description: `إشعار دائن ${note.reference}`,
        reference: note.reference,
        source: "manual",
        sourceRef: note.reference,
        createdBy: sessionUserId,
        status: "posted",
        companyId,
      },
      lines,
    );
    await tx
      .update(creditNotesTable)
      .set({ journalEntryId: je.id, inventoryCost: String(restockedCost), status: "issued" })
      .where(eq(creditNotesTable.id, noteId));
    await saveIssuer(tx, "credit", noteId, await captureIssuer(tx, companyId));
    await recordReturnSellers(tx,companyId,noteId,sessionUserId);
    // Intercompany mirror: when the source customer invoice was itself
    // mirrored to a sibling company, emit a debit-note (negative supplier
    // invoice) in that sibling so AP and AR stay symmetric.
    await mirrorCreditNote({
      noteId,
      sourceCompanyId: companyId,
      actor: { userId: sessionUserId, userName: null },
      tx,
    });
    // Invoice + SO settlement.
    if (note.invoiceId) {
      const [inv] = await tx
        .select()
        .from(customerInvoicesTable)
        .where(eq(customerInvoicesTable.id, note.invoiceId));
      if (inv) {
        const [{ creditsSum }] = await tx
          .select({
            creditsSum: sql<number>`coalesce(sum(${creditNotesTable.total}::numeric), 0)`,
          })
          .from(creditNotesTable)
          .where(
            and(
              eq(creditNotesTable.invoiceId, inv.id),
              inArray(creditNotesTable.status, ["issued", "applied"]),
            ),
          );
        const settled = Number(inv.amountPaid) + Number(creditsSum);
        const fullySettled = Number(inv.total) - settled <= 0.01;
        if (fullySettled && inv.status !== "paid") {
          await tx
            .update(customerInvoicesTable)
            .set({ status: "paid" })
            .where(eq(customerInvoicesTable.id, inv.id));
        }
        const touchedSoIds = new Set<number>();
        for (const cn of cnLines) {
          if (!cn.invoiceLineId) continue;
          const [il] = await tx
            .select()
            .from(customerInvoiceLinesTable)
            .where(eq(customerInvoiceLinesTable.id, cn.invoiceLineId));
          if (!il?.soLineId) continue;
          const update: Record<string, unknown> = {
            invoicedQty: sql`GREATEST(0, ${salesOrderLinesTable.invoicedQty}::numeric - ${Number(cn.quantity)})`,
          };
          if (note.restock) {
            update.deliveredQty = sql`GREATEST(0, ${salesOrderLinesTable.deliveredQty}::numeric - ${Number(cn.quantity)})`;
          }
          await tx
            .update(salesOrderLinesTable)
            .set(update)
            .where(eq(salesOrderLinesTable.id, il.soLineId));
          const [sl] = await tx
            .select({ soId: salesOrderLinesTable.soId })
            .from(salesOrderLinesTable)
            .where(eq(salesOrderLinesTable.id, il.soLineId));
          if (sl?.soId) touchedSoIds.add(sl.soId);
        }
        for (const soId of touchedSoIds) {
          const sLines = await tx
            .select({
              qty: salesOrderLinesTable.quantity,
              inv: salesOrderLinesTable.invoicedQty,
              del: salesOrderLinesTable.deliveredQty,
            })
            .from(salesOrderLinesTable)
            .where(eq(salesOrderLinesTable.soId, soId));
          const allInvoiced = sLines.every((l) => Number(l.qty) - Number(l.inv) <= 1e-6);
          const allDelivered = sLines.every((l) => Number(l.qty) - Number(l.del) <= 1e-6);
          const anyDelivered = sLines.some((l) => Number(l.del) > 0);
          const next = allInvoiced && allDelivered
            ? "invoiced"
            : allDelivered
              ? "fully_delivered"
              : anyDelivered
                ? "partially_delivered"
                : "confirmed";
          await tx
            .update(salesOrdersTable)
            .set({ status: next })
            .where(eq(salesOrdersTable.id, soId));
        }
      }
    }
    const [updated] = await tx
      .select()
      .from(creditNotesTable)
      .where(eq(creditNotesTable.id, noteId));
    void triggerEvent(updated.companyId!, "state_changed", "credit_note", { id: noteId, total: Number(updated.total) }, "issued");
    return updated;
  });
}
registerOnApprove("credit_note", async (recordId) => {
  try {
    // No HTTP session: use the note's saved company and require its
    // customer to agree before finalizing.
    const [row] = await db
      .select({ companyId: creditNotesTable.companyId })
      .from(creditNotesTable)
      .innerJoin(customersTable, and(eq(customersTable.id, creditNotesTable.customerId), eq(customersTable.companyId, creditNotesTable.companyId)))
      .where(eq(creditNotesTable.id, recordId))
      .limit(1);
    if (!row?.companyId) {
      throw new Error(`credit_note ${recordId}: cannot resolve companyId from customer`);
    }
    await finalizeCreditNoteIssue(recordId, null, row.companyId);
  } catch (err) {
    logger.error({ err, recordId }, "credit_note onApprove finalize failed");
    throw err;
  }
});
registerOnReject("credit_note", async (recordId) => {
  // Rejected posting → leave the row as a permanent draft so users can
  // see why it was filed but it has no AR/inventory side effects. Mark
  // explicitly cancelled so it doesn't appear in "draft" lists forever.
  try {
    await db
      .update(creditNotesTable)
      .set({ status: "cancelled" })
      .where(eq(creditNotesTable.id, recordId));
  } catch (err) {
    logger.error({ err, recordId }, "credit_note onReject finalize failed");
  }
});

// ===================================================================
// Pricelists
// ===================================================================
router.get("/sales/pricelists", customerReadGuard, async (req, res) => {
  try {
    const rows = await db.select().from(pricelistsTable).orderBy(desc(pricelistsTable.isDefault));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "list pricelists");
    handleRouteError(err, res);
  }
});

router.post("/sales/pricelists", adminGuard, async (req, res) => {
  try {
    const Body = z.object({
      name: z.string().min(1),
      nameAr: z.string().min(1),
      currencyCode: z.string().default("SAR"),
      segment: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      isActive: z.boolean().default(true),
      isDefault: z.boolean().default(false),
    });
    const body = Body.parse(req.body);
    const [row] = await db.insert(pricelistsTable).values(body).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "create pricelist");
    handleRouteError(err, res);
  }
});

router.get("/sales/pricelists/:id/items", customerReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const items = await db
      .select({
        id: pricelistItemsTable.id,
        pricelistId: pricelistItemsTable.pricelistId,
        productId: pricelistItemsTable.productId,
        productName: productsTable.nameAr,
        sku: productsTable.sku,
        minQuantity: pricelistItemsTable.minQuantity,
        unitPrice: pricelistItemsTable.unitPrice,
        discountPct: pricelistItemsTable.discountPct,
      })
      .from(pricelistItemsTable)
      .leftJoin(productsTable, eq(productsTable.id, pricelistItemsTable.productId))
      .where(eq(pricelistItemsTable.pricelistId, id));
    res.json(items.map((i) => ({
      ...i,
      minQuantity: Number(i.minQuantity),
      unitPrice: Number(i.unitPrice),
      discountPct: i.discountPct == null ? null : Number(i.discountPct),
    })));
  } catch (err) {
    req.log.error({ err }, "pricelist items");
    handleRouteError(err, res);
  }
});

router.post("/sales/pricelists/:id/items", adminGuard, async (req, res) => {
  try {
    const Body = z.object({
      productId: z.number().int().nullable().optional(),
      minQuantity: z.number().min(0).default(1),
      unitPrice: z.number().min(0).default(0),
      discountPct: z.number().min(0).max(100).nullable().optional(),
    });
    const body = Body.parse(req.body);
    const [row] = await db
      .insert(pricelistItemsTable)
      .values({
        pricelistId: Number(req.params.id),
        productId: body.productId ?? null,
        minQuantity: String(body.minQuantity),
        unitPrice: String(body.unitPrice),
        discountPct: body.discountPct == null ? null : String(body.discountPct),
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "add pricelist item");
    handleRouteError(err, res);
  }
});

router.delete("/sales/pricelists/items/:id", adminGuard, async (req, res) => {
  try {
    await db.delete(pricelistItemsTable).where(eq(pricelistItemsTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===================================================================
// Discount rules
// ===================================================================
router.get("/sales/discount-rules", customerReadGuard, async (req, res) => {
  try {
    const rows = await db.select().from(discountRulesTable);
    res.json(rows.map((r) => ({ ...r, value: Number(r.value) })));
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/sales/discount-rules", adminGuard, async (req, res) => {
  try {
    const Body = z.object({
      name: z.string().min(1),
      nameAr: z.string().min(1),
      kind: z.enum(["percent", "fixed"]).default("percent"),
      value: z.number().min(0).default(0),
      scope: z.enum(["line", "order"]).default("line"),
      reasonCode: z.string().min(1),
      accountSystemKey: z.string().default("sales_discount"),
      isActive: z.boolean().default(true),
    });
    const b = Body.parse(req.body);
    const [row] = await db
      .insert(discountRulesTable)
      .values({ ...b, value: String(b.value) })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===================================================================
// Commission plans + assignments
// ===================================================================
router.get("/sales/commission-plans", reportReadGuard, async (req, res) => {
  try {
    const rows = await db.select().from(commissionPlansTable).where(eq(commissionPlansTable.companyId,getCompanyId(req)));
    res.json(rows.map((r) => ({
      ...r,
      rate: Number(r.rate),
      quota: Number(r.quota),
      bonusRate: Number(r.bonusRate),
    })));
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/sales/commission-plans", adminGuard, async (req, res) => {
  try {
    const Body = z.object({
      name: z.string().min(1),
      rate: z.number().min(0).max(100).default(0),
      quota: z.number().min(0).default(0),
      bonusRate: z.number().min(0).max(100).default(0),
      isActive: z.boolean().default(true),
    });
    const b = Body.parse(req.body);
    const [row] = await db
      .insert(commissionPlansTable)
      .values({
        companyId:getCompanyId(req),
        name: b.name,
        rate: String(b.rate),
        quota: String(b.quota),
        bonusRate: String(b.bonusRate),
        isActive: b.isActive,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/sales/commission-plans/:id/assign", adminGuard, async (req, res) => {
  try {
    const Body = z.object({
      userId: z.number().int(),
      effectiveFrom: z.string(),
      effectiveTo: z.string().nullable().optional(),
    });
    const b = Body.parse(req.body);
    const allowed=await db.execute(sql`SELECT p.id FROM commission_plans p JOIN user_companies uc ON uc.company_id=p.company_id
      JOIN users u ON u.id=uc.user_id AND u.is_active WHERE p.id=${Number(req.params.id)} AND p.company_id=${getCompanyId(req)} AND uc.user_id=${b.userId}`);
    if(!allowed.rows.length)throw new FinancialRequestError("الخطة أو المندوب ليس ضمن الشركة",404);
    const [row] = await db
      .insert(salesRepAssignmentsTable)
      .values({
        userId: b.userId,
        planId: Number(req.params.id),
        effectiveFrom: b.effectiveFrom,
        effectiveTo: b.effectiveTo ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// Commission report — net revenue per rep over a period
router.get("/sales/commission-report", reportReadGuard, async (req, res) => {
  try {
    const Q = z.object({
      from: z.string(),
      to: z.string(),
    });
    const { from, to } = Q.parse(req.query);
    // net revenue = subtotal - discount on paid customer invoices in window
    const rows = await db
      .select({
        repId: customerInvoicesTable.salesRepId,
        repName: usersTable.name,
        netRevenue: sql<number>`coalesce(sum(${customerInvoicesTable.subtotal}::numeric - ${customerInvoicesTable.discount}::numeric), 0)`,
        invoiceCount: sql<number>`count(*)::int`,
      })
      .from(customerInvoicesTable)
      .leftJoin(usersTable, eq(usersTable.id, customerInvoicesTable.salesRepId))
      .where(
        and(
          gte(customerInvoicesTable.invoiceDate, from),
          eq(customerInvoicesTable.companyId, getCompanyId(req)),
          sql`NOT EXISTS (SELECT 1 FROM invoice_seller_lines a WHERE a.invoice_id=${customerInvoicesTable.id} AND a.company_id=${getCompanyId(req)})`,
          lte(customerInvoicesTable.invoiceDate, to),
          inArray(customerInvoicesTable.status, ["open", "partially_paid", "paid"]),
        ),
      )
      .groupBy(customerInvoicesTable.salesRepId, usersTable.name);

    const plans = await db.select().from(commissionPlansTable).where(and(eq(commissionPlansTable.isActive, true),eq(commissionPlansTable.companyId,getCompanyId(req))));
    const assignments = await db.select().from(salesRepAssignmentsTable).where(inArray(salesRepAssignmentsTable.planId,plans.map(p=>p.id)));
    const planById = new Map(plans.map((p) => [p.id, p]));
    function planFor(userId: number | null): typeof plans[number] | null {
      if (!userId) return null;
      const a = assignments.find((x) => x.userId === userId && x.effectiveFrom<=from && (!x.effectiveTo||x.effectiveTo>=to));
      if (!a) return null;
      return planById.get(a.planId) ?? null;
    }

    const out = rows.map((r) => {
      const net = Number(r.netRevenue);
      const plan = planFor(r.repId ?? null);
      const baseRate = Number(plan?.rate ?? 0);
      const quota = Number(plan?.quota ?? 0);
      const bonusRate = Number(plan?.bonusRate ?? 0);
      const baseComm = (net * baseRate) / 100;
      const bonusComm = net > quota && quota > 0 ? ((net - quota) * bonusRate) / 100 : 0;
      return {
        repId: r.repId,
        repName: r.repName ?? "غير محدد",
        invoiceCount: r.invoiceCount,
        netRevenue: net,
        planName: plan?.name ?? null,
        baseRate,
        bonusRate,
        commission: +(baseComm + bonusComm).toFixed(2),
      };
    });
    res.json({ from, to, rows: out, total: +out.reduce((a, x) => a + x.commission, 0).toFixed(2) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===================================================================
// Quotations
// ===================================================================
const QuoteLineBody = z.object({
  productId: z.number().int().nullable().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0).optional(),
  discountPct: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100).default(15),
});

const QuoteBody = z.object({
  customerId: z.number().int(),
  pricelistId: z.number().int().nullable().optional(),
  salesRepId: z.number().int().nullable().optional(),
  branchId: z.number().int().nullable().optional(),
  quoteDate: z.string().optional(),
  validUntil: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  orderDiscount: z.number().min(0).default(0),
  lines: z.array(QuoteLineBody).min(1),
});

router.get("/sales/quotations", customerReadGuard, async (req, res) => {
  try {
    const { status, customerId } = req.query;
    const rows = await db
      .select()
      .from(quotationsTable)
      .where(
        and(
          status ? eq(quotationsTable.status, String(status)) : sql`true`,
          eq(quotationsTable.companyId, getCompanyId(req)),
          customerId ? eq(quotationsTable.customerId, Number(customerId)) : sql`true`,
        ),
      )
      .orderBy(desc(quotationsTable.createdAt))
      .limit(200);
    // Surface the latest send attempt per quotation from sales_email_outbox
    // (kind='quotation') so the list can render a delivered / queued / failed
    // badge identical to customer invoices.
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
        FROM sales_email_outbox
        WHERE kind = 'quotation' AND ref_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        ORDER BY ref_id, created_at DESC, id DESC
      `);
      const lastRows = ((lastRes as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (lastRes as unknown as Array<Record<string, unknown>>)) ?? [];
      for (const r of lastRows) {
        const refId = Number((r as Record<string, unknown>)["refId"]);
        if (!Number.isFinite(refId)) continue;
        const createdAt = (r as Record<string, unknown>)["createdAt"];
        const sentAt = (r as Record<string, unknown>)["sentAt"];
        lastSendById.set(refId, {
          outboxId: Number((r as Record<string, unknown>)["outboxId"]),
          status: String((r as Record<string, unknown>)["status"] ?? ""),
          recipient: (r as Record<string, unknown>)["recipient"] == null
            ? null
            : String((r as Record<string, unknown>)["recipient"]),
          error: (r as Record<string, unknown>)["error"] == null
            ? null
            : String((r as Record<string, unknown>)["error"]),
          createdAt: createdAt instanceof Date
            ? createdAt.toISOString()
            : (createdAt as string | null) ?? null,
          sentAt: sentAt instanceof Date
            ? sentAt.toISOString()
            : (sentAt as string | null) ?? null,
        });
      }
    }
    res.json(rows.map((r) => ({
      ...(serializeMoneyDoc(r) as Record<string, unknown>),
      lastSend: lastSendById.get(r.id) ?? null,
    })));
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.get("/sales/quotations/:id", customerReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [head] = await db.select().from(quotationsTable).where(and(eq(quotationsTable.id, id), eq(quotationsTable.companyId, getCompanyId(req))));
    if (!head) { res.status(404).json({ error: "Not found" }); return; }
    const lines = await db.select().from(quotationLinesTable).where(eq(quotationLinesTable.quotationId, id));
    res.json({ ...serializeMoneyDoc(head), lines: lines.map(serializeLine) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/sales/quotations", salesWriteGuard, async (req, res) => {
  try {
    const body = QuoteBody.parse(req.body);
    const companyId = getCompanyId(req);
    const result = await db.transaction(async (tx) => {
      // Tenant scope: cross-tenant customerId resolves to 404 (hides existence).
      const [customer] = await tx
        .select()
        .from(customersTable)
        .where(and(eq(customersTable.id, body.customerId), eq(customersTable.companyId, companyId)));
      if (!customer) throw new Error("العميل غير موجود");
      const pricelistId = body.pricelistId ?? (await resolveCustomerPricelist(tx, customer.id));

      // VAT gating: a quotation for a non-registered tenant must never
      // promise VAT to the customer — clamp every line's taxRate to 0
      // before totals/persistence. Mirrors the same guard on POST
      // /sales/invoices so quote→SO→invoice carry zero VAT end-to-end.
      const [companyQuoteRow] = await tx
        .select({ vatRegistrationStatus: companiesTable.vatRegistrationStatus })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId))
        .limit(1);
      const vatEnabledQuote =
        companyQuoteRow?.vatRegistrationStatus === "registered" ||
        companyQuoteRow?.vatRegistrationStatus === "voluntary";

      // Resolve unit prices via pricelist when missing.
      const enriched = [] as Parameters<typeof computeTotals>[0];
      for (const ln of body.lines) {
        let unitPrice = ln.unitPrice;
        if ((unitPrice == null || unitPrice === 0) && ln.productId) {
          unitPrice = (await resolvePrice(tx, {
            productId: ln.productId,
            pricelistId,
            quantity: ln.quantity,
          })).unitPrice;
        }
        enriched.push({
          productId: ln.productId ?? null,
          description: ln.description,
          quantity: ln.quantity,
          unitPrice: unitPrice ?? 0,
          discountPct: ln.discountPct,
          taxRate: vatEnabledQuote ? ln.taxRate : 0,
        });
      }
      // Apply active line- then order-scope discount rules on top of the
      // user-entered order discount so the same promo/loyalty pricing flows
      // quote→SO→invoice with consistent reason-code → GL bucket mapping.
      const lineRules = await applyLineDiscountRules(tx, enriched);
      const baseNetPre = enriched.reduce(
        (a, l) => a + l.quantity * l.unitPrice * (1 - (l.discountPct ?? 0) / 100),
        0,
      );
      const ruleResult = await applyDiscountRules(tx, {
        baseNet: Math.max(0, baseNetPre - body.orderDiscount),
        scope: "order",
      });
      const totals = computeTotals(
        enriched,
        body.orderDiscount + ruleResult.discountAmount,
      );
      // Persist the rule snapshot so SO/invoice derived from this quote
      // can post per-rule discount accounts without re-running the engine.
      const appliedDiscounts = [
        ...lineRules.applied.map((r) => ({ ...r, scope: "line" as const })),
        ...ruleResult.applied.map((r) => ({ ...r, scope: "order" as const })),
      ];
      const reference = await nextRef(tx, "QUO");

      const [quote] = await tx
        .insert(quotationsTable)
        .values({
          companyId: getCompanyId(req),
          reference,
          customerId: customer.id,
          customerName: customer.name,
          pricelistId: pricelistId ?? null,
          salesRepId: body.salesRepId ?? req.session?.userId ?? null,
          branchId: body.branchId ?? null,
          status: "draft",
          quoteDate: body.quoteDate ?? new Date().toISOString().slice(0, 10),
          validUntil: body.validUntil ?? null,
          subtotal: String(totals.subtotal),
          discount: String(totals.discount),
          vat: String(totals.vat),
          total: String(totals.total),
          notes: body.notes ?? null,
          appliedDiscounts: appliedDiscounts.length ? appliedDiscounts : null,
          createdBy: req.session?.userId ?? null,
        })
        .returning();

      for (const ln of totals.lines) {
        await tx.insert(quotationLinesTable).values({
          quotationId: quote.id,
          productId: (ln.productId as number | null) ?? null,
          description: ln.description,
          quantity: String(ln.quantity),
          unitPrice: String(ln.unitPrice),
          discountPct: String(ln.discountPct),
          taxRate: String(ln.taxRate),
          lineTotal: String(ln.lineTotal),
        });
      }
      return quote;
    });
    res.status(201).json(serializeMoneyDoc(result));
  } catch (err) {
    req.log.error({ err }, "create quotation");
    handleRouteError(err, res);
  }
});

router.post("/sales/quotations/:id/transition", salesWriteGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = z.object({
      to: z.enum(["sent", "accepted", "rejected", "expired"]),
      reason: z.string().optional(),
    });
    const { to, reason } = Body.parse(req.body);
    const [q] = await db.select().from(quotationsTable).where(and(eq(quotationsTable.id, id), eq(quotationsTable.companyId, getCompanyId(req))));
    if (!q) { res.status(404).json({ error: "Not found" }); return; }

    const allowed: Record<string, string[]> = {
      draft: ["sent", "expired"],
      sent: ["accepted", "rejected", "expired"],
      accepted: [],
      rejected: [],
      expired: [],
    };
    if (!allowed[q.status]?.includes(to)) {
      { res.status(409).json({ error: `لا يمكن الانتقال من ${q.status} إلى ${to}` }); return; }
    }
    const patch: Partial<typeof quotationsTable.$inferInsert> = { status: to };
    const now = new Date();
    if (to === "sent") patch.sentAt = now;
    if (to === "accepted") patch.acceptedAt = now;
    if (to === "rejected") {
      patch.rejectedAt = now;
      patch.rejectionReason = reason ?? null;
    }
    const [updated] = await db.update(quotationsTable).set(patch).where(and(eq(quotationsTable.id, id), eq(quotationsTable.companyId, getCompanyId(req)))).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(serializeMoneyDoc(updated));
  } catch (err) {
    handleRouteError(err, res);
  }
});

// Convert an accepted quotation to a Sales Order.
router.post("/sales/quotations/:id/convert", salesWriteGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const so = await db.transaction(async (tx) => {
      const [q] = await tx.select().from(quotationsTable).where(and(eq(quotationsTable.id, id), eq(quotationsTable.companyId, getCompanyId(req))));
      if (!q) throw Object.assign(new Error("Not found"), { status: 404 });
      if (q.status !== "accepted") throw new Error("يجب قبول العرض قبل التحويل");
      // Refuse double conversion
      const [already] = await tx
        .select({ id: salesOrdersTable.id })
        .from(salesOrdersTable)
        .where(and(eq(salesOrdersTable.quotationId, id), eq(salesOrdersTable.companyId, getCompanyId(req))))
        .limit(1);
      if (already) throw new Error("تم بالفعل تحويل العرض إلى أمر بيع");
      const lines = await tx
        .select()
        .from(quotationLinesTable)
        .where(eq(quotationLinesTable.quotationId, id));
      const reference = await nextRef(tx, "SO");
      const [created] = await tx
        .insert(salesOrdersTable)
        .values({
          companyId: getCompanyId(req),
          reference,
          quotationId: q.id,
          customerId: q.customerId,
          customerName: q.customerName,
          pricelistId: q.pricelistId,
          salesRepId: q.salesRepId,
          branchId: q.branchId,
          warehouseId: await getDefaultWarehouseId(tx, getCompanyId(req)).catch(() => null),
          status: "confirmed",
          orderDate: new Date().toISOString().slice(0, 10),
          subtotal: q.subtotal,
          discount: q.discount,
          vat: q.vat,
          total: q.total,
          notes: q.notes,
          source: "quote",
          appliedDiscounts: q.appliedDiscounts,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      for (const ln of lines) {
        await tx.insert(salesOrderLinesTable).values({
          soId: created.id,
          productId: ln.productId,
          description: ln.description,
          quantity: ln.quantity,
          unitPrice: ln.unitPrice,
          discountPct: ln.discountPct,
          taxRate: ln.taxRate,
          lineTotal: ln.lineTotal,
        });
      }
      return created;
    });
    res.status(201).json(serializeMoneyDoc(so));
  } catch (err) {
    req.log.error({ err }, "convert quotation");
    handleRouteError(err, res);
  }
});

// ===================================================================
// Sales Orders
// ===================================================================
const SoBody = z.object({
  customerId: z.number().int(),
  pricelistId: z.number().int().nullable().optional(),
  salesRepId: z.number().int().nullable().optional(),
  branchId: z.number().int().nullable().optional(),
  warehouseId: z.number().int().nullable().optional(),
  orderDate: z.string().optional(),
  expectedDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  orderDiscount: z.number().min(0).default(0),
  status: z.enum(["draft", "confirmed"]).optional(),
  lines: z.array(QuoteLineBody).min(1),
});

router.get("/sales/orders", customerReadGuard, async (req, res) => {
  try {
    const { status, customerId } = req.query;
    const companyId = getCompanyId(req);
    // Tenant scope via customers.companyId (customerId is NOT NULL on
    // salesOrders). Until salesOrders gains its own company_id column we
    // join through customers to keep cross-tenant rows out of the list.
    const rows = await db
      .select()
      .from(salesOrdersTable)
      .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
      .where(
        and(
          eq(customersTable.companyId, companyId),
          eq(salesOrdersTable.companyId, companyId),
          status ? eq(salesOrdersTable.status, String(status)) : sql`true`,
          customerId ? eq(salesOrdersTable.customerId, Number(customerId)) : sql`true`,
        ),
      )
      .orderBy(desc(salesOrdersTable.createdAt))
      .limit(parsePagination(req).limit)
      .offset(parsePagination(req).offset);
    res.json(rows.map((r) => serializeMoneyDoc(r.sales_orders)));
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.get("/sales/orders/:id", customerReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = getCompanyId(req);
    // Tenant scope via customers.companyId join — see GET /sales/orders.
    const [row] = await db
      .select({ so: salesOrdersTable })
      .from(salesOrdersTable)
      .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
      .where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.companyId, companyId), eq(customersTable.companyId, companyId)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const lines = await db.select().from(salesOrderLinesTable).where(eq(salesOrderLinesTable.soId, id));
    res.json({ ...serializeMoneyDoc(row.so), lines: lines.map(serializeLine) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/sales/orders", salesWriteGuard, async (req, res) => {
  try {
    const body = SoBody.parse(req.body);
    const companyId = getCompanyId(req);
    const result = await db.transaction(async (tx) => {
      // Tenant scope: customer must belong to the caller's company.
      const [customer] = await tx
        .select()
        .from(customersTable)
        .where(and(eq(customersTable.id, body.customerId), eq(customersTable.companyId, companyId)));
      if (!customer) throw new Error("العميل غير موجود");
      const pricelistId = body.pricelistId ?? (await resolveCustomerPricelist(tx, customer.id));

      const enriched = [] as Parameters<typeof computeTotals>[0];
      for (const ln of body.lines) {
        let unitPrice = ln.unitPrice;
        if ((unitPrice == null || unitPrice === 0) && ln.productId) {
          unitPrice = (await resolvePrice(tx, {
            productId: ln.productId,
            pricelistId,
            quantity: ln.quantity,
          })).unitPrice;
        }
        enriched.push({
          productId: ln.productId ?? null,
          description: ln.description,
          quantity: ln.quantity,
          unitPrice: unitPrice ?? 0,
          discountPct: ln.discountPct,
          taxRate: ln.taxRate,
        });
      }
      const lineRules = await applyLineDiscountRules(tx, enriched);
      const baseNetPre = enriched.reduce(
        (a, l) => a + l.quantity * l.unitPrice * (1 - (l.discountPct ?? 0) / 100),
        0,
      );
      const ruleResult = await applyDiscountRules(tx, {
        baseNet: Math.max(0, baseNetPre - body.orderDiscount),
        scope: "order",
      });
      const totals = computeTotals(
        enriched,
        body.orderDiscount + ruleResult.discountAmount,
      );
      const appliedDiscounts = [
        ...lineRules.applied.map((r) => ({ ...r, scope: "line" as const })),
        ...ruleResult.applied.map((r) => ({ ...r, scope: "order" as const })),
      ];
      const reference = await nextRef(tx, "SO");

      const [so] = await tx
        .insert(salesOrdersTable)
        .values({
          companyId: getCompanyId(req),
          reference,
          customerId: customer.id,
          customerName: customer.name,
          pricelistId: pricelistId ?? null,
          salesRepId: body.salesRepId ?? req.session?.userId ?? null,
          branchId: body.branchId ?? null,
          warehouseId: body.warehouseId ?? (await getDefaultWarehouseId(tx).catch(() => null)),
          status: body.status === "draft" ? "draft" : "confirmed",
          orderDate: body.orderDate ?? new Date().toISOString().slice(0, 10),
          expectedDate: body.expectedDate ?? null,
          subtotal: String(totals.subtotal),
          discount: String(totals.discount),
          vat: String(totals.vat),
          total: String(totals.total),
          notes: body.notes ?? null,
          source: "manual",
          appliedDiscounts: appliedDiscounts.length ? appliedDiscounts : null,
          createdBy: req.session?.userId ?? null,
        })
        .returning();

      for (const ln of totals.lines) {
        await tx.insert(salesOrderLinesTable).values({
          soId: so.id,
          productId: (ln.productId as number | null) ?? null,
          description: ln.description,
          quantity: String(ln.quantity),
          unitPrice: String(ln.unitPrice),
          discountPct: String(ln.discountPct),
          taxRate: String(ln.taxRate),
          lineTotal: String(ln.lineTotal),
        });
      }
      return so;
    });
    // Automation hook: rules with trigger.type='record_created' on the
    // 'sales_order' entity can auto-notify, post webhooks, etc.
    void triggerEvent(getCompanyId(req), "record_created", "sales_order", {
      id: result.id,
      total: Number(result.total),
      customerId: result.customerId,
      branchId: result.branchId,
    });
    res.status(201).json(serializeMoneyDoc(result));
  } catch (err) {
    req.log.error({ err }, "create SO");
    handleRouteError(err, res);
  }
});

// Sales order state machine. Allowed transitions:
//   draft → confirmed | cancelled
//   confirmed → partially_delivered | fully_delivered | invoiced (when no
//     delivery is needed) | cancelled
//   partially_delivered → fully_delivered | invoiced
//   fully_delivered → invoiced
//   invoiced → done
// Most automatic transitions (after delivery / invoicing) are still driven
// by the DO and invoice routes; this endpoint exposes the manual ones the
// UI needs (confirm a draft, mark an invoiced SO as done).
const SO_ALLOWED: Record<string, string[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["partially_delivered", "fully_delivered", "invoiced", "cancelled"],
  partially_delivered: ["fully_delivered", "invoiced"],
  fully_delivered: ["invoiced"],
  invoiced: ["done"],
};
router.post("/sales/orders/:id/transition", salesWriteGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = z.object({ to: z.string() });
    const { to } = Body.parse(req.body);
    const [so] = await db.select().from(salesOrdersTable).where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.companyId, getCompanyId(req))));
    if (!so) { res.status(404).json({ error: "Not found" }); return; }
    // Workflow-engine hook for the draft → confirmed transition.
    //   1. Always invoke the engine so admin-configured sales_order rules
    //      apply uniformly. The engine returns {required:false} when no
    //      rule matches (free pass-through).
    //   2. Additionally, when the customer's credit limit would be
    //      exceeded by this SO and no rule is otherwise configured, we
    //      synthesize a forced approval routed to the manager role so a
    //      finance approver still has to sign off. This satisfies the
    //      "above credit limit needs approval" classic ERP pattern even
    //      without explicit matrix configuration.
    if (to === "confirmed" && so.status === "draft") {
      // Credit-limit gate: if the SO would push (open AR + this total)
      // above the customer's credit limit (>0), force a manager-level
      // approval even when the admin has not configured a sales_order
      // rule. Customers with creditLimit == 0 are treated as unlimited.
      let forceRoles: string[] | undefined;
      let forceReason: string | undefined;
      const [cust] = await db
        .select({ creditLimit: customersTable.creditLimit })
        .from(customersTable)
        .where(eq(customersTable.id, so.customerId));
      const limit = Number(cust?.creditLimit ?? 0);
      if (limit > 0) {
        const [{ openAr }] = await db
          .select({
            openAr: sql<number>`coalesce(sum(${customerInvoicesTable.total}::numeric - ${customerInvoicesTable.amountPaid}::numeric), 0)`,
          })
          .from(customerInvoicesTable)
          .where(
            and(
              eq(customerInvoicesTable.customerId, so.customerId),
              inArray(customerInvoicesTable.status, ["open", "partially_paid"]),
            ),
          );
        if (Number(openAr) + Number(so.total) > limit) {
          forceRoles = ["manager"];
          forceReason = `تجاوز سقف الائتمان: ${limit}`;
        }
      }
      const submission = await submitForApproval({
        companyId: req.session.companyId!,
        docType: "sales_order",
        recordId: id,
        recordRef: so.reference,
        amount: Number(so.total),
        branchId: so.branchId,
        submittedByUserId: req.session?.userId ?? null,
        submittedByName: (req.session as { userName?: string } | undefined)?.userName ?? null,
        forceRoles,
        forceReason,
      });
      if (submission.required) {
        await db
          .update(salesOrdersTable)
          .set({ status: "pending_approval" })
          .where(eq(salesOrdersTable.id, id));
        res.status(202).json({
          ok: false,
          pendingApproval: true,
          approvalRequestId: submission.requestId,
          message: "أمر البيع بانتظار الاعتماد",
        });
        return;
      }
    }
    const allowed = SO_ALLOWED[so.status] ?? [];
    if (!allowed.includes(to)) {
      res.status(409).json({ error: `لا يمكن الانتقال من ${so.status} إلى ${to}` });
      return;
    }
    const [updated] = await db
      .update(salesOrdersTable)
      .set({ status: to })
      .where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.companyId, getCompanyId(req))))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(serializeMoneyDoc(updated));
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/sales/orders/:id/cancel", salesWriteGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [so] = await db.select().from(salesOrdersTable).where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.companyId, getCompanyId(req))));
    if (!so) { res.status(404).json({ error: "Not found" }); return; }
    if (!["draft", "confirmed"].includes(so.status))
      { res.status(409).json({ error: "لا يمكن إلغاء أمر بيع به تسليمات أو فواتير" }); return; }
    const [updated] = await db
      .update(salesOrdersTable)
      .set({ status: "cancelled" })
      .where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.companyId, getCompanyId(req))))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(serializeMoneyDoc(updated));
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===================================================================
// Delivery Orders (DO) — issue stock against an SO
// ===================================================================
const DoBody = z.object({
  soId: z.number().int(),
  warehouseId: z.number().int().optional(),
  deliveryDate: z.string().optional(),
  notes: z.string().nullable().optional(),
  // Initial status. Default 'delivered' (atomic pick+ship — issues stock and
  // bumps the SO immediately). Use 'draft' (held — picker reservation only)
  // or 'ready' (picked, awaiting handover) to use a multi-step pipeline; the
  // /sales/deliveries/:id/transition route then advances them and only
  // issues stock when reaching 'delivered'.
  status: z.enum(["draft", "ready", "delivered"]).optional(),
  // Optional partial: when omitted, deliver all remaining quantities.
  lines: z
    .array(
      z.object({
        soLineId: z.number().int(),
        quantity: z.number().positive(),
      }),
    )
    .optional(),
  // Optional carrier dispatch — when carrierId is set we call the
  // configured carrier adapter AFTER the DO transaction commits to
  // create an AWB and persist the resulting shipment back to
  // delivery_orders.shipment_id.
  carrierId: z.number().int().positive().optional(),
  shipmentWeightKg: z.number().positive().optional(),
  shipmentToAddress: z.record(z.string(), z.unknown()).optional(),
});

router.get("/sales/deliveries", customerReadGuard, async (req, res) => {
  try {
    const { soId } = req.query;
    const rows = await db
      .select()
      .from(deliveryOrdersTable)
      .where(and(eq(deliveryOrdersTable.companyId, getCompanyId(req)), soId ? eq(deliveryOrdersTable.soId, Number(soId)) : sql`true`))
      .orderBy(desc(deliveryOrdersTable.createdAt))
      .limit(200);
    res.json(rows);
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/sales/deliveries", salesWriteGuard, async (req, res) => {
  try {
    const body = DoBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [so] = await tx.select().from(salesOrdersTable).where(and(eq(salesOrdersTable.id, body.soId), eq(salesOrdersTable.companyId, getCompanyId(req))));
      if (!so) throw Object.assign(new Error("Not found"), { status: 404 });
      if (!["confirmed", "partially_delivered"].includes(so.status))
        throw new Error(`لا يمكن التسليم على أمر بحالة ${so.status}`);
      const soLines = await tx.select().from(salesOrderLinesTable).where(eq(salesOrderLinesTable.soId, so.id));
      // Build the delivery list.
      const wantedById = new Map<number, number>();
      if (body.lines && body.lines.length > 0) {
        for (const l of body.lines) wantedById.set(l.soLineId, l.quantity);
      } else {
        for (const sl of soLines) {
          const remaining = Number(sl.quantity) - Number(sl.deliveredQty);
          if (remaining > 0) wantedById.set(sl.id, remaining);
        }
      }
      if (wantedById.size === 0) throw new Error("لا توجد كميات قابلة للتسليم");

      const warehouseId = body.warehouseId ?? so.warehouseId ?? (await getDefaultWarehouseId(tx, getCompanyId(req)));
      const [warehouse] = await tx.select({ id: warehousesTable.id }).from(warehousesTable)
        .where(and(eq(warehousesTable.id, warehouseId), eq(warehousesTable.companyId, getCompanyId(req))));
      if (!warehouse) throw Object.assign(new Error("Not found"), { status: 404 });
      const reference = await nextRef(tx, "DO");
      const initialStatus = body.status ?? "delivered";
      const [doc] = await tx
        .insert(deliveryOrdersTable)
        .values({
          companyId: getCompanyId(req),
          reference,
          soId: so.id,
          warehouseId,
          status: initialStatus,
          deliveryDate: body.deliveryDate ?? new Date().toISOString().slice(0, 10),
          notes: body.notes ?? null,
          createdBy: req.session?.userId ?? null,
          deliveredAt: initialStatus === "delivered" ? new Date() : null,
        })
        .returning();

      let allDelivered = true;
      for (const sl of soLines) {
        const want = wantedById.get(sl.id);
        if (!want) {
          if (Number(sl.quantity) - Number(sl.deliveredQty) > 0) allDelivered = false;
          continue;
        }
        const remaining = Number(sl.quantity) - Number(sl.deliveredQty);
        if (want > remaining + 1e-6) throw new Error("الكمية المطلوب تسليمها تتجاوز المتبقي");
        await tx.insert(deliveryOrderLinesTable).values({
          doId: doc.id,
          soLineId: sl.id,
          productId: sl.productId,
          description: sl.description,
          quantity: String(want),
        });
        // Only issue stock + bump SO fulfilment when this DO is going out
        // the door. Draft/ready DOs are picker artifacts and must not move
        // stock until they advance to 'delivered' via the transition route.
        if (initialStatus === "delivered") {
          if (sl.productId) {
            await recordStockMove(tx, {
              companyId: getCompanyId(req),
              productId: sl.productId,
              quantity: want,
              kind: "issue",
              fromWarehouseId: warehouseId,
              sourceType: "delivery_order",
              sourceId: sl.id,
              sourceRef: reference,
              createdBy: req.session?.userId ?? null,
              skipJournal: false,
            });
          }
          await tx
            .update(salesOrderLinesTable)
            .set({
              deliveredQty: sql`${salesOrderLinesTable.deliveredQty}::numeric + ${want}`,
            })
            .where(eq(salesOrderLinesTable.id, sl.id));
        }
        if (Number(sl.quantity) - (Number(sl.deliveredQty) + want) > 1e-6) allDelivered = false;
      }

      if (initialStatus === "delivered") {
        const newStatus = allDelivered ? "fully_delivered" : "partially_delivered";
        await tx.update(salesOrdersTable).set({ status: newStatus }).where(eq(salesOrdersTable.id, so.id));
      }

      return doc;
    });
    // Post-commit carrier dispatch — fire-and-forget so the DO
    // response isn't blocked on the carrier API. The shipment row
    // is the audit trail; failures are logged with the DO id so an
    // operator can retry.
    if (body.carrierId) {
      const carrierId = body.carrierId;
      const doId = result.id;
      const doRef = result.reference;
      const weightKg = body.shipmentWeightKg ?? 1;
      const fallbackAddress = {
        name: "العميل",
        phone: "",
        line1: "",
        city: "",
        country: "SA",
      };
      const toAddress = {
        ...fallbackAddress,
        ...((body.shipmentToAddress ?? {}) as Record<string, string>),
      } as {
        name: string;
        phone: string;
        line1: string;
        city: string;
        country?: string;
      };
      void (async () => {
        try {
          const awb = await createAwb({
            carrierId,
            deliveryOrderRef: doRef,
            weightKg,
            toAddress,
          }, req.session.companyId!);
          await db
            .update(deliveryOrdersTable)
            .set({ carrierId, shipmentId: awb.shipmentId })
            .where(eq(deliveryOrdersTable.id, doId));
        } catch (e) {
          req.log.warn({ err: e, doId, carrierId }, "carrier AWB creation failed");
        }
      })();
    }
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "create delivery");
    handleRouteError(err, res);
  }
});

// Delivery order state machine: draft → ready → delivered | cancelled.
// Stock is moved + SO fulfilment counters are bumped only when transitioning
// into 'delivered'; cancelling a DO that already shipped is not allowed (a
// credit note with restock is the documented reverse path).
const DO_ALLOWED: Record<string, string[]> = {
  draft: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
};
router.post("/sales/deliveries/:id/transition", salesWriteGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = z.object({ to: z.enum(["ready", "delivered", "cancelled"]) });
    const { to } = Body.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [doc] = await tx.select().from(deliveryOrdersTable).where(and(eq(deliveryOrdersTable.id, id), eq(deliveryOrdersTable.companyId, getCompanyId(req))));
      if (!doc) throw Object.assign(new Error("Not found"), { status: 404 });
      const [so] = await tx.select({ id: salesOrdersTable.id }).from(salesOrdersTable)
        .where(and(eq(salesOrdersTable.id, doc.soId), eq(salesOrdersTable.companyId, getCompanyId(req))));
      if (!so) throw Object.assign(new Error("Not found"), { status: 404 });
      const allowed = DO_ALLOWED[doc.status] ?? [];
      if (!allowed.includes(to)) throw new Error(`لا يمكن الانتقال من ${doc.status} إلى ${to}`);

      if (to === "delivered") {
        // Materialise the stock move + SO line bump now.
        const lines = await tx
          .select()
          .from(deliveryOrderLinesTable)
          .where(eq(deliveryOrderLinesTable.doId, doc.id));
        for (const ln of lines) {
          if (ln.productId) {
            await recordStockMove(tx, {
              companyId: getCompanyId(req),
              productId: ln.productId,
              quantity: Number(ln.quantity),
              kind: "issue",
              fromWarehouseId: doc.warehouseId,
              sourceType: "delivery_order",
              sourceId: ln.soLineId,
              sourceRef: doc.reference,
              createdBy: req.session?.userId ?? null,
              skipJournal: false,
            });
          }
          if (ln.soLineId) {
            await tx
              .update(salesOrderLinesTable)
              .set({
                deliveredQty: sql`${salesOrderLinesTable.deliveredQty}::numeric + ${Number(ln.quantity)}`,
              })
              .where(eq(salesOrderLinesTable.id, ln.soLineId));
          }
        }
        const soLines = await tx
          .select()
          .from(salesOrderLinesTable)
          .where(eq(salesOrderLinesTable.soId, doc.soId));
        const allDelivered = soLines.every((l) => Number(l.quantity) - Number(l.deliveredQty) <= 1e-6);
        await tx
          .update(salesOrdersTable)
          .set({ status: allDelivered ? "fully_delivered" : "partially_delivered" })
          .where(eq(salesOrdersTable.id, doc.soId));
      }

      const [updated] = await tx
        .update(deliveryOrdersTable)
        .set({
          status: to,
          deliveredAt: to === "delivered" ? new Date() : doc.deliveredAt,
        })
        .where(and(eq(deliveryOrdersTable.id, id), eq(deliveryOrdersTable.companyId, getCompanyId(req))))
        .returning();
      return updated;
    });
    res.json(result);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===================================================================
// Customer Invoices (AR)
// ===================================================================
const InvoiceBody = z.object({
  branchId: z.number().int().positive().nullable().optional(),
  customerId: z.number().int().optional(),
  soId: z.number().int().nullable().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // Optional override lines; when omitted and soId is given, invoice the
  // SO's remaining-to-invoice quantities.
  orderDiscount: z.number().min(0).default(0),
  lines: z.array(QuoteLineBody).optional(),
});

router.get("/sales/invoices", customerReadGuard, async (req, res) => {
  try {
    const { status, customerId } = req.query;
    const companyId = getCompanyId(req);
    // Tenant scope via customers.companyId — see GET /sales/orders.
    const joined = await db
      .select({ inv: customerInvoicesTable })
      .from(customerInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, customerInvoicesTable.customerId))
      .where(
        and(
          eq(customersTable.companyId, companyId),
          eq(customerInvoicesTable.companyId, companyId),
          status ? eq(customerInvoicesTable.status, String(status)) : sql`true`,
          customerId ? eq(customerInvoicesTable.customerId, Number(customerId)) : sql`true`,
        ),
      )
      .orderBy(desc(customerInvoicesTable.createdAt))
      .limit(parsePagination(req).limit)
      .offset(parsePagination(req).offset);
    const rows = joined.map((j) => j.inv);
    // Surface last send signal per invoice from sales_email_outbox (email)
    // and outbound_messages (WhatsApp). This lets the UI show whether a
    // given invoice was already delivered and over which channel so staff
    // don't re-press "إرسال" without thinking. We also expose `lastSend`
    // — the most recent outbox attempt regardless of status — so the
    // invoice list can render a delivered / queued / failed badge with
    // the recipient + error in a tooltip.
    const ids = rows.map((r) => r.id);
    const refs = rows.map((r) => r.reference);
    type SendInfo = { sentAt: string; to: string; status: string };
    const emailByInvoice = new Map<number, SendInfo>();
    const waByRef = new Map<string, SendInfo>();
    const lastSendById = new Map<number, {
      outboxId: number;
      status: string;
      recipient: string | null;
      error: string | null;
      createdAt: string | null;
      sentAt: string | null;
      attempts: number;
      nextRetryAt: string | null;
      exhausted: boolean;
      maxAttempts: number;
    }>();
    // Per-invoice "latest root attempt" — drives the
    // "exhausted retries" flag the UI uses to switch the badge
    // and feed the "X فواتير فشل إرسالها نهائياً" KPI banner.
    const latestRootById = new Map<number, {
      status: string;
      attempts: number;
      nextRetryAt: string | null;
    }>();
    if (ids.length > 0) {
      // Only successfully-dispatched sends count as "تم الإرسال". Queued
      // or failed attempts must not drive the channel badge — staff still
      // need to re-send those.
      const emailRes = await db.execute(sql`
        SELECT DISTINCT ON (ref_id)
          ref_id,
          recipient,
          status,
          sent_at
        FROM sales_email_outbox
        WHERE kind = 'invoice'
          AND ref_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
          AND status = 'sent'
          AND sent_at IS NOT NULL
        ORDER BY ref_id, sent_at DESC, id DESC
      `);
      const emailRows = ((emailRes as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (emailRes as unknown as Array<Record<string, unknown>>)) ?? [];
      for (const r of emailRows) {
        const sentAt = r["sent_at"];
        emailByInvoice.set(Number(r["ref_id"]), {
          sentAt: sentAt instanceof Date ? sentAt.toISOString() : String(sentAt),
          to: String(r["recipient"] ?? ""),
          status: String(r["status"] ?? ""),
        });
      }
      // Most-recent attempt per invoice (any status) — drives the
      // delivered/queued/failed badge.
      const lastRes = await db.execute(sql`
        SELECT DISTINCT ON (ref_id)
          ref_id AS "refId",
          id AS "outboxId",
          status,
          recipient,
          error,
          created_at AS "createdAt",
          sent_at AS "sentAt"
        FROM sales_email_outbox
        WHERE kind = 'invoice' AND ref_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        ORDER BY ref_id, created_at DESC, id DESC
      `);
      const lastRows = ((lastRes as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (lastRes as unknown as Array<Record<string, unknown>>)) ?? [];
      // Latest root attempt per invoice — carries the live retry counter
      // and the next-retry timestamp set by the background worker. We
      // need this separately from `lastRes` because the most-recent row
      // may be an immutable child audit record (attempts=0) inserted by
      // the worker; only the root row tracks the live `attempts` total.
      const rootRes = await db.execute(sql`
        SELECT DISTINCT ON (ref_id)
          ref_id AS "refId",
          status,
          attempts,
          next_retry_at AS "nextRetryAt"
        FROM sales_email_outbox
        WHERE kind = 'invoice'
          AND ref_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
          AND retry_of IS NULL
        ORDER BY ref_id, created_at DESC, id DESC
      `);
      const rootRows = ((rootRes as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (rootRes as unknown as Array<Record<string, unknown>>)) ?? [];
      for (const r of rootRows) {
        const refId = Number((r as Record<string, unknown>)["refId"]);
        if (!Number.isFinite(refId)) continue;
        const nextRetryAt = (r as Record<string, unknown>)["nextRetryAt"];
        latestRootById.set(refId, {
          status: String((r as Record<string, unknown>)["status"] ?? ""),
          attempts: Number((r as Record<string, unknown>)["attempts"] ?? 0),
          nextRetryAt: nextRetryAt instanceof Date
            ? nextRetryAt.toISOString()
            : (nextRetryAt as string | null) ?? null,
        });
      }
      for (const r of lastRows) {
        const refId = Number((r as Record<string, unknown>)["refId"]);
        if (!Number.isFinite(refId)) continue;
        const createdAt = (r as Record<string, unknown>)["createdAt"];
        const sentAt = (r as Record<string, unknown>)["sentAt"];
        const root = latestRootById.get(refId);
        const attempts = root?.attempts ?? 0;
        const nextRetryAt = root?.nextRetryAt ?? null;
        const exhausted =
          root?.status === "failed" &&
          attempts >= INVOICE_EMAIL_MAX_ATTEMPTS &&
          !nextRetryAt;
        lastSendById.set(refId, {
          outboxId: Number((r as Record<string, unknown>)["outboxId"]),
          status: String((r as Record<string, unknown>)["status"] ?? ""),
          recipient: (r as Record<string, unknown>)["recipient"] == null
            ? null
            : String((r as Record<string, unknown>)["recipient"]),
          error: (r as Record<string, unknown>)["error"] == null
            ? null
            : String((r as Record<string, unknown>)["error"]),
          createdAt: createdAt instanceof Date
            ? createdAt.toISOString()
            : (createdAt as string | null) ?? null,
          sentAt: sentAt instanceof Date
            ? sentAt.toISOString()
            : (sentAt as string | null) ?? null,
          attempts,
          nextRetryAt,
          exhausted,
          maxAttempts: INVOICE_EMAIL_MAX_ATTEMPTS,
        });
      }
      const waRes = await db.execute(sql`
        SELECT DISTINCT ON (variables->>'invoice_no')
          variables->>'invoice_no' AS invoice_no,
          to_number,
          status,
          sent_at
        FROM outbound_messages
        WHERE template_name = 'invoice_issued'
          AND variables->>'invoice_no' IN (${sql.join(refs.map((r) => sql`${r}`), sql`, `)})
          AND status IN ('sent', 'delivered')
          AND sent_at IS NOT NULL
        ORDER BY variables->>'invoice_no', sent_at DESC, id DESC
      `);
      const waRows = ((waRes as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (waRes as unknown as Array<Record<string, unknown>>)) ?? [];
      for (const r of waRows) {
        const sentAt = r["sent_at"];
        waByRef.set(String(r["invoice_no"]), {
          sentAt: sentAt instanceof Date ? sentAt.toISOString() : String(sentAt),
          to: String(r["to_number"] ?? ""),
          status: String(r["status"] ?? ""),
        });
      }
    }

    const out = rows.map((r) => {
      const base = serializeMoneyDoc(r) as Record<string, unknown>;
      const email = emailByInvoice.get(r.id) ?? null;
      const wa = waByRef.get(r.reference) ?? null;
      let lastSentAt: string | null = null;
      let lastSentChannel: "email" | "whatsapp" | null = null;
      let lastSentTo: string | null = null;
      const emailT = email ? new Date(email.sentAt).getTime() : -Infinity;
      const waT = wa ? new Date(wa.sentAt).getTime() : -Infinity;
      if (email && emailT >= waT) {
        lastSentAt = email.sentAt;
        lastSentChannel = "email";
        lastSentTo = email.to;
      } else if (wa) {
        lastSentAt = wa.sentAt;
        lastSentChannel = "whatsapp";
        lastSentTo = wa.to;
      }
      return {
        ...base,
        lastEmailSentAt: email?.sentAt ?? null,
        lastEmailSentTo: email?.to ?? null,
        lastEmailStatus: email?.status ?? null,
        lastWhatsappSentAt: wa?.sentAt ?? null,
        lastWhatsappSentTo: wa?.to ?? null,
        lastWhatsappStatus: wa?.status ?? null,
        lastSentAt,
        lastSentChannel,
        lastSentTo,
        lastSend: lastSendById.get(r.id) ?? null,
      };
    });
    res.json(out);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// Count of invoices whose latest email send has exhausted all auto-retry
// attempts (status='failed', attempts >= MAX, no next_retry_at scheduled).
// Powers the "X فواتير فشل إرسالها نهائياً" KPI banner on the invoices
// list so staff notice without having to scroll the table.
router.get("/sales/invoices/email-failure-count", customerReadGuard, async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM sales_email_outbox
      WHERE kind = 'invoice'
        AND ref_id IN (SELECT id FROM customer_invoices WHERE company_id = ${getCompanyId(req)})
        AND retry_of IS NULL
        AND status = 'failed'
        AND attempts >= ${INVOICE_EMAIL_MAX_ATTEMPTS}
        AND next_retry_at IS NULL;
    `);
    const rows = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows
      ?? (result as unknown as Array<Record<string, unknown>>);
    const count = Number(rows?.[0]?.count ?? 0);
    res.json({ exhaustedCount: count, maxAttempts: INVOICE_EMAIL_MAX_ATTEMPTS });
  } catch (err) {
    handleRouteError(err, res);
  }
});

const invoiceViewGuard: RequestHandler = async (req, res, next) => {
  try {
    const branchId = await returnInvoiceBranch(getCompanyId(req), Number(req.params.id));
    if (branchId != null) {
      await returnAuthorize(req.session.userId!, getCompanyId(req), "view", branchId);
      next(); return;
    }
    void customerReadGuard(req, res, next);
  } catch (error) {
    res.status(error instanceof FinancialRequestError ? error.status : 500).json({
      error: error instanceof FinancialRequestError ? error.message : "تعذر عرض المستند",
      diagnosticRef: String(req.id),
    });
  }
};
router.get("/sales/invoices/:id", invoiceViewGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = getCompanyId(req);
    // Tenant scope via customers.companyId join — see GET /sales/orders.
    const [row] = await db
      .select({ inv: customerInvoicesTable })
      .from(customerInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, customerInvoicesTable.customerId))
      .where(and(eq(customerInvoicesTable.id, id), eq(customerInvoicesTable.companyId, companyId), eq(customersTable.companyId, companyId)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const lines = await db.select().from(customerInvoiceLinesTable).where(eq(customerInvoiceLinesTable.invoiceId, id));
    const actor=await returnActor(req.session.userId!,companyId);
    const canSee=actor.capabilities.includes("view")&&(actor.branches===null||(row.inv.branchId!==null&&actor.branches.includes(row.inv.branchId)));
    const attribution=canSee?await savedSellerLines(companyId,id):[],byLine=new Map(attribution.map(a=>[a.invoice_line_id,a]));
    const first=attribution[0],same=attribution.length>0&&attribution.every(a=>a.employee_id===first!.employee_id);
    res.json({ ...serializeMoneyDoc(row.inv),hasSellerSnapshot:attribution.length>0,
      sellerEmployeeId:same?first!.employee_id:null,sellerName:[...new Set(attribution.map(a=>a.seller_name))].join("، "),
      attributionPolicy:first?{version:first.policy.version,mode:first.policy.mode,granularity:first.policy.granularity}:null,
      lines: lines.map(l=>{const a=byLine.get(l.id);return {...serializeLine(l),sellerEmployeeId:a?.employee_id??null,sellerName:a?.seller_name??null,sellerRevision:a?.revision??null};}) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// Render a branded, printable customer invoice PDF that mirrors the
// purchase-order PDF chrome (logo, company info, bilingual labels,
// totals, bank details, terms). Cached ZATCA QR is embedded when
// present on the invoice row.
export async function renderCustomerInvoicePdfById(id: number, companyId: number): Promise<
  | { ok: true; pdf: Buffer; head: typeof customerInvoicesTable.$inferSelect; customer: typeof customersTable.$inferSelect | undefined }
  | { ok: false; status: 400 | 404; error: string }
> {
  if (!Number.isFinite(id)) return { ok: false, status: 400, error: "Bad id" };
  const [head] = await db
    .select()
    .from(customerInvoicesTable)
    .where(and(eq(customerInvoicesTable.id, id), eq(customerInvoicesTable.companyId, companyId)));
  if (!head) return { ok: false, status: 404, error: "Not found" };
  const [customer] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, head.customerId), eq(customersTable.companyId, companyId)));
  if (!customer) return { ok: false, status: 404, error: "Not found" };
  const lines = await db
    .select()
    .from(customerInvoiceLinesTable)
    .where(eq(customerInvoiceLinesTable.invoiceId, id));
  const company = await printableIssuer(await documentIssuer(companyId, "invoice", id));
  const sellers=new Map((await savedSellerLines(companyId,id)).map(l=>[l.invoice_line_id,l]));
  let qrDataUrl: string | null = null;
  if (head.zatcaQr) {
    try {
      qrDataUrl = await QRCode.toDataURL(head.zatcaQr, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 220,
      });
    } catch {
      qrDataUrl = null;
    }
  }
  const pdf = await buildCustomerInvoicePdf(
    {
      reference: head.reference,
      invoiceDate: head.invoiceDate,
      dueDate: head.dueDate,
      currencyCode: head.currencyCode,
      subtotal: Number(head.subtotal),
      discount: Number(head.discount),
      vat: Number(head.vat),
      total: Number(head.total),
      amountPaid: Number(head.amountPaid),
      status: head.status,
      notes: head.notes,
      customer: {
        name: head.customerName,
        email: customer?.email ?? null,
        phone: customer?.phone ?? null,
        address: customer?.billingAddress ?? customer?.shippingAddress ?? null,
        vatNumber: customer?.taxNumber === "POS-WALKIN" ? "غير متاح" : customer?.taxNumber ?? null,
      },
      lines: lines.map((l) => ({
        description: sellerLineDescription(l.description,sellers.get(l.id)),
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        taxRate: Number(l.taxRate),
        lineTotal: Number(l.lineTotal),
      })),
      zatcaQrDataUrl: qrDataUrl,
    },
    company,
  );
  return { ok: true, pdf, head, customer };
}

router.get("/sales/invoices/:id/pdf", invoiceViewGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rendered = await renderCustomerInvoicePdfById(id, getCompanyId(req));
    if (!rendered.ok) {
      res.status(rendered.status).json({ error: rendered.error });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="invoice-${rendered.head.reference}.pdf"`,
    );
    res.send(rendered.pdf);
  } catch (err) {
    req.log.error({ err }, "render customer invoice PDF");
    handleRouteError(err, res);
  }
});

// Send the customer invoice PDF to the customer over email (attachment) or
// WhatsApp (document via approved template). Mirrors the quotation send
// route — we never lie about delivery: the underlying outbox row records
// the real dispatch outcome, and the response reports `dispatched`.
router.post("/sales/invoices/:id/send", financeGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = z.object({
      channel: z.enum(["email", "whatsapp"]),
      to: z.string().trim().min(1).optional(),
    });
    const body = Body.parse(req.body ?? {});

    const rendered = await renderCustomerInvoicePdfById(id, getCompanyId(req));
    if (!rendered.ok) {
      res.status(rendered.status).json({ error: rendered.error });
      return;
    }
    const { pdf, head, customer } = rendered;
    const filename = `invoice-${head.reference}.pdf`;

    if (body.channel === "email") {
      const recipient = body.to ?? customer?.email ?? null;
      if (!recipient || !/^\S+@\S+\.\S+$/.test(recipient)) {
        res.status(400).json({ error: "لا يوجد بريد إلكتروني للعميل" });
        return;
      }
      const subject = `فاتورة ${head.reference}`;
      const emailBody =
        `السلام عليكم،\n\nنرفق لكم الفاتورة ${head.reference} بإجمالي ${head.total} ${head.currencyCode}.` +
        (head.dueDate ? ` تاريخ الاستحقاق: ${head.dueDate}.` : "") +
        `\n\nمع التحية.`;
      const dispatch = await sendMail({
        to: recipient,
        subject,
        body: emailBody,
        attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
      });
      // Failed dispatches go in as status='failed' (not 'queued') so the
      // background retry worker in lib/invoice-email-retry-worker.ts
      // picks them up and re-tries with exponential backoff. The worker
      // only sweeps `failed` invoice rows where retry_of IS NULL.
      const outboxStatus = dispatch.sent ? "sent" : "failed";
      const errorMsg = dispatch.sent ? null : dispatch.reason ?? "delivery failed";
      // Task #208: per-recipient delivery status + SMTP message_id so
      // the inbound bounce webhook can resolve this exact send back.
      const [delivery] = recipientStatusesFromDispatch(dispatch, [recipient]);
      const messageId = dispatch.sent ? dispatch.messageId : null;
      const inserted = await db.execute(sql`
        INSERT INTO sales_email_outbox
          (kind, ref_id, reference, recipient, subject, body, status, error,
           created_by, sent_at,
           message_id, delivery_status, delivery_reason, delivered_at)
        VALUES ('invoice', ${head.id}, ${head.reference}, ${recipient}, ${subject},
                ${emailBody}, ${outboxStatus}, ${errorMsg},
                ${req.session?.userId ?? null},
                ${dispatch.sent ? sql`now()` : sql`null`},
                ${messageId}, ${delivery?.status ?? "pending"},
                ${delivery?.reason ?? null},
                ${delivery?.deliveredAt ?? null})
        RETURNING id;
      `);
      const rows = (inserted as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (inserted as unknown as Array<Record<string, unknown>>);
      req.log.info(
        {
          invoiceId: head.id,
          recipient,
          outboxId: rows?.[0]?.id,
          dispatched: dispatch.sent,
          reason: dispatch.sent ? undefined : dispatch.reason,
        },
        "invoice.send.email",
      );
      res.json({
        ok: dispatch.sent,
        dispatched: dispatch.sent,
        channel: "email",
        sentTo: recipient,
        outboxId: rows?.[0]?.id,
        outboxStatus,
        reason: dispatch.sent ? undefined : dispatch.reason,
        mailerConfigured: isMailerConfigured(),
      });
      return;
    }

    // WhatsApp path
    const recipient = body.to ?? customer?.phone ?? null;
    if (!recipient) {
      res.status(400).json({ error: "لا يوجد رقم واتساب للعميل" });
      return;
    }
    const baseUrl =
      (process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/$/, "") || "";
    const payLink = baseUrl
      ? `${baseUrl}/portal/invoices/${head.id}/pay`
      : "";
    // Public PDF URL for WhatsApp document attachment (Meta requires a
    // fetchable URL). When PUBLIC_BASE_URL isn't set the template
    // dispatch falls back to text-only.
    const pdfUrl = baseUrl
      ? `${baseUrl}/api/sales/invoices/${head.id}/pdf`
      : undefined;
    try {
      await sendByTemplate({
        templateName: "invoice_issued",
        to: recipient,
        variables: {
          customer_name: head.customerName,
          invoice_no: head.reference,
          total: String(head.total),
          pay_link: payLink,
        },
        branchId: head.branchId ?? null,
        mediaUrl: pdfUrl,
        mediaType: "document",
        mediaFilename: filename,
      });
      req.log.info(
        { invoiceId: head.id, recipient, hasPdfUrl: !!pdfUrl },
        "invoice.send.whatsapp",
      );
      res.json({
        ok: true,
        dispatched: true,
        channel: "whatsapp",
        sentTo: recipient,
        attachedPdf: !!pdfUrl,
      });
    } catch (err) {
      req.log.warn({ err, invoiceId: head.id }, "invoice.send.whatsapp.failed");
      res.status(502).json({
        ok: false,
        dispatched: false,
        channel: "whatsapp",
        error: err instanceof Error ? err.message : "تعذّر إرسال الواتساب",
      });
    }
  } catch (err) {
    req.log.error({ err }, "send customer invoice");
    handleRouteError(err, res);
  }
});

// List recent dispatch attempts for a given customer invoice. Powers the
// "Outbox" drawer in the UI so users can see whether each attempt was
// actually delivered (`sent`) or got queued/failed (`queued`) along with
// the SMTP error so they can fix configuration without DB access.
router.get("/sales/invoices/:id/send-history", financeGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Bad id" });
      return;
    }
    const [head] = await db
      .select({ id: customerInvoicesTable.id })
      .from(customerInvoicesTable)
      .where(and(eq(customerInvoicesTable.id, id), eq(customerInvoicesTable.companyId, getCompanyId(req))));
    if (!head) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const result = await db.execute(sql`
      SELECT id, kind, ref_id AS "refId", reference, recipient, subject,
             status, error, created_at AS "createdAt", sent_at AS "sentAt",
             created_by AS "createdBy",
             attempts, retry_of AS "retryOf", next_retry_at AS "nextRetryAt"
      FROM sales_email_outbox
      WHERE kind = 'invoice' AND ref_id = ${id}
      ORDER BY created_at DESC
      LIMIT 50;
    `);
    const rows = ((result as unknown as { rows?: Array<Record<string, unknown>> }).rows
      ?? (result as unknown as Array<Record<string, unknown>>)) ?? [];
    // The send-history drawer needs to label each row with its sequential
    // attempt number ("المحاولة #N"). The root row is attempt #1; each
    // child audit row (retry_of != null) is attempt #N where N is its
    // 1-based position among siblings ordered by created_at ASC. We
    // compute that here so the UI doesn't have to.
    const ascending = [...rows].sort((a, b) => {
      const ta = new Date(String(a["createdAt"])).getTime();
      const tb = new Date(String(b["createdAt"])).getTime();
      return ta - tb;
    });
    const attemptNumberById = new Map<number, number>();
    const childCountByRoot = new Map<number, number>();
    for (const r of ascending) {
      const id = Number(r["id"]);
      const retryOf = r["retryOf"] == null ? null : Number(r["retryOf"]);
      if (retryOf == null) {
        attemptNumberById.set(id, 1);
      } else {
        const prior = childCountByRoot.get(retryOf) ?? 0;
        const n = prior + 2; // root is #1; siblings start at #2
        attemptNumberById.set(id, n);
        childCountByRoot.set(retryOf, prior + 1);
      }
    }
    const items = rows.map((r) => ({
      ...r,
      attemptNumber: attemptNumberById.get(Number(r["id"])) ?? null,
    }));
    res.json({
      items,
      mailerConfigured: isMailerConfigured(),
      maxAttempts: INVOICE_EMAIL_MAX_ATTEMPTS,
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// One-click retry of a recorded send attempt. We re-render the current
// invoice PDF (so the customer always gets the up-to-date document) and
// re-dispatch over SMTP with the original recipient/subject/body. Each
// retry inserts a NEW outbox row so the per-attempt audit trail (status,
// error, timestamp) is preserved — the original failure row is never
// overwritten.
router.post(
  "/sales/invoices/:id/send-history/:outboxId/retry",
  financeGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const outboxId = Number(req.params.outboxId);
      if (!Number.isFinite(id) || !Number.isFinite(outboxId)) {
        res.status(400).json({ error: "Bad id" });
        return;
      }
      const lookup = await db.execute(sql`
        SELECT id, kind, ref_id AS "refId", reference, recipient, subject,
               body, status
        FROM sales_email_outbox
        WHERE id = ${outboxId} AND kind = 'invoice' AND ref_id = ${id}
          AND ref_id IN (SELECT id FROM customer_invoices WHERE company_id = ${getCompanyId(req)})
        LIMIT 1;
      `);
      const lookupRows = (lookup as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (lookup as unknown as Array<Record<string, unknown>>);
      const row = lookupRows?.[0] as
        | {
            id: number;
            reference: string;
            recipient: string;
            subject: string;
            body: string;
            status: string;
          }
        | undefined;
      if (!row) {
        res.status(404).json({ error: "Outbox entry not found" });
        return;
      }
      if (row.status === "sent") {
        res.status(409).json({ error: "تم تسليم هذه المحاولة مسبقاً" });
        return;
      }
      const rendered = await renderCustomerInvoicePdfById(id, getCompanyId(req));
      if (!rendered.ok) {
        res.status(rendered.status).json({ error: rendered.error });
        return;
      }
      const { pdf, head } = rendered;
      const filename = `invoice-${head.reference}.pdf`;
      const dispatch = await sendMail({
        to: row.recipient,
        subject: row.subject,
        body: row.body,
        attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
      });
      // Manual retries that still fail must land as 'failed' (not 'queued')
      // so the background worker can keep retrying them on its own
      // schedule. Otherwise a one-click retry that fails would never be
      // auto-followed-up.
      const newStatus = dispatch.sent ? "sent" : "failed";
      const errorMsg = dispatch.sent ? null : dispatch.reason ?? "delivery failed";
      // Task #208
      const [delivery] = recipientStatusesFromDispatch(dispatch, [row.recipient]);
      const messageId = dispatch.sent ? dispatch.messageId : null;
      const inserted = await db.execute(sql`
        INSERT INTO sales_email_outbox
          (kind, ref_id, reference, recipient, subject, body, status, error,
           created_by, sent_at,
           message_id, delivery_status, delivery_reason, delivered_at)
        VALUES ('invoice', ${head.id}, ${head.reference}, ${row.recipient},
                ${row.subject}, ${row.body}, ${newStatus}, ${errorMsg},
                ${req.session?.userId ?? null},
                ${dispatch.sent ? sql`now()` : sql`null`},
                ${messageId}, ${delivery?.status ?? "pending"},
                ${delivery?.reason ?? null},
                ${delivery?.deliveredAt ?? null})
        RETURNING id;
      `);
      const insertedRows = (inserted as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (inserted as unknown as Array<Record<string, unknown>>);
      const newOutboxId = insertedRows?.[0]?.id as number | undefined;
      req.log.info(
        {
          invoiceId: id,
          originalOutboxId: row.id,
          newOutboxId,
          recipient: row.recipient,
          dispatched: dispatch.sent,
          reason: dispatch.sent ? undefined : dispatch.reason,
        },
        "invoice.send.email.retry",
      );
      res.json({
        ok: dispatch.sent,
        dispatched: dispatch.sent,
        outboxId: newOutboxId,
        outboxStatus: newStatus,
        sentTo: row.recipient,
        reason: dispatch.sent ? undefined : dispatch.reason,
        mailerConfigured: isMailerConfigured(),
      });
    } catch (err) {
      req.log.error({ err }, "retry customer invoice email");
      handleRouteError(err, res);
    }
  },
);

router.post("/sales/invoices", financeGuard, async (req, res) => {
  try {
    const body = InvoiceBody.parse(req.body);
    // Tenant VAT gating: non-registered companies cannot legally
    // charge VAT (ZATCA rule). Force every line's taxRate → 0 and
    // skip the ZATCA QR — regardless of the inbound payload.
    const [companyRow] = await db
      .select({ vatRegistrationStatus: companiesTable.vatRegistrationStatus })
      .from(companiesTable)
      .where(eq(companiesTable.id, getCompanyId(req)))
      .limit(1);
    const vatEnabled =
      companyRow?.vatRegistrationStatus === "registered" ||
      companyRow?.vatRegistrationStatus === "voluntary";
    const result = await financialTransaction(req, async (tx) => {
      const issuer = await captureIssuer(tx, getCompanyId(req));
      const vatEnabled = issuer.vatEnabled;
      const sellerNameForZatca = issuer.nameAr;
      const sellerVatForZatca = issuer.vatNumber;
      let customerId = body.customerId;
      let so: typeof salesOrdersTable.$inferSelect | undefined;
      let soLines: typeof salesOrderLinesTable.$inferSelect[] = [];
      if (body.soId) {
        const [foundSo] = await tx.select().from(salesOrdersTable).where(and(eq(salesOrdersTable.id, body.soId), eq(salesOrdersTable.companyId, getCompanyId(req)))).for("update");
        if (!foundSo) throw new Error("أمر البيع غير موجود");
        so = foundSo;
        soLines = await tx.select().from(salesOrderLinesTable).where(eq(salesOrderLinesTable.soId, foundSo.id));
        customerId = foundSo.customerId;
      }
      if (!customerId) throw new Error("يجب تحديد العميل أو أمر البيع");
      // Tenant scope: refuse if the resolved customer (direct or via SO) is foreign.
      const [customer] = await tx
        .select()
        .from(customersTable)
        .where(and(eq(customersTable.id, customerId), eq(customersTable.companyId, getCompanyId(req))));
      if (!customer) throw new Error("العميل غير موجود");

      let enriched: Parameters<typeof computeTotals>[0] = [];
      const soLineByIdx: number[] = [];
      if (body.lines && body.lines.length > 0) {
        // When both `soId` AND custom `lines` are supplied, every line must
        // be traceable to an SO line (matched by productId), and the
        // cumulative requested qty per SO line must NOT exceed
        // (deliveredQty − invoicedQty). Without this check a caller could
        // raise AR for undelivered or over-quantity items while still
        // pretending the invoice is linked to the sales order — breaking
        // the Quote→SO→DO→Invoice integrity flagged by code review.
        const soRemainingByLine = new Map<number, number>(
          soLines.map((sl) => [sl.id, Number(sl.deliveredQty) - Number(sl.invoicedQty)]),
        );
        const soLinesByProduct = new Map<number, typeof soLines[number][]>();
        if (so) {
          for (const sl of soLines) {
            if (sl.productId == null) continue;
            const arr = soLinesByProduct.get(sl.productId) ?? [];
            arr.push(sl);
            soLinesByProduct.set(sl.productId, arr);
          }
        }
        for (const ln of body.lines) {
          let unitPrice = ln.unitPrice ?? 0;
          if ((unitPrice == null || unitPrice === 0) && ln.productId) {
            unitPrice = (await resolvePrice(tx, {
              productId: ln.productId,
              pricelistId: so?.pricelistId ?? null,
              quantity: ln.quantity,
            })).unitPrice;
          }
          let matchedSoLineId = 0;
          if (so) {
            if (ln.productId == null)
              throw new Error("بنود فاتورة مرتبطة بأمر بيع تتطلب productId لكل بند");
            const candidates = soLinesByProduct.get(ln.productId) ?? [];
            // Pick the first SO line for this product with remaining
            // delivered-but-unbilled capacity ≥ requested qty.
            const pick = candidates.find(
              (sl) => (soRemainingByLine.get(sl.id) ?? 0) + 1e-6 >= ln.quantity,
            );
            if (!pick) {
              const available = candidates.reduce(
                (a, sl) => a + (soRemainingByLine.get(sl.id) ?? 0),
                0,
              );
              throw new Error(
                `الكمية المطلوبة (${ln.quantity}) للمنتج تتجاوز المتبقي المسلَّم القابل للتفويتر (${available.toFixed(2)}) في أمر البيع ${so.reference}`,
              );
            }
            matchedSoLineId = pick.id;
            soRemainingByLine.set(
              pick.id,
              (soRemainingByLine.get(pick.id) ?? 0) - ln.quantity,
            );
          }
          enriched.push({
            productId: ln.productId ?? null,
            description: ln.description,
            quantity: ln.quantity,
            unitPrice,
            discountPct: ln.discountPct,
            taxRate: ln.taxRate,
          });
          soLineByIdx.push(matchedSoLineId);
        }
      } else if (so) {
        // Cap by deliveredQty - invoicedQty so we never invoice ahead of
        // what physically left the warehouse. This keeps the SO statuses
        // (partially_delivered / fully_delivered) financially meaningful
        // and prevents AR being raised against undelivered stock.
        for (const sl of soLines) {
          const deliveredRemaining = Number(sl.deliveredQty) - Number(sl.invoicedQty);
          if (deliveredRemaining <= 1e-6) continue;
          enriched.push({
            productId: sl.productId,
            description: sl.description,
            quantity: deliveredRemaining,
            unitPrice: Number(sl.unitPrice),
            discountPct: Number(sl.discountPct),
            taxRate: Number(sl.taxRate),
          });
          soLineByIdx.push(sl.id);
        }
        if (enriched.length === 0)
          throw new Error("لا توجد كميات مسلمة قابلة للتفويتر — يجب التسليم أولاً");
      } else {
        throw new Error("يجب إدخال البنود");
      }

      // When invoicing FROM a sales order we must reuse the prices/discounts
      // already locked in at SO time, not re-run the discount engines (which
      // would double-apply line rules and re-stack any current order promo,
      // making the invoice diverge from the accepted SO). For ad-hoc
      // invoices (no soId) we still apply rules so promos take effect.
      const fromSo = !!body.soId;
      const lineRules = fromSo
        ? { applied: [] as Awaited<ReturnType<typeof applyLineDiscountRules>>["applied"] }
        : await applyLineDiscountRules(tx, enriched);
      const baseNetPre = enriched.reduce(
        (a, l) => a + l.quantity * l.unitPrice * (1 - (l.discountPct ?? 0) / 100),
        0,
      );
      const ruleResult = fromSo
        ? { discountAmount: 0, applied: [] as Awaited<ReturnType<typeof applyDiscountRules>>["applied"] }
        : await applyDiscountRules(tx, {
            baseNet: Math.max(0, baseNetPre - body.orderDiscount),
            scope: "order",
          });
      if (!vatEnabled) {
        // Force every line's tax rate to 0 BEFORE totals are computed
        // so non-registered tenants never see VAT in the persisted
        // numbers or the resulting journal entry / ZATCA payload.
        for (const ln of enriched) ln.taxRate = 0;
      }
      const totals = computeTotals(
        enriched,
        body.orderDiscount + ruleResult.discountAmount,
      );
      // For SO-derived invoices we re-use the rule snapshot the SO froze at
      // creation time (carried over from the quote when applicable) and
      // scale each rule's amount proportionally to the share of the SO
      // being invoiced. Without this, partial invoicing would post the
      // rule's full discount to its GL bucket on the first invoice and
      // nothing on later ones; full invoicing without scaling would book
      // the entire historical discount even if some lines were dropped.
      type SnapRule = {
        id: number; name: string; reasonCode: string | null;
        accountSystemKey: string; amount: number; scope?: string;
      };
      let allAppliedRules: SnapRule[] = [
        ...lineRules.applied,
        ...ruleResult.applied,
      ];
      if (fromSo && so) {
        const snap = (so.appliedDiscounts as SnapRule[] | null) ?? [];
        const soSubtotal = Number(so.subtotal);
        const ratio = soSubtotal > 0 ? totals.subtotal / soSubtotal : 0;
        allAppliedRules = snap.map((r) => ({
          ...r,
          amount: +(r.amount * ratio).toFixed(2),
        }));
      }
      const reference = await nextRef(tx, "SINV");
      const dueDays = customer.paymentTermsDays ?? 0;
      const invoiceDate = body.invoiceDate ?? new Date().toISOString().slice(0, 10);
      const dueDate =
        body.dueDate ??
        new Date(new Date(invoiceDate).getTime() + dueDays * 86_400_000).toISOString().slice(0, 10);

      // Non-registered tenants do not get a ZATCA QR — the badge is
      // reserved for VAT-registered sellers per ZATCA Phase 1.
      const zatcaQr = vatEnabled && !!sellerVatForZatca
        ? buildZatcaQrBase64({
            timestamp: new Date(invoiceDate),
            totalWithVat: totals.total,
            vatAmount: totals.vat,
            sellerName: sellerNameForZatca,
            vatNumber: sellerVatForZatca,
          })
        : null;
      const invoiceBranch=await resolveSellerBranch(tx,getCompanyId(req),req.session.userId!,so?.branchId??body.branchId??null);
      const [inv] = await tx
        .insert(customerInvoicesTable)
        .values({
          companyId: getCompanyId(req),
          reference,
          soId: so?.id ?? null,
          customerId: customer.id,
          customerName: customer.name,
          branchId: invoiceBranch,
          salesRepId: so?.salesRepId ?? req.session?.userId ?? null,
          status: "open",
          invoiceDate,
          dueDate,
          subtotal: String(totals.subtotal),
          discount: String(totals.discount),
          vat: String(totals.vat),
          total: String(totals.total),
          notes: body.notes ?? null,
          zatcaQr,
          source: so ? "so" : "manual",
          sourceRef: so?.reference ?? null,
          appliedDiscounts: allAppliedRules.length ? allAppliedRules : null,
          // Customer invoices post their journal entry in this same
          // transaction, so they are approved-and-locked from row insert.
          // Only a reverse invoice can neutralise them afterwards.
          isLocked: true,
          lockedAt: new Date(),
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      await saveIssuer(tx, "invoice", inv.id, issuer);

      for (let i = 0; i < totals.lines.length; i++) {
        const ln = totals.lines[i];
        const [invoiceLine] = await tx.insert(customerInvoiceLinesTable).values({
          invoiceId: inv.id,
          soLineId: soLineByIdx[i] || null,
          productId: (ln.productId as number | null) ?? null,
          description: ln.description,
          quantity: String(ln.quantity),
          unitPrice: String(ln.unitPrice),
          discountPct: String(ln.discountPct),
          taxRate: String(ln.taxRate),
          lineTotal: String(ln.lineTotal),
        }).returning();
        if (soLineByIdx[i]) {
          if (ln.productId != null) {
            await allocateDeliveryIssueCost(tx, {
              companyId: getCompanyId(req), invoiceLineId: invoiceLine.id,
              soLineId: soLineByIdx[i], productId: ln.productId, quantity: ln.quantity,
            });
          }
          await tx
            .update(salesOrderLinesTable)
            .set({ invoicedQty: sql`${salesOrderLinesTable.invoicedQty}::numeric + ${ln.quantity}` })
            .where(eq(salesOrderLinesTable.id, soLineByIdx[i]));
        }
      }

      // ====== Post journal entry ======
      // Dr AR (total)  / Cr Sales Revenue (net)  / Cr VAT Output (vat)
      await recordSaleSellers(tx,getCompanyId(req),inv.id,req.session.userId!,req.body);
      // Plus optional Dr Sales Discount if order-level discount > 0.
      const lines: Array<{ systemKey: string; debit?: number; credit?: number; description?: string }> = [
        { systemKey: "ar", debit: totals.total, description: `فاتورة عميل ${reference}` },
      ];
      // Split the discount across its sources so each lands in the right
      // GL bucket: applied rules (line + order scope) → their configured
      // accountSystemKey, remainder (manually-entered line discountPct +
      // user-entered order discount) → sales_discount.
      const ruleDiscountSum = allAppliedRules.reduce((a, r) => a + r.amount, 0);
      const flatDiscount = +(totals.discount - ruleDiscountSum).toFixed(2);
      if (flatDiscount > 0)
        lines.push({ systemKey: "sales_discount", debit: flatDiscount, description: "خصم مبيعات" });
      for (const r of allAppliedRules)
        lines.push({
          systemKey: r.accountSystemKey,
          debit: r.amount,
          description: `خصم: ${r.name} (${r.reasonCode})`,
        });
      if (totals.subtotal > 0)
        lines.push({ systemKey: "sales_revenue", credit: totals.subtotal, description: "إيرادات مبيعات" });
      if (totals.vat > 0)
        lines.push({ systemKey: "vat_output", credit: totals.vat, description: "ضريبة القيمة المضافة 15%" });
      // Re-balance: AR = subtotal - discount + vat; we debited total but
      // we credited the gross subtotal & vat then debited the discount.
      // total = subtotal - discount + vat → AR(debit) + sales_discount(debit) = sales_revenue(credit) + vat(credit)
      await postJournalEntry(
        tx,
        {
          entryDate: invoiceDate,
          description: `فاتورة عميل — ${reference}`,
          reference,
          source: "manual",
          sourceRef: reference,
          createdBy: req.session?.userId ?? null,
          status: "posted",
          companyId: getCompanyId(req),
        },
        lines,
      );

      // Update customer aggregates.
      await tx
        .update(customersTable)
        .set({
          totalOrders: sql`${customersTable.totalOrders} + 1`,
          totalSpent: sql`${customersTable.totalSpent}::numeric + ${totals.total}`,
        })
        .where(eq(customersTable.id, customer.id));

      // Mark SO as invoiced if all lines fully invoiced.
      if (so) {
        const updated = await tx
          .select({ qty: salesOrderLinesTable.quantity, inv: salesOrderLinesTable.invoicedQty })
          .from(salesOrderLinesTable)
          .where(eq(salesOrderLinesTable.soId, so.id));
        const allInvoiced = updated.every((l) => Number(l.qty) - Number(l.inv) <= 1e-6);
        if (allInvoiced)
          await tx.update(salesOrdersTable).set({ status: "invoiced" }).where(eq(salesOrdersTable.id, so.id));
      }

      // Phase-5 intercompany mirror: when the customer is linked to a
      // sibling company, auto-emit a supplier invoice in that company
      // inside this same transaction. Failures roll the whole sale back.
      await mirrorSalesInvoice({
        invoiceId: inv.id,
        sourceCompanyId: getCompanyId(req),
        actor: {
          userId: req.session?.userId ?? null,
          userName: null,
        },
        tx,
      });

      return {
        inv,
        zatcaPayload: {
          invoiceId: inv.id,
          invoiceNumber: reference,
          issueDate: new Date(invoiceDate),
          invoiceType: "standard" as const,
          sellerName: sellerNameForZatca,
          sellerVat: sellerVatForZatca,
          buyerName: customer.name,
          buyerVat: customer.taxNumber ?? null,
          totalExclVat: Number(totals.subtotal.toFixed(2)),
          vatAmount: Number(totals.vat.toFixed(2)),
          totalInclVat: Number(totals.total.toFixed(2)),
          branchId: so?.branchId ?? null,
        },
      };
    });
    if (res.getHeader("Idempotency-Replayed")) {
      res.status(201).json(serializeMoneyDoc(result.inv)); return;
    }
    // Module hook: auto-submit the AR invoice to ZATCA Phase 2
    // (standard / clearance path) AFTER the transaction has
    // committed — otherwise the worker can race ahead and fail the
    // FK against customer_invoices that aren't visible yet.
    void processInvoiceForZatca(result.zatcaPayload).catch((e: unknown) => {
      req.log.warn(
        { err: e, invoiceId: result.inv.id },
        "ZATCA auto-submit failed (queued for retry)",
      );
    });
    // Module hook: notify the customer via WhatsApp/SMS that a new
    // invoice was issued. Only fires when (a) a messaging provider
    // is configured (sendMessage gracefully no-ops otherwise via
    // MissingCredentialError) and (b) the customer has a phone.
    // Fire-and-forget so the API response isn't blocked.
    void (async () => {
      try {
        const [cust] = await db
          .select({ phone: customersTable.phone, name: customersTable.name })
          .from(customersTable)
          .where(eq(customersTable.id, result.inv.customerId));
        if (!cust?.phone) return;
        // Compose a customer notification that bundles (a) a
        // human-readable line, (b) the public pay-link the
        // customer can tap to settle the invoice, and (c) the
        // invoice PDF as a WhatsApp document attachment when a
        // PDF URL is available. The portal hosts both the pay
        // page and the rendered PDF under deterministic paths
        // so we can build them from the invoice reference.
        const baseUrl =
          (process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/$/, "") || "";
        const payLink = baseUrl
          ? `${baseUrl}/portal/invoices/${result.inv.id}/pay`
          : null;
        // Attach the ZATCA Phase-1 compact QR as the WhatsApp
        // template's image header — Saudi tax law requires the
        // QR to be presented to the buyer, and Meta requires the
        // header media to be a publicly-fetchable URL.
        const qrUrl = baseUrl
          ? `${baseUrl}${buildSignedInvoiceQrPath(result.inv.id)}`
          : undefined;
        await sendByTemplate({
          templateName: "invoice_issued",
          to: cust.phone,
          variables: {
            customer_name: cust.name,
            invoice_no: result.inv.reference,
            total: String(result.inv.total),
            pay_link: payLink ?? "",
          },
          branchId: result.inv.branchId ?? null,
          mediaUrl: qrUrl,
          mediaType: "image",
          mediaFilename: `zatca-qr-${result.inv.reference}.png`,
        });
      } catch (e) {
        req.log.warn(
          { err: e, invoiceId: result.inv.id },
          "invoice notification dispatch failed",
        );
      }
    })();
    res.status(201).json(serializeMoneyDoc(result.inv));
  } catch (err) {
    req.log.error({ err }, "create customer invoice");
    handleRouteError(err, res);
  }
});

// Hard-delete a customer invoice. Refuses to touch a locked invoice — the
// only legal correction path for an issued AR invoice is a reverse entry
// via /sales/invoices/:id/reverse so the ledger trail stays intact.
router.delete("/sales/invoices/:id", financeGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Bad id" }); return;
    }
    const [current] = await db
      .select()
      .from(customerInvoicesTable)
      .where(and(eq(customerInvoicesTable.id, id), eq(customerInvoicesTable.companyId, getCompanyId(req))));
    if (!current) { res.status(404).json({ error: "Not found" }); return; }
    if (current.isLocked) {
      res.status(409).json({
        error: "لا يمكن حذف فاتورة معتمدة/مقفلة. استخدم قيد عكسي بدلاً من ذلك.",
        code: "INVOICE_LOCKED",
      });
      return;
    }
    await db.transaction(async (tx) => {
      // Auto-void any intercompany mirror in the sibling company so
      // we don't leave a dangling supplier invoice behind when the
      // source draft is destroyed.
      await voidMirrorForSourceTx(tx, "sales_invoice", id, {
        userId: req.session?.userId ?? null,
        userName: null,
      });
      await tx.delete(customerInvoiceLinesTable).where(eq(customerInvoiceLinesTable.invoiceId, id));
      await tx.delete(customerInvoicesTable).where(and(eq(customerInvoicesTable.id, id), eq(customerInvoicesTable.companyId, getCompanyId(req))));
    });
    void recordAudit(req, {
      action: "delete",
      entity: "customer_invoice",
      details: `حذف فاتورة عميل مسودة ${current.reference}`,
      severity: "warning",
    });
    res.json({ ok: true });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// Reverse a locked customer invoice. Creates a sibling invoice with
// negated totals, links the pair via reverses_id / reversed_by_id, posts
// a reverse journal entry, rolls back customer aggregates, and clears
// invoicedQty on the originating SO lines — all inside one DB transaction.
const CustomerReverseBody = z.object({
  reason: z.string().trim().min(3, "السبب مطلوب").max(500),
});

router.post("/sales/invoices/:id/reverse", financeGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Bad id" }); return;
    }
    const { reason } = CustomerReverseBody.parse(req.body ?? {});
    const reverseCompanyId = getCompanyId(req);

    const result = await financialTransaction(req, async (tx) => {
      // Allocation capacity is shared with SO invoicing. Lock the parent
      // before the invoice, consistently with return issuance.
      const [source] = await tx.select({ soId: customerInvoicesTable.soId }).from(customerInvoicesTable)
        .where(and(eq(customerInvoicesTable.id, id), eq(customerInvoicesTable.companyId, reverseCompanyId)));
      if (source?.soId) {
        await tx.select({ id: salesOrdersTable.id }).from(salesOrdersTable)
          .where(and(eq(salesOrdersTable.id, source.soId), eq(salesOrdersTable.companyId, reverseCompanyId))).for("update");
      }
      const [orig] = await tx
        .select()
        .from(customerInvoicesTable)
        .where(and(eq(customerInvoicesTable.id, id), eq(customerInvoicesTable.companyId, reverseCompanyId))).for("update");
      if (!orig) throw Object.assign(new Error("الفاتورة غير موجودة"), { httpStatus: 404 });
      if (!orig.isLocked) {
        throw Object.assign(
          new Error("لا يمكن عكس فاتورة غير مقفلة."),
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
      if (Number(orig.amountPaid) > 0) {
        throw Object.assign(
          new Error("لا يمكن عكس فاتورة عليها مدفوعات. قم بإلغاء/عكس سند القبض أولاً."),
          { httpStatus: 409 },
        );
      }

      const origLines = await tx
        .select()
        .from(customerInvoiceLinesTable)
        .where(eq(customerInvoiceLinesTable.invoiceId, orig.id));

      const reverseRef = `REV-${orig.reference}`;
      const now = new Date();
      const [reverse] = await tx
        .insert(customerInvoicesTable)
        .values({
          companyId: orig.companyId,
          reference: reverseRef,
          soId: orig.soId,
          customerId: orig.customerId,
          customerName: orig.customerName,
          branchId: orig.branchId,
          salesRepId: orig.salesRepId,
          status: "cancelled",
          invoiceDate: now.toISOString().slice(0, 10),
          dueDate: null,
          subtotal: String(-Number(orig.subtotal)),
          discount: String(-Number(orig.discount)),
          vat: String(-Number(orig.vat)),
          total: String(-Number(orig.total)),
          amountPaid: "0",
          notes: `قيد عكسي للفاتورة ${orig.reference} — ${reason}`,
          source: "manual",
          sourceRef: orig.reference,
          reversesId: orig.id,
          isLocked: true,
          lockedAt: now,
          reversedReason: reason,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      if (!reverse) throw new Error("Failed to create reverse customer invoice");

      // Mirror negated lines so reports/totals stay reconciled.
      for (const ln of origLines) {
        await tx.insert(customerInvoiceLinesTable).values({
          invoiceId: reverse.id,
          soLineId: ln.soLineId,
          productId: ln.productId,
          description: ln.description,
          quantity: String(-Number(ln.quantity)),
          unitPrice: ln.unitPrice,
          discountPct: ln.discountPct,
          taxRate: ln.taxRate,
          lineTotal: String(-Number(ln.lineTotal)),
        });
        // Release the SO-line invoicedQty so the SO can be re-invoiced.
        if (ln.soLineId) {
          await tx
            .update(salesOrderLinesTable)
            .set({
              invoicedQty: sql`GREATEST(${salesOrderLinesTable.invoicedQty}::numeric - ${Number(ln.quantity)}, 0)`,
            })
            .where(eq(salesOrderLinesTable.id, ln.soLineId));
        }
      }

      // Pair original ↔ reverse.
      await tx
        .update(customerInvoicesTable)
        .set({
          reversedById: reverse.id,
          reversedReason: reason,
          status: "cancelled",
        })
        .where(and(eq(customerInvoicesTable.id, orig.id), eq(customerInvoicesTable.companyId, reverseCompanyId)));
      await cancelSellerInvoice(tx,reverseCompanyId,orig.id,req.session.userId!);
      await saveIssuer(tx,"invoice",reverse.id,await documentIssuer(reverseCompanyId,"invoice",orig.id));

      // Roll back customer aggregates.
      await tx
        .update(customersTable)
        .set({
          totalOrders: sql`GREATEST(${customersTable.totalOrders} - 1, 0)`,
          totalSpent: sql`GREATEST(${customersTable.totalSpent}::numeric - ${Number(orig.total)}, 0)`,
        })
        .where(eq(customersTable.id, orig.customerId));

      // Find and reverse the journal entry posted at creation time. The
      // POST handler uses source='manual' + sourceRef=reference.
      // Tenant scope REQUIRED: invoice references are unique only
      // within a company, so without `companyId` a collision could
      // let one tenant reverse another tenant's posted journal entry.
      const [origJe] = await tx
        .select({ id: journalEntriesTable.id })
        .from(journalEntriesTable)
        .where(
          and(
            eq(journalEntriesTable.companyId, reverseCompanyId),
            eq(journalEntriesTable.source, "manual"),
            eq(journalEntriesTable.sourceRef, orig.reference),
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
          reverseCompanyId,
          reason,
        );
        reverseJournalId = rev.id;
      }

      // Auto-void any intercompany mirror so the sibling company's
      // supplier invoice flips to cancelled inside this same transaction.
      await voidMirrorForSourceTx(tx, "sales_invoice", orig.id, {
        userId: req.session?.userId ?? null,
        userName: null,
      });

      return { reverse, reverseJournalId };
    });

    void recordAudit(req, {
      action: "update",
      entity: "customer_invoice",
      details: `قيد عكسي لفاتورة عميل #${id}: ${reason}`,
      severity: "warning",
    });
    res.json({
      ok: true,
      reverse: serializeMoneyDoc(result.reverse),
      reverseJournalId: result.reverseJournalId,
    });
  } catch (err) {
    if (err instanceof ClosedPeriodError) {
      res.status(403).json({ error: err.message }); return;
    }
    const tagged = err as { httpStatus?: number };
    if (typeof tagged?.httpStatus === "number") {
      res.status(tagged.httpStatus).json({
        error: err instanceof Error ? err.message : "Bad request",
      });
      return;
    }
    req.log.error({ err }, "reverse customer invoice");
    handleRouteError(err, res);
  }
});

// ===================================================================
// Customer Receipts
// ===================================================================
const ReceiptBody = z.object({
  customerId: z.number().int(),
  receiptDate: z.string().optional(),
  amount: z.number().positive(),
  paymentMethod: z.enum(["cash", "bank", "card", "transfer", "stc"]).default("cash"),
  bankRef: z.string().nullable().optional(),
  // Allocation: list of {invoiceId, amount}. Sum must equal amount.
  allocations: z
    .array(z.object({ invoiceId: z.number().int(), amount: z.number().positive() }))
    .min(1),
});

router.get("/sales/receipts", financeGuard, async (req, res) => {
  try {
    const { customerId } = req.query;
    const rows = await db
      .select({ receipt: customerReceiptsTable })
      .from(customerReceiptsTable)
      .innerJoin(customersTable, eq(customersTable.id, customerReceiptsTable.customerId))
      .where(and(eq(customersTable.companyId, getCompanyId(req)), customerId ? eq(customerReceiptsTable.customerId, Number(customerId)) : sql`true`))
      .orderBy(desc(customerReceiptsTable.createdAt))
      .limit(200);
    res.json(rows.map(({ receipt: r }) => ({ ...r, amount: Number(r.amount) })));
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/sales/receipts", financeGuard, async (req, res) => {
  try {
    const body = ReceiptBody.parse(req.body);
    const allocSum = body.allocations.reduce((a, x) => a + x.amount, 0);
    if (Math.abs(allocSum - body.amount) > 0.01)
      { res.status(400).json({ error: "مجموع التوزيع يجب أن يساوي مبلغ السند" }); return; }

    const companyId = getCompanyId(req);
    const result = await financialTransaction(req, async (tx) => {
      const [customer] = await tx
        .select()
        .from(customersTable)
        .where(and(eq(customersTable.id, body.customerId), eq(customersTable.companyId, companyId)));
      if (!customer) throw new Error("العميل غير موجود");

      const reference = await nextRef(tx, "RCT");
      const receiptDate = body.receiptDate ?? new Date().toISOString().slice(0, 10);
      const [receipt] = await tx
        .insert(customerReceiptsTable)
        .values({
          reference,
          customerId: customer.id,
          customerName: customer.name,
          receiptDate,
          amount: String(body.amount),
          paymentMethod: body.paymentMethod,
          bankRef: body.bankRef ?? null,
          createdBy: req.session?.userId ?? null,
        })
        .returning();

      // Allocate to invoices and update each invoice's amount_paid + status.
      for (const a of body.allocations) {
        const [inv] = await tx.select().from(customerInvoicesTable).where(eq(customerInvoicesTable.id, a.invoiceId));
        if (!inv) throw new Error(`الفاتورة ${a.invoiceId} غير موجودة`);
        if (inv.customerId !== customer.id) throw new Error("الفاتورة لعميل مختلف");
        // Subtract issued/applied credit notes from the gross outstanding
        // before validating: collecting the original gross after a partial
        // credit would over-settle AR.
        const [{ creditsSum }] = await tx
          .select({
            creditsSum: sql<number>`coalesce(sum(${creditNotesTable.total}::numeric), 0)`,
          })
          .from(creditNotesTable)
          .where(
            and(
              eq(creditNotesTable.invoiceId, inv.id),
              inArray(creditNotesTable.status, ["issued", "applied"]),
            ),
          );
        const due = Number(inv.total) - Number(inv.amountPaid) - Number(creditsSum);
        if (due <= 0.01) throw new Error(`الفاتورة ${inv.reference} مسواة بالكامل (دفعات + إشعارات دائنة)`);
        if (a.amount > due + 0.01) throw new Error(`المبلغ يتجاوز المستحق على الفاتورة ${inv.reference}`);
        await tx.insert(customerReceiptAllocationsTable).values({
          receiptId: receipt.id,
          invoiceId: inv.id,
          amount: String(a.amount),
        });
        const newPaid = Number(inv.amountPaid) + a.amount;
        // Status reflects (paid + credits) vs. total so a fully-credited+paid
        // invoice flips to "paid" even when amount_paid alone < total.
        const settled = newPaid + Number(creditsSum);
        const newStatus =
          Number(inv.total) - settled <= 0.01
            ? "paid"
            : newPaid > 0
              ? "partially_paid"
              : inv.status;
        await tx
          .update(customerInvoicesTable)
          .set({ amountPaid: String(newPaid), status: newStatus })
          .where(eq(customerInvoicesTable.id, inv.id));
      }

      // Post the receipt journal: Dr cash/bank / Cr AR
      const cashKey = body.paymentMethod === "cash" ? "cash" : "bank";
      const je = await postJournalEntry(
        tx,
        {
          entryDate: receiptDate,
          description: `سند قبض ${reference}`,
          reference,
          source: "payment",
          sourceRef: reference,
          createdBy: req.session?.userId ?? null,
          status: "posted",
          companyId: getCompanyId(req),
        },
        [
          { systemKey: cashKey, debit: body.amount, description: `قبض من ${customer.name}` },
          { systemKey: "ar", credit: body.amount, description: "تسوية ذمم مدينة" },
        ],
      );
      await tx
        .update(customerReceiptsTable)
        .set({ journalEntryId: je.id })
        .where(eq(customerReceiptsTable.id, receipt.id));

      return receipt;
    });
    res.status(201).json({ ...result, amount: Number(result.amount) });
  } catch (err) {
    req.log.error({ err }, "create receipt");
    handleRouteError(err, res);
  }
});

// ===================================================================
// Credit Notes (returns)
// ===================================================================
const CreditNoteBody = z.object({
  operationalReturn: z.boolean().default(false),
  disposition: z.enum(["resale", "discard", "no_goods"]).optional(),
  settlementMethod: z.enum(["credit", "cash", "card", "transfer", "stc"]).default("credit"),
  proofRef: z.string().min(3).max(200).optional(),
  invoiceId: z.number().int().nullable().optional(),
  customerId: z.number().int(),
  noteDate: z.string().optional(),
  reason: z.string().nullable().optional(),
  restock: z.boolean().default(true),
  warehouseId: z.number().int().nullable().optional(),
  lines: z
    .array(
      z.object({
        invoiceLineId: z.number().int().nullable().optional(),
        productId: z.number().int().nullable().optional(),
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitPrice: z.number().min(0),
        taxRate: z.number().min(0).max(100).default(15),
      }),
    )
    .min(1),
});

router.get("/sales/credit-notes", customerReadGuard, async (req, res) => {
  try {
    const { customerId } = req.query;
    const rows = await db
      .select()
      .from(creditNotesTable)
      .where(and(eq(creditNotesTable.companyId, getCompanyId(req)), customerId ? eq(creditNotesTable.customerId, Number(customerId)) : sql`true`))
      .orderBy(desc(creditNotesTable.createdAt))
      .limit(200);
    res.json(rows.map(serializeMoneyDoc));
  } catch (err) {
    handleRouteError(err, res);
  }
});

export const creditNoteLimit = requireFinancialLimit("sales.credit_note_amount", (req) => {
    // Apply the same defaults and rounding as the issued document. In
    // particular, omitting taxRate must not reduce the authorization amount.
    const body = CreditNoteBody.parse(req.body);
    return computeTotals(body.lines.map((line) => ({
      ...line, productId: line.productId ?? null, discountPct: 0,
    })), 0).total;
  });
export const createCreditNoteHandler: RequestHandler = async (req, res) => {
  try {
    const body = CreditNoteBody.parse(req.body);
    const companyId = getCompanyId(req);
    const operationalBranch = body.invoiceId ? await returnInvoiceBranch(companyId, body.invoiceId) : undefined;
    const operationalPolicy = operationalBranch ? await returnPolicy(companyId, operationalBranch) : null;
    // An older API client must not bypass a newly configured company/branch policy.
    if (!body.operationalReturn && operationalBranch && operationalPolicy?.approval_above != null) {
      body.operationalReturn = true;
      body.disposition = body.restock ? "resale" : "no_goods";
      body.proofRef ??= `مرجع مستند قديم: ${body.invoiceId}`;
    }
    if (operationalBranch && body.restock) {
      const [company] = await db.select({ businessType: companiesTable.businessType }).from(companiesTable).where(eq(companiesTable.id, companyId));
      if (!operationalPolicy?.allow_resale || ["restaurant", "cafe", "cafeteria", "food", "fnb", "fb"].includes(company?.businessType ?? "")) {
        throw new FinancialRequestError("المنتج المحضر أو سياسة الفرع لا تسمح بإعادته لمخزون صالح للبيع", 400);
      }
    }
    if (body.operationalReturn) {
      if (!operationalBranch || !body.proofRef || !body.disposition || body.restock !== (body.disposition === "resale")) {
        throw new FinancialRequestError("يلزم مصدر نقطة بيع وإثبات الاستحقاق ومصير متوافق للمنتج", 400);
      }
      await returnAuthorize(req.session.userId!, companyId, "request", operationalBranch);
      const [sourceMoney] = await db.select({ currency: customerInvoicesTable.currencyCode })
        .from(customerInvoicesTable).where(and(eq(customerInvoicesTable.id, body.invoiceId!), eq(customerInvoicesTable.companyId, companyId)));
      if (sourceMoney?.currency !== "SAR") {
        throw new FinancialRequestError("مسار المرتجع التشغيلي حاليًا بعملة الدفاتر SAR فقط؛ رد العملة الأجنبية يحتاج معالجة صريحة ولا يُقدّر تلقائيًا", 400);
      }
    }
    const result = await financialTransaction(req, async (tx) => {
      const [customer] = await tx
        .select()
        .from(customersTable)
        .where(and(eq(customersTable.id, body.customerId), eq(customersTable.companyId, companyId)));
      if (!customer) throw new FinancialRequestError("العميل غير موجود", 404);

      await validateCreditNoteInventory(tx, companyId, body.warehouseId, body.lines);

      // ============== Source-document validation ==============
      // When the credit note is tied to an invoice we MUST verify that:
      //   1. the invoice belongs to the same customer (no cross-customer credit),
      //   2. each cited invoiceLineId actually lives on that invoice, and
      //   3. the returned quantity does not exceed (invoiced − already-credited),
      //      and the line amount does not exceed the original line value.
      // Without these checks a finance user could over-credit AR or restock
      // inventory for goods that were never sold — a critical accounting +
      // stock-integrity hole flagged by the prior code review.
      if (body.invoiceId != null) {
        const [srcInv] = await tx
          .select()
          .from(customerInvoicesTable)
          .where(and(eq(customerInvoicesTable.id, body.invoiceId), eq(customerInvoicesTable.companyId, companyId))).for("update");
        if (!srcInv) throw new FinancialRequestError("الفاتورة المصدر غير موجودة", 404);
        if (srcInv.customerId !== body.customerId)
          throw new FinancialRequestError("الفاتورة المصدر تخص عميلاً آخر", 400);
        if (srcInv.reversedById || srcInv.reversesId)
          throw new FinancialRequestError("لا يمكن إرجاع فاتورة معكوسة أو فاتورة عكسية", 409);

        const invLines = await tx
          .select()
          .from(customerInvoiceLinesTable)
          .where(eq(customerInvoiceLinesTable.invoiceId, body.invoiceId));
        const invLineById = new Map(invLines.map((l) => [l.id, l]));

        // Already-credited (issued/applied) qty + amount per invoice line.
        const priorCredits = await tx
          .select({
            invoiceLineId: creditNoteLinesTable.invoiceLineId,
            qty: sql<number>`coalesce(sum(${creditNoteLinesTable.quantity}::numeric), 0)`,
            amt: sql<number>`coalesce(sum(${creditNoteLinesTable.lineTotal}::numeric), 0)`,
          })
          .from(creditNoteLinesTable)
          .innerJoin(creditNotesTable, eq(creditNotesTable.id, creditNoteLinesTable.noteId))
          .where(
            and(
              eq(creditNotesTable.invoiceId, body.invoiceId),
              inArray(creditNotesTable.status, ["draft", "pending_approval", "issued", "applied"]),
            ),
          )
          .groupBy(creditNoteLinesTable.invoiceLineId);
        const priorByLine = new Map(
          priorCredits
            .filter((p) => p.invoiceLineId != null)
            .map((p) => [p.invoiceLineId as number, { qty: Number(p.qty), amt: Number(p.amt) }]),
        );

        for (const ln of body.lines) {
          if (ln.invoiceLineId == null) continue;
          const il = invLineById.get(ln.invoiceLineId);
          if (!il) throw new FinancialRequestError("البند لا يخص الفاتورة المصدر", 400);
          if ((ln.productId ?? null) !== il.productId) throw new FinancialRequestError("منتج المرتجع لا يطابق بند الفاتورة", 400);
          const prior = priorByLine.get(ln.invoiceLineId) ?? { qty: 0, amt: 0 };
          const remainingQty = Number(il.quantity) - prior.qty;
          if (ln.quantity > remainingQty + 1e-6)
            throw new FinancialRequestError(
              `الكمية المرتجعة (${ln.quantity}) تتجاوز المتبقي القابل للإرجاع (${remainingQty}) للبند "${il.description}"`,
              409,
            );
          const remainingAmt = Number(il.lineTotal) - prior.amt;
          const lineAmt = ln.quantity * ln.unitPrice * (1 + (ln.taxRate ?? 0) / 100);
          if (lineAmt > remainingAmt + 0.01)
            throw new FinancialRequestError(
              `قيمة الإرجاع للبند "${il.description}" تتجاوز المتبقي (${remainingAmt.toFixed(2)})`,
              409,
            );
          priorByLine.set(ln.invoiceLineId, { qty: prior.qty + ln.quantity, amt: prior.amt + lineAmt });
        }
      } else {
        // Free-form credit note (no source invoice): forbid invoiceLineId
        // references entirely so we never decrement an SO line we don't own.
        if (body.lines.some((l) => l.invoiceLineId != null))
          throw new FinancialRequestError("لا يمكن ربط بنود بفاتورة عند عدم اختيار فاتورة مصدر", 400);
      }
      // =========================================================

      const totalsLines = body.lines.map((ln) => ({
        productId: ln.productId ?? null,
        description: ln.description,
        quantity: ln.quantity,
        unitPrice: ln.unitPrice,
        discountPct: 0,
        taxRate: ln.taxRate,
      }));
      const totals = computeTotals(totalsLines, 0);
      const reference = await nextRef(tx, "CN");
      const noteDate = body.noteDate ?? new Date().toISOString().slice(0, 10);

      const warehouseId =
        body.warehouseId ?? (body.restock ? await getDefaultWarehouseId(tx, companyId) : null);
      let currencyCode = "SAR";
      if (body.invoiceId) {
        const [invoice] = await tx.select().from(customerInvoicesTable)
          .where(and(eq(customerInvoicesTable.id, body.invoiceId), eq(customerInvoicesTable.companyId, companyId)));
        currencyCode = invoice.currencyCode;
      }
      await originalInvoiceRate(tx, companyId, body.invoiceId ?? null, currencyCode);
      if (body.restock && warehouseId) {
        await restoreOriginalSaleCost(tx, {
          companyId, invoiceId: body.invoiceId ?? null, noteId: null,
          warehouseId, reference, createdBy: req.session?.userId ?? null, validateOnly: true,
          lines: body.lines.map((line) => ({ ...line, productId: line.productId ?? null, invoiceLineId: line.invoiceLineId ?? null })),
        });
      }

      // Insert header + lines as a draft. The JE / inventory restock /
      // invoice settlement are deferred to finalizeCreditNoteIssue so a
      // posting approval rule (doc_type=credit_note) can gate them.
      const [note] = await tx
        .insert(creditNotesTable)
        .values({
          companyId: getCompanyId(req),
          reference,
          invoiceId: body.invoiceId ?? null,
          currencyCode,
          customerId: customer.id,
          customerName: customer.name,
          noteDate,
          reason: body.reason ?? null,
          restock: body.restock,
          warehouseId,
          subtotal: String(totals.subtotal),
          vat: String(totals.vat),
          total: String(totals.total),
          status: "draft",
          createdBy: req.session?.userId ?? null,
        })
        .returning();

      for (let i = 0; i < totals.lines.length; i++) {
        const ln = totals.lines[i];
        const inputLine = body.lines[i];
        await tx.insert(creditNoteLinesTable).values({
          noteId: note.id,
          invoiceLineId: inputLine?.invoiceLineId ?? null,
          productId: (ln.productId as number | null) ?? null,
          description: ln.description,
          quantity: String(ln.quantity),
          unitPrice: String(ln.unitPrice),
          taxRate: String(ln.taxRate),
          lineTotal: String(ln.lineTotal),
        });
      }
      if (body.operationalReturn) {
        await tx.execute(sql`INSERT INTO return_controls(note_id,company_id,branch_id,created_by,fingerprint,disposition,settlement_method,proof_ref)
          VALUES(${note.id},${companyId},${operationalBranch!},${req.session.userId!},'',${body.disposition!},${body.settlementMethod},${body.proofRef!})`);
        const fingerprint = await returnFingerprint(tx, note.id);
        await tx.execute(sql`UPDATE return_controls SET fingerprint=${fingerprint} WHERE note_id=${note.id}`);
      }
      return note;
    });
    // The receipt intentionally references the persisted draft, not a stale
    // authorization decision. Never resubmit an issued note when rules change.
    const [persistedNote] = await db.select().from(creditNotesTable)
      .where(and(eq(creditNotesTable.id, result.id), eq(creditNotesTable.companyId, companyId)));
    if (!persistedNote) throw new FinancialRequestError("الإشعار الدائن غير موجود", 404);
    if (persistedNote.status === "issued" || persistedNote.status === "applied") {
      res.status(201).json(serializeMoneyDoc(persistedNote)); return;
    }
    if (persistedNote.status === "cancelled") throw new FinancialRequestError("الإشعار ملغى", 409);
    // Workflow-engine gate: posting approval. If a credit_note rule
    // matches, lock the row to pending_approval and return 202 — the
    // registered onApprove handler will run finalizeCreditNoteIssue.
    let forcedRoles: string[] | undefined;
    if (body.operationalReturn && operationalBranch) {
      const policy = await returnPolicy(companyId, operationalBranch);
      let canApprove = true;
      try { await returnAuthorize(req.session.userId!, companyId, "approve", operationalBranch); } catch { canApprove = false; }
      if (!canApprove || (policy.approval_above != null && Number(result.total) >= Number(policy.approval_above))) forcedRoles = ["manager"];
    }
    const submission = await submitForApproval({
      companyId: req.session.companyId!,
      docType: "credit_note",
      recordId: result.id,
      recordRef: result.reference,
      amount: Number(result.total),
      submittedByUserId: req.session?.userId ?? null,
      submittedByName: (req.session as { userName?: string } | undefined)?.userName ?? null,
      branchId: operationalBranch,
      forceRoles: forcedRoles,
      scopedBranchOnly: body.operationalReturn,
    });
    if (body.operationalReturn && submission.requestId) await db.execute(sql`UPDATE return_controls SET approval_id=${submission.requestId} WHERE note_id=${result.id} AND company_id=${companyId}`);
    if (submission.required) {
      const moved = await db
        .update(creditNotesTable)
        .set({ status: "pending_approval" })
        .where(and(eq(creditNotesTable.id, result.id), eq(creditNotesTable.companyId, companyId),
          inArray(creditNotesTable.status, ["draft", "pending_approval"]))).returning();
      if (!moved.length) {
        const [current] = await db.select().from(creditNotesTable)
          .where(and(eq(creditNotesTable.id, result.id), eq(creditNotesTable.companyId, companyId)));
        if (current && (current.status === "issued" || current.status === "applied")) {
          res.status(201).json(serializeMoneyDoc(current)); return;
        }
        throw new FinancialRequestError("تغيرت حالة الإشعار؛ أعد تحميله", 409);
      }
      void triggerEvent(getCompanyId(req), "record_created", "credit_note", { id: result.id, total: Number(result.total) });
      res.status(202).json({
        ok: false,
        pendingApproval: true,
        approvalRequestId: submission.requestId,
        id: result.id,
        reference: result.reference,
        message: "إشعار دائن بانتظار الاعتماد",
      });
      return;
    }
    // No approval required → finalize inline. The legacy issuance block
    // below was relocated into finalizeCreditNoteIssue() so both paths
    // (inline + onApprove) run identical logic.
    const issued = await finalizeCreditNoteIssue(result.id, req.session?.userId ?? null, getCompanyId(req));
    void triggerEvent(getCompanyId(req), "record_created", "credit_note", { id: issued.id, total: Number(issued.total) });
    res.status(201).json(serializeMoneyDoc(issued));
    return;

    // (legacy inline issuance block removed — see finalizeCreditNoteIssue)
  } catch (err) {
    req.log.error({ errorName: err instanceof Error ? err.name : "unknown", diagnosticRef: String(req.id) }, "create credit note");
    if (err instanceof FinancialRequestError) res.status(err.status).json({ error: err.message, diagnosticRef: String(req.id) });
    else handleRouteError(err, res);
  }
};
router.post("/sales/credit-notes", returnRequestGuard, creditNoteLimit, createCreditNoteHandler);

// Cancel an outstanding credit note. Posts a reversing JE (mirror of the
// original lines) and reverses any SO fulfilment counter adjustments the
// original credit note made. Refuses to cancel a note already cancelled.
// Applied notes can still be cancelled — the JE reversal restores AR and
// the SO recompute below puts the SO back in the right state.
router.post("/sales/credit-notes/:id/cancel", salesWriteGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    // Workflow-engine gate: cancellation reverses AR + inventory, so admins
    // can require approval on any credit_note rule. Once the chain
    // completes, the registered onApprove handler flips status to
    // cancelled. Reversing JEs are still posted only inside this route.
    {
      const [pre] = await db.select().from(creditNotesTable).where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.companyId, getCompanyId(req))));
      if (!pre) { res.status(404).json({ error: "Not found" }); return; }
      if (pre.status === "cancelled") {
        res.status(409).json({ error: "الإشعار ملغى مسبقاً" }); return;
      }
      if (pre) {
        const submission = await submitForApproval({
          companyId: req.session.companyId!,
          docType: "credit_note_cancel",
          recordId: id,
          recordRef: pre.reference,
          amount: Number(pre.total),
          submittedByUserId: req.session?.userId ?? null,
          submittedByName: (req.session as { userName?: string } | undefined)?.userName ?? null,
        });
        if (submission.required) {
          res.status(202).json({
            ok: false,
            pendingApproval: true,
            approvalRequestId: submission.requestId,
            message: "إلغاء الإشعار الدائن بانتظار الاعتماد",
          });
          return;
        }
      }
    }
    // Delegated to shared finalize helper so /cancel and the
    // workflow-engine onApprove path always run identical logic.
    const result = await finalizeCreditNoteCancellation(id, req.session?.userId ?? null, getCompanyId(req));
    res.json(serializeMoneyDoc(result));
  } catch (err) {
    req.log.error({ err }, "cancel credit note");
    handleRouteError(err, res);
  }
});

// ===================================================================
// Reports — AR aging + sales by rep + top customers
// ===================================================================
router.get("/sales/reports/ar-aging", reportReadGuard, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Subtract issued/applied credit notes from each invoice's outstanding so
    // partially-credited invoices don't keep appearing at their gross AR.
    const rows = await db
      .select({
        customerId: customerInvoicesTable.customerId,
        customerName: customerInvoicesTable.customerName,
        reference: customerInvoicesTable.reference,
        invoiceDate: customerInvoicesTable.invoiceDate,
        dueDate: customerInvoicesTable.dueDate,
        total: customerInvoicesTable.total,
        amountPaid: customerInvoicesTable.amountPaid,
        creditsApplied: sql<number>`coalesce((
          select sum(cn.total::numeric) from credit_notes cn
          where cn.invoice_id = ${customerInvoicesTable.id}
            and cn.company_id = ${getCompanyId(req)}
            and cn.status in ('issued','applied')
        ), 0)`,
      })
      .from(customerInvoicesTable)
      .where(and(eq(customerInvoicesTable.companyId, getCompanyId(req)), inArray(customerInvoicesTable.status, ["open", "partially_paid"])));

    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
    const perCustomer = new Map<number, { customerName: string; total: number; current: number; d30: number; d60: number; d90: number; over90: number }>();
    for (const r of rows) {
      const due = Number(r.total) - Number(r.amountPaid) - Number(r.creditsApplied);
      if (due <= 0) continue;
      const dueDate = r.dueDate ?? r.invoiceDate;
      const ageDays = Math.floor((Date.parse(today) - Date.parse(dueDate)) / 86_400_000);
      const bucket =
        ageDays <= 0 ? "current" : ageDays <= 30 ? "d30" : ageDays <= 60 ? "d60" : ageDays <= 90 ? "d90" : "over90";
      buckets[bucket] += due;
      const cust = perCustomer.get(r.customerId) ?? {
        customerName: r.customerName,
        total: 0,
        current: 0,
        d30: 0,
        d60: 0,
        d90: 0,
        over90: 0,
      };
      cust[bucket] += due;
      cust.total += due;
      perCustomer.set(r.customerId, cust);
    }

    res.json({
      asOf: today,
      buckets,
      total: +Object.values(buckets).reduce((a, b) => a + b, 0).toFixed(2),
      customers: Array.from(perCustomer.entries()).map(([customerId, v]) => ({
        customerId,
        ...v,
      })),
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.get("/sales/reports/summary", reportReadGuard, async (req, res) => {
  try {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

    const [quotes] = await db
      .select({
        totalCount: sql<number>`count(*)::int`,
        totalValue: sql<number>`coalesce(sum(${quotationsTable.total}::numeric), 0)`,
        accepted: sql<number>`count(*) filter (where ${quotationsTable.status} = 'accepted')::int`,
      })
      .from(quotationsTable)
      .where(and(eq(quotationsTable.companyId, getCompanyId(req)), gte(quotationsTable.quoteDate, monthStart)));

    const [orders] = await db
      .select({
        totalCount: sql<number>`count(*)::int`,
        totalValue: sql<number>`coalesce(sum(${salesOrdersTable.total}::numeric), 0)`,
      })
      .from(salesOrdersTable)
      .where(and(eq(salesOrdersTable.companyId, getCompanyId(req)), gte(salesOrdersTable.orderDate, monthStart)));

    const [invoices] = await db
      .select({
        outstanding: sql<number>`coalesce(sum(
          ${customerInvoicesTable.total}::numeric
          - ${customerInvoicesTable.amountPaid}::numeric
          - coalesce((
              select sum(cn.total::numeric) from credit_notes cn
              where cn.invoice_id = ${customerInvoicesTable.id}
                and cn.company_id = ${getCompanyId(req)}
                and cn.status in ('issued','applied')
            ), 0)
        ) filter (where ${customerInvoicesTable.status} in ('open','partially_paid')), 0)`,
        thisMonth: sql<number>`coalesce(sum(${customerInvoicesTable.total}::numeric) filter (where ${customerInvoicesTable.invoiceDate} >= ${monthStart}), 0)`,
      })
      .from(customerInvoicesTable)
      .where(eq(customerInvoicesTable.companyId, getCompanyId(req)));

    res.json({
      monthStart,
      quotations: { count: quotes.totalCount, value: Number(quotes.totalValue), accepted: quotes.accepted },
      salesOrders: { count: orders.totalCount, value: Number(orders.totalValue) },
      invoices: { outstanding: Number(invoices.outstanding), thisMonth: Number(invoices.thisMonth) },
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// Re-build a quotation's outgoing email body from the latest DB state.
// Used by the background retry worker so each redispatch reflects current
// totals/valid_until rather than the stale snapshot stored on the
// original outbox row. Returns { ok: false } when the quotation no longer
// exists or its lifecycle no longer allows sending (e.g. accepted /
// rejected / expired — in those states resending would confuse the
// customer).
export async function renderQuotationEmailById(id: number): Promise<
  | {
      ok: true;
      head: typeof quotationsTable.$inferSelect;
      subject: string;
      body: string;
    }
  | { ok: false; status: 400 | 404 | 409; error: string }
> {
  if (!Number.isFinite(id)) return { ok: false, status: 400, error: "Bad id" };
  const [q] = await db
    .select()
    .from(quotationsTable)
    .where(eq(quotationsTable.id, id));
  if (!q) return { ok: false, status: 404, error: "العرض غير موجود" };
  if (q.status !== "draft" && q.status !== "sent") {
    return {
      ok: false,
      status: 409,
      error: `لا يمكن إرسال عرض في حالة ${q.status}`,
    };
  }
  const subject = `عرض سعر ${q.reference}`;
  const body =
    `السلام عليكم،\n\nنرفق لكم عرض السعر ${q.reference} بإجمالي ${q.total} ر.س ` +
    `يسري حتى ${q.validUntil ?? "—"}.\n\nمع التحية.`;
  return { ok: true, head: q, subject, body };
}

// ===================================================================
// Quotation: send by email
// Marks the quotation as 'sent', stamps sent_at, and (when wired to a real
// MTA) would dispatch the PDF to the customer's email. We keep the wiring
// pluggable so the route stays useful before SMTP/integrations are configured.
// ===================================================================
router.post("/sales/quotations/:id/send", salesWriteGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = z.object({ to: z.string().email().optional(), subject: z.string().optional() });
    const body = Body.parse(req.body ?? {});
    const [q] = await db.select().from(quotationsTable).where(and(eq(quotationsTable.id, id), eq(quotationsTable.companyId, getCompanyId(req))));
    if (!q) { res.status(404).json({ error: "العرض غير موجود" }); return; }
    if (q.status !== "draft" && q.status !== "sent") {
      res.status(409).json({ error: `لا يمكن إرسال عرض في حالة ${q.status}` });
      return;
    }
    // Tenant scope: only reveal customer details if they belong to the caller's tenant.
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(and(eq(customersTable.id, q.customerId), eq(customersTable.companyId, getCompanyId(req))));
    const recipient = body.to ?? customer?.email ?? null;
    if (!recipient) { res.status(400).json({ error: "لا يوجد بريد إلكتروني للعميل" }); return; }
    const subject = body.subject ?? `عرض سعر ${q.reference}`;
    const emailBody =
      `السلام عليكم،\n\nنرفق لكم عرض السعر ${q.reference} بإجمالي ${q.total} ر.س ` +
      `يسري حتى ${q.validUntil ?? "—"}.\n\nمع التحية.`;

    // Attempt real dispatch first (SMTP via nodemailer when SMTP_* env vars
    // are configured). Only flip the quotation to status='sent' when the
    // mail is actually accepted by the provider — otherwise we honestly
    // queue it and surface a clear reason to the caller so the user-visible
    // "send by email" action never lies about delivery.
    const dispatch = await sendMail({ to: recipient, subject, body: emailBody });
    // Failed dispatches land as status='failed' (not 'queued') so the
    // shared background retry worker in lib/invoice-email-retry-worker.ts
    // sweeps them on the same exponential-backoff schedule used for
    // customer invoices. The worker re-renders the latest quotation
    // body before each retry.
    const outboxStatus = dispatch.sent ? "sent" : "failed";
    const errorMsg = dispatch.sent ? null : dispatch.reason ?? "delivery failed";
    // Task #208
    const [delivery] = recipientStatusesFromDispatch(dispatch, [recipient]);
    const messageId = dispatch.sent ? dispatch.messageId : null;

    const result = await db.transaction(async (tx) => {
      const inserted = await tx.execute(sql`
        INSERT INTO sales_email_outbox
          (kind, ref_id, reference, recipient, subject, body, status, error,
           created_by, sent_at,
           message_id, delivery_status, delivery_reason, delivered_at)
        VALUES ('quotation', ${q.id}, ${q.reference}, ${recipient}, ${subject},
                ${emailBody}, ${outboxStatus}, ${errorMsg},
                ${req.session?.userId ?? null},
                ${dispatch.sent ? sql`now()` : sql`null`},
                ${messageId}, ${delivery?.status ?? "pending"},
                ${delivery?.reason ?? null},
                ${delivery?.deliveredAt ?? null})
        RETURNING id, status, sent_at, error;
      `);
      const rows = (inserted as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (inserted as unknown as Array<Record<string, unknown>>);
      // Only mark the quotation as "sent" once the email actually went out.
      // A queued (undelivered) row keeps the quote in its prior state so
      // ops can see it still needs dispatch.
      const [updated] = dispatch.sent
        ? await tx
            .update(quotationsTable)
            .set({ status: "sent", sentAt: new Date() })
            .where(eq(quotationsTable.id, id))
            .returning()
        : await tx.select().from(quotationsTable).where(eq(quotationsTable.id, id));
      req.log.info(
        {
          quotationId: id,
          recipient,
          outboxId: rows?.[0]?.id,
          subject,
          dispatched: dispatch.sent,
          reason: dispatch.sent ? undefined : dispatch.reason,
        },
        "quotation.send",
      );
      return { outbox: rows?.[0], quotation: updated };
    });
    res.json({
      ok: dispatch.sent,
      dispatched: dispatch.sent,
      sentTo: recipient,
      outboxId: result.outbox?.id,
      outboxStatus,
      reason: dispatch.sent ? undefined : dispatch.reason,
      mailerConfigured: isMailerConfigured(),
      quotation: serializeMoneyDoc(result.quotation),
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===================================================================
// Customer invoice: send branded PDF to the customer's email.
// Mirrors `POST /procurement/purchase-orders/:id/send`: builds the same
// PDF served by `/sales/invoices/:id/pdf`, dispatches via `sendMail`,
// records the attempt in `sales_email_outbox`, and — only on successful
// delivery — stamps `sent_to_customer_at` / `sent_to_customer_email`.
// ===================================================================
router.post("/sales/invoices/:id/send", financeGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }
    const Body = z.object({
      to: z.string().email().optional(),
      subject: z.string().optional(),
      message: z.string().optional(),
    });
    const body = Body.parse(req.body ?? {});
    const [head] = await db
      .select()
      .from(customerInvoicesTable)
      .where(and(eq(customerInvoicesTable.id, id), eq(customerInvoicesTable.companyId, getCompanyId(req))));
    if (!head) { res.status(404).json({ error: "الفاتورة غير موجودة" }); return; }
    if (head.status === "draft") {
      res.status(409).json({ error: "لا يمكن إرسال فاتورة في حالة مسودة" });
      return;
    }
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.id, head.customerId));
    const recipient = body.to ?? customer?.email ?? null;
    if (!recipient) {
      res.status(400).json({ error: "لا يوجد بريد إلكتروني للعميل" });
      return;
    }

    const rendered=await renderCustomerInvoicePdfById(id,getCompanyId(req));
    if(!rendered.ok){res.status(rendered.status).json({error:rendered.error});return;}
    const pdf=rendered.pdf;

    const subject = body.subject ?? `فاتورة ${head.reference} / Invoice`;
    const emailBody = body.message ?? [
      `السلام عليكم،`,
      ``,
      `نرفق لكم الفاتورة رقم ${head.reference} بإجمالي ${head.total} ${head.currencyCode}` +
        (head.dueDate ? ` (تاريخ الاستحقاق ${head.dueDate}).` : `.`),
      `للاطلاع والسداد في حينه، شكراً لتعاملكم معنا.`,
      ``,
      `---`,
      ``,
      `Dear ${head.customerName},`,
      ``,
      `Please find attached invoice ${head.reference} for ${head.total} ${head.currencyCode}` +
        (head.dueDate ? ` (due on ${head.dueDate}).` : `.`),
      `Thank you for your business.`,
    ].join("\n");
    const attachmentFilename = `invoice-${head.reference}.pdf`;

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
    // Task #208
    const [delivery] = recipientStatusesFromDispatch(dispatch, [recipient]);
    const messageId = dispatch.sent ? dispatch.messageId : null;

    const outboxId = await db.transaction(async (tx) => {
      const inserted = await tx.execute(sql`
        INSERT INTO sales_email_outbox
          (kind, ref_id, reference, recipient, subject, body, status, error,
           created_by, sent_at,
           message_id, delivery_status, delivery_reason, delivered_at)
        VALUES ('customer_invoice', ${head.id}, ${head.reference}, ${recipient},
                ${subject}, ${emailBody}, ${outboxStatus}, ${errorMsg},
                ${req.session?.userId ?? null},
                ${dispatch.sent ? sql`now()` : sql`null`},
                ${messageId}, ${delivery?.status ?? "pending"},
                ${delivery?.reason ?? null},
                ${delivery?.deliveredAt ?? null})
        RETURNING id;
      `);
      const rows = (inserted as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (inserted as unknown as Array<Record<string, unknown>>);
      if (dispatch.sent) {
        await tx
          .update(customerInvoicesTable)
          .set({ sentToCustomerAt: new Date(), sentToCustomerEmail: recipient })
          .where(eq(customerInvoicesTable.id, head.id));
      }
      return rows?.[0]?.id as number | undefined;
    });

    if (!dispatch.sent) {
      res.status(502).json({
        ok: false,
        dispatched: false,
        sentTo: recipient,
        outboxId,
        outboxStatus,
        mailerConfigured: isMailerConfigured(),
        reason: dispatch.reason,
      });
      return;
    }
    void recordAudit(req, {
      action: "send",
      entity: "customer_invoice",
      details: `${head.reference} → ${recipient}`,
    });
    res.json({
      ok: true,
      dispatched: true,
      sentTo: recipient,
      sentAt: new Date().toISOString(),
      outboxId,
      outboxStatus,
      mailerConfigured: true,
    });
  } catch (err) {
    req.log.error({ err }, "send customer invoice failed");
    handleRouteError(err, res);
  }
});

// ===================================================================
// Commission posting
// Computes commissions from invoices in [from, to] (same logic as the
// commission-report) and posts a single journal entry per period:
//   Dr commission_expense / Cr commission_payable.
// Idempotent on (period, source='commission_run').
// ===================================================================
router.post("/sales/commissions/post", financeGuard, async (req, res) => {
  try {
    const Body = z.object({ from: z.string(), to: z.string() });
    const { from, to } = Body.parse(req.body);
    const periodRef = `COMM-${from}_${to}`;
    const commissionCompanyId = getCompanyId(req);

    const result = await db.transaction(async (tx) => {
      // Idempotency: if a posted JE already exists for this period (matched
      // by reference + sourceRef), return the existing total instead of
      // re-posting commission expense / payable. This protects against
      // accidental double-clicks and replayed requests corrupting GL.
      // Tenant scope REQUIRED: periodRef is the same string across
      // every company (`COMM-<from>_<to>`), so without `companyId`
      // tenant A's commission run would falsely report
      // "already posted" the first time tenant B closes the period.
      const [existing] = await tx
        .select({ id: journalEntriesTable.id })
        .from(journalEntriesTable)
        .where(
          and(
            eq(journalEntriesTable.companyId, commissionCompanyId),
            eq(journalEntriesTable.reference, periodRef),
            eq(journalEntriesTable.sourceRef, periodRef),
          ),
        )
        .limit(1);
      if (existing) {
        return { total: 0, posted: false, alreadyPosted: true, breakdown: [] };
      }

      const rows = await tx
        .select({
          repId: customerInvoicesTable.salesRepId,
          netRevenue: sql<number>`coalesce(sum(${customerInvoicesTable.subtotal}::numeric - ${customerInvoicesTable.discount}::numeric), 0)`,
        })
        .from(customerInvoicesTable)
        .where(
          and(
            gte(customerInvoicesTable.invoiceDate, from),
            eq(customerInvoicesTable.companyId, commissionCompanyId),
            sql`NOT EXISTS (SELECT 1 FROM invoice_seller_lines a WHERE a.invoice_id=${customerInvoicesTable.id} AND a.company_id=${commissionCompanyId})`,
            lte(customerInvoicesTable.invoiceDate, to),
            inArray(customerInvoicesTable.status, ["open", "partially_paid", "paid"]),
          ),
        )
        .groupBy(customerInvoicesTable.salesRepId);

      const plans = await tx.select().from(commissionPlansTable).where(and(eq(commissionPlansTable.isActive, true),eq(commissionPlansTable.companyId,commissionCompanyId)));
      const assignments = await tx.select().from(salesRepAssignmentsTable).where(inArray(salesRepAssignmentsTable.planId,plans.map(p=>p.id)));
      const planById = new Map(plans.map((p) => [p.id, p]));
      const planForUser = (userId: number | null) => {
        if (!userId) return null;
        const a = assignments.find((x) => x.userId === userId && x.effectiveFrom<=from && (!x.effectiveTo||x.effectiveTo>=to));
        if (!a) return null;
        return planById.get(a.planId) ?? null;
      };

      let total = 0;
      const breakdown: Array<{ repId: number | null; commission: number }> = [];
      for (const r of rows) {
        const plan = planForUser(r.repId ?? null);
        if (!plan) continue;
        const net = Number(r.netRevenue);
        const baseRate = Number(plan.rate);
        const quota = Number(plan.quota);
        const bonusRate = Number(plan.bonusRate);
        const c = (net * baseRate) / 100 + (net > quota && quota > 0 ? ((net - quota) * bonusRate) / 100 : 0);
        const rounded = +c.toFixed(2);
        if (rounded > 0) {
          total += rounded;
          breakdown.push({ repId: r.repId, commission: rounded });
        }
      }
      total = +total.toFixed(2);
      if (total === 0) return { total: 0, posted: false, breakdown };

      await postJournalEntry(
        tx,
        {
          entryDate: to,
          description: `عمولات مبيعات ${from} → ${to}`,
          reference: periodRef,
          source: "manual",
          sourceRef: periodRef,
          createdBy: req.session?.userId ?? null,
          status: "posted",
          companyId: getCompanyId(req),
        },
        [
          { systemKey: "commission_expense", debit: total, description: "عمولات مندوبي المبيعات" },
          { systemKey: "commission_payable", credit: total, description: "مستحقات عمولات" },
        ],
      );
      return { total, posted: true, breakdown };
    });
    res.json(result);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===================================================================
// Reports: sales by rep / customer / product, top customers
// ===================================================================
router.get("/sales/reports/by-rep", reportReadGuard, async (req, res) => {
  try {
    const { from, to } = z.object({ from: z.string(), to: z.string() }).parse(req.query);
    const rows = await db
      .select({
        repId: customerInvoicesTable.salesRepId,
        repName: usersTable.name,
        invoices: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(${customerInvoicesTable.subtotal}::numeric - ${customerInvoicesTable.discount}::numeric), 0)`,
        collected: sql<number>`coalesce(sum(${customerInvoicesTable.amountPaid}::numeric), 0)`,
      })
      .from(customerInvoicesTable)
      .leftJoin(usersTable, eq(usersTable.id, customerInvoicesTable.salesRepId))
      .where(
        and(
          eq(customerInvoicesTable.companyId, getCompanyId(req)),
          gte(customerInvoicesTable.invoiceDate, from),
          lte(customerInvoicesTable.invoiceDate, to),
          inArray(customerInvoicesTable.status, ["open", "partially_paid", "paid"]),
        ),
      )
      .groupBy(customerInvoicesTable.salesRepId, usersTable.name)
      .orderBy(({ revenue }) => desc(revenue));
    res.json(rows.map((r) => ({ ...r, repName: r.repName ?? "غير محدد", revenue: Number(r.revenue), collected: Number(r.collected) })));
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.get("/sales/reports/by-customer", reportReadGuard, async (req, res) => {
  try {
    const { from, to, limit } = z
      .object({ from: z.string(), to: z.string(), limit: z.string().optional() })
      .parse(req.query);
    const cap = Math.min(500, Number(limit ?? 100));
    const rows = await db
      .select({
        customerId: customerInvoicesTable.customerId,
        customerName: customerInvoicesTable.customerName,
        invoices: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(${customerInvoicesTable.subtotal}::numeric - ${customerInvoicesTable.discount}::numeric), 0)`,
        collected: sql<number>`coalesce(sum(${customerInvoicesTable.amountPaid}::numeric), 0)`,
        outstanding: sql<number>`coalesce(sum(${customerInvoicesTable.total}::numeric - ${customerInvoicesTable.amountPaid}::numeric), 0)`,
      })
      .from(customerInvoicesTable)
      .where(
        and(
          eq(customerInvoicesTable.companyId, getCompanyId(req)),
          gte(customerInvoicesTable.invoiceDate, from),
          lte(customerInvoicesTable.invoiceDate, to),
          inArray(customerInvoicesTable.status, ["open", "partially_paid", "paid"]),
        ),
      )
      .groupBy(customerInvoicesTable.customerId, customerInvoicesTable.customerName)
      .orderBy(({ revenue }) => desc(revenue))
      .limit(cap);
    res.json(rows.map((r) => ({ ...r, revenue: Number(r.revenue), collected: Number(r.collected), outstanding: Number(r.outstanding) })));
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.get("/sales/reports/by-product", reportReadGuard, async (req, res) => {
  try {
    const { from, to, limit } = z
      .object({ from: z.string(), to: z.string(), limit: z.string().optional() })
      .parse(req.query);
    const cap = Math.min(500, Number(limit ?? 100));
    const rows = await db
      .select({
        productId: customerInvoiceLinesTable.productId,
        description: customerInvoiceLinesTable.description,
        quantity: sql<number>`coalesce(sum(${customerInvoiceLinesTable.quantity}::numeric), 0)`,
        revenue: sql<number>`coalesce(sum(${customerInvoiceLinesTable.lineTotal}::numeric), 0)`,
        invoices: sql<number>`count(distinct ${customerInvoicesTable.id})::int`,
      })
      .from(customerInvoiceLinesTable)
      .innerJoin(customerInvoicesTable, eq(customerInvoicesTable.id, customerInvoiceLinesTable.invoiceId))
      .where(
        and(
          eq(customerInvoicesTable.companyId, getCompanyId(req)),
          gte(customerInvoicesTable.invoiceDate, from),
          lte(customerInvoicesTable.invoiceDate, to),
          inArray(customerInvoicesTable.status, ["open", "partially_paid", "paid"]),
        ),
      )
      .groupBy(customerInvoiceLinesTable.productId, customerInvoiceLinesTable.description)
      .orderBy(({ revenue }) => desc(revenue))
      .limit(cap);
    res.json(rows.map((r) => ({ ...r, quantity: Number(r.quantity), revenue: Number(r.revenue) })));
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===================================================================
// Helpers
// ===================================================================
type MoneyDoc = Record<string, unknown>;
function serializeMoneyDoc<T extends MoneyDoc | null | undefined>(doc: T): MoneyDoc | T {
  if (!doc) return doc;
  const out: MoneyDoc = { ...doc };
  for (const k of ["subtotal", "discount", "vat", "total", "amountPaid", "amount"]) {
    if (out[k] != null) out[k] = Number(out[k] as string | number);
  }
  for (const k of ["createdAt", "deliveredAt", "sentAt", "sentToCustomerAt", "acceptedAt", "rejectedAt", "closedAt"]) {
    const v = out[k];
    if (v instanceof Date) out[k] = v.toISOString();
  }
  return out;
}

function serializeLine<T extends Record<string, unknown>>(ln: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...ln };
  for (const k of ["quantity", "deliveredQty", "invoicedQty", "unitPrice", "discountPct", "taxRate", "lineTotal"]) {
    if (out[k] != null) out[k] = Number(out[k] as string | number);
  }
  return out;
}

export default router;
