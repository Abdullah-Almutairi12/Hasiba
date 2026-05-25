import {
  db,
  customerInvoicesTable,
  quotationsTable,
  purchaseOrdersTable,
  alertsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  sendMail,
  isMailerConfigured,
  recipientStatusesFromDispatch,
  type MailDispatchResult,
} from "./mailer";
import {
  renderCustomerInvoicePdfById,
  renderQuotationEmailById,
} from "../routes/sales";
import { renderPurchaseOrderForRetry } from "../routes/procurement";

// Background auto-retry for outgoing sales-document emails. The initial
// /send endpoints (invoice / quotation / purchase-order) write a row
// into the appropriate outbox table with status='failed' when SMTP
// dispatch fails. This worker periodically picks those failed rows back
// up — capped by MAX_ATTEMPTS, with exponential backoff — and tries
// again, so staff don't have to click "إعادة إرسال" manually.
//
// Three kinds are swept:
//   * 'invoice'        → sales_email_outbox, re-renders customer invoice PDF
//   * 'quotation'      → sales_email_outbox, re-renders quotation email body
//   * 'purchase_order' → procurement_email_outbox, re-renders PO PDF
//
// Audit trail: each retry inserts a NEW outbox row whose `retry_of`
// points back to the original failed row. The original stays 'failed'
// until either (a) a retry succeeds, in which case it's flipped to
// 'sent' and the parent document's sent_at stamp is set, or (b) attempts
// hits MAX_ATTEMPTS, in which case it stays 'failed' permanently and
// the UI keeps showing it red — and we drop a manager-facing alert row
// via notifyGaveUp() so the dashboard surfaces the permanent failure.

export const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 60 * 60_000;
const BATCH_SIZE = 10;

type Kind = "invoice" | "quotation" | "purchase_order";

type QueuedRow = {
  id: number;
  kind: Kind;
  refId: number;
  reference: string;
  recipient: string;
  subject: string;
  body: string;
  attempts: number;
};

function nextRetryDelayMs(attemptsAfter: number): number {
  const ms = BACKOFF_BASE_MS * 2 ** (attemptsAfter - 1);
  return Math.min(ms, BACKOFF_CAP_MS);
}

// Arabic document labels for the manager-facing alert text.
const DOC_LABEL_AR: Record<Kind, string> = {
  invoice: "الفاتورة",
  quotation: "عرض السعر",
  purchase_order: "أمر الشراء",
};

// Insert a child audit row capturing this single retry attempt. Always
// non-throwing — failure to record the audit row must not stop the
// worker from advancing the parent's attempts counter. The PO outbox
// also carries an `attachment_filename` column; we re-use the parent's
// reference to derive it so the audit row is self-describing.
async function recordAttempt(parent: QueuedRow, opts: {
  status: "sent" | "failed";
  error: string | null;
  sent: boolean;
  dispatch?: MailDispatchResult | null;
}): Promise<void> {
  // Task #208: derive per-recipient delivery row for this attempt so
  // the audit child also carries delivery_status / message_id, and the
  // bounce webhook can resolve to either parent or child by message_id.
  const dispatch: MailDispatchResult =
    opts.dispatch ??
    (opts.sent
      ? { sent: true, provider: "smtp", messageId: "", accepted: [parent.recipient], rejected: [], pending: [] }
      : { sent: false, reason: opts.error ?? "send_failed" });
  const [delivery] = recipientStatusesFromDispatch(dispatch, [parent.recipient]);
  const messageId = dispatch.sent ? dispatch.messageId : null;
  try {
    if (parent.kind === "purchase_order") {
      await db.execute(sql`
        INSERT INTO procurement_email_outbox
          (kind, ref_id, reference, recipient, subject, body,
           attachment_filename, status, error, created_by, sent_at,
           retry_of, attempts,
           message_id, delivery_status, delivery_reason, delivered_at)
        VALUES ('purchase_order', ${parent.refId}, ${parent.reference},
                ${parent.recipient}, ${parent.subject}, ${parent.body},
                ${`PO-${parent.reference}.pdf`},
                ${opts.status}, ${opts.error}, null,
                ${opts.sent ? sql`now()` : sql`null`},
                ${parent.id}, 0,
                ${messageId}, ${delivery?.status ?? "pending"},
                ${delivery?.reason ?? null},
                ${delivery?.deliveredAt ?? null});
      `);
    } else {
      await db.execute(sql`
        INSERT INTO sales_email_outbox
          (kind, ref_id, reference, recipient, subject, body, status, error,
           created_by, sent_at, retry_of, attempts,
           message_id, delivery_status, delivery_reason, delivered_at)
        VALUES (${parent.kind}, ${parent.refId}, ${parent.reference},
                ${parent.recipient}, ${parent.subject}, ${parent.body},
                ${opts.status}, ${opts.error}, null,
                ${opts.sent ? sql`now()` : sql`null`},
                ${parent.id}, 0,
                ${messageId}, ${delivery?.status ?? "pending"},
                ${delivery?.reason ?? null},
                ${delivery?.deliveredAt ?? null});
      `);
    }
  } catch (err) {
    logger.error(
      { err, outboxId: parent.id, kind: parent.kind },
      "email_retry.audit_insert_failed",
    );
  }
}

// Insert an alert into the shared `alerts` table when an outbox row
// reaches its terminal failed state, so managers see it on the dashboard
// instead of having to spot the red badge in the document list. Deduped
// per outbox id via a token in the message body so an upstream re-run
// can't double-notify for the same outbox row. Covers all three kinds.
async function notifyGaveUp(row: QueuedRow, reason: string): Promise<void> {
  try {
    const token = `[outbox#${row.id}]`;
    const exists = await db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM alerts
         WHERE type = 'document_send_failed'
           AND message LIKE ${"%" + token + "%"}
      ) AS exists
    `);
    const rows: Array<{ exists: boolean }> =
      (exists as { rows?: Array<{ exists: boolean }> }).rows ??
      (Array.isArray(exists) ? (exists as Array<{ exists: boolean }>) : []);
    if (rows[0]?.exists) return;

    const label = DOC_LABEL_AR[row.kind];
    // Send/retry outbox tables aren't tenant-scoped (Phase-1 left
    // procurement & sales document tables alone). We log the alert with
    // companyId=null so it surfaces in the cross-tenant operations view
    // rather than getting dropped — a follow-up phase will derive the
    // tenant from the parent document once those tables are scoped.
    await db.insert(alertsTable).values({
      companyId: null,
      type: "document_send_failed",
      title: `فشل نهائي في إرسال ${label} ${row.reference}`,
      message:
        `تعذّر إرسال ${label} ${row.reference} إلى ${row.recipient} بعد ` +
        `${MAX_ATTEMPTS} محاولات. آخر خطأ: ${reason}. ${token}`,
    });
  } catch (err) {
    logger.error(
      { err, outboxId: row.id, kind: row.kind, refId: row.refId },
      "email_retry.alert_insert_failed",
    );
  }
}

// Mark the parent row as failed-and-requeued (or gave-up when attempts
// have hit the ceiling). Routed to the right physical outbox table by
// the row's kind. When giveUp=true, also drops a manager-facing alert.
async function markParentFailure(row: QueuedRow, opts: {
  attemptsAfter: number;
  reason: string;
  giveUp: boolean;
}): Promise<void> {
  const nextRetrySql = opts.giveUp
    ? sql`null`
    : sql`now() + (${nextRetryDelayMs(opts.attemptsAfter)}::int * INTERVAL '1 millisecond')`;
  if (row.kind === "purchase_order") {
    await db.execute(sql`
      UPDATE procurement_email_outbox
         SET status = 'failed',
             error = ${opts.reason},
             attempts = ${opts.attemptsAfter},
             next_retry_at = ${nextRetrySql}
       WHERE id = ${row.id};
    `);
  } else {
    await db.execute(sql`
      UPDATE sales_email_outbox
         SET status = 'failed',
             error = ${opts.reason},
             attempts = ${opts.attemptsAfter},
             next_retry_at = ${nextRetrySql}
       WHERE id = ${row.id};
    `);
  }
  if (opts.giveUp) {
    await notifyGaveUp(row, opts.reason);
  }
}

// Flip the parent row to 'sent' AND stamp the parent document's
// sent_at/email so the rest of the UI (lists, detail screens) reflects
// successful delivery the same way the foreground /send endpoints do.
async function markParentSent(
  row: QueuedRow,
  attemptsAfter: number,
  dispatch: MailDispatchResult,
): Promise<void> {
  // Task #208: a successful retry should also flip the parent row's
  // delivery_status to whatever the SMTP envelope reports for this
  // address, and record the new message_id so future webhook events
  // can resolve back to the parent.
  const [delivery] = recipientStatusesFromDispatch(dispatch, [row.recipient]);
  const messageId = dispatch.sent ? dispatch.messageId : null;
  await db.transaction(async (tx) => {
    if (row.kind === "purchase_order") {
      await tx.execute(sql`
        UPDATE procurement_email_outbox
           SET status = 'sent',
               error = null,
               attempts = ${attemptsAfter},
               sent_at = now(),
               next_retry_at = null,
               message_id = ${messageId},
               delivery_status = ${delivery?.status ?? "pending"},
               delivery_reason = ${delivery?.reason ?? null},
               delivered_at = ${delivery?.deliveredAt ?? null}
         WHERE id = ${row.id};
      `);
      await tx
        .update(purchaseOrdersTable)
        .set({
          sentToSupplierAt: new Date(),
          sentToSupplierEmail: row.recipient,
        })
        .where(eq(purchaseOrdersTable.id, row.refId));
      return;
    }
    await tx.execute(sql`
      UPDATE sales_email_outbox
         SET status = 'sent',
             error = null,
             attempts = ${attemptsAfter},
             sent_at = now(),
             next_retry_at = null,
             message_id = ${messageId},
             delivery_status = ${delivery?.status ?? "pending"},
             delivery_reason = ${delivery?.reason ?? null},
             delivered_at = ${delivery?.deliveredAt ?? null}
       WHERE id = ${row.id};
    `);
    if (row.kind === "invoice") {
      await tx
        .update(customerInvoicesTable)
        .set({
          sentToCustomerAt: new Date(),
          sentToCustomerEmail: row.recipient,
        })
        .where(eq(customerInvoicesTable.id, row.refId));
    } else if (row.kind === "quotation") {
      // Also flip the quotation status to 'sent' (the foreground
      // route only does this on a successful first dispatch — a
      // background retry that finally succeeds must mirror that).
      await tx
        .update(quotationsTable)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(quotationsTable.id, row.refId));
    }
  });
}

type RenderedAttachment = {
  subject: string;
  body: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
};

// Re-render the latest version of the parent document so each retry
// reflects current totals/state, not the snapshot taken when the row was
// first queued. Returns { ok: false } when the parent has gone away or
// is no longer in a sendable lifecycle state.
async function renderForRetry(row: QueuedRow): Promise<
  | { ok: true; payload: RenderedAttachment }
  | { ok: false; reason: string }
> {
  if (row.kind === "invoice") {
    const rendered = await renderCustomerInvoicePdfById(row.refId);
    if (!rendered.ok) return { ok: false, reason: `invoice render failed: ${rendered.error}` };
    return {
      ok: true,
      payload: {
        subject: row.subject,
        body: row.body,
        attachments: [{
          filename: `invoice-${rendered.head.reference}.pdf`,
          content: rendered.pdf,
          contentType: "application/pdf",
        }],
      },
    };
  }
  if (row.kind === "quotation") {
    const rendered = await renderQuotationEmailById(row.refId);
    if (!rendered.ok) return { ok: false, reason: `quotation render failed: ${rendered.error}` };
    // Use the freshly re-rendered subject/body so the customer always
    // sees the latest reference / total / valid-until.
    return {
      ok: true,
      payload: { subject: rendered.subject, body: rendered.body },
    };
  }
  const rendered = await renderPurchaseOrderForRetry(row.refId);
  if (!rendered.ok) return { ok: false, reason: `purchase_order render failed: ${rendered.error}` };
  return {
    ok: true,
    payload: {
      subject: rendered.subject,
      body: rendered.body,
      attachments: [{
        filename: rendered.attachmentFilename,
        content: rendered.pdf,
        contentType: "application/pdf",
      }],
    },
  };
}

async function processOne(row: QueuedRow): Promise<void> {
  const attemptsAfter = row.attempts + 1;
  const rendered = await renderForRetry(row);

  if (!rendered.ok) {
    await recordAttempt(row, { status: "failed", error: rendered.reason, sent: false });
    const giveUp = attemptsAfter >= MAX_ATTEMPTS;
    await markParentFailure(row, { attemptsAfter, reason: rendered.reason, giveUp });
    logger.warn(
      { outboxId: row.id, kind: row.kind, refId: row.refId, attempts: attemptsAfter, reason: rendered.reason, giveUp },
      giveUp ? "email_retry.gave_up" : "email_retry.render_failed_requeued",
    );
    return;
  }

  const dispatch = await sendMail({
    to: row.recipient,
    subject: rendered.payload.subject,
    body: rendered.payload.body,
    attachments: rendered.payload.attachments,
  });

  if (dispatch.sent) {
    await recordAttempt(row, { status: "sent", error: null, sent: true, dispatch });
    await markParentSent(row, attemptsAfter, dispatch);
    logger.info(
      { outboxId: row.id, kind: row.kind, refId: row.refId, attempts: attemptsAfter },
      "email_retry.sent",
    );
    return;
  }

  const reason = dispatch.reason ?? "delivery failed";
  await recordAttempt(row, { status: "failed", error: reason, sent: false });
  const giveUp = attemptsAfter >= MAX_ATTEMPTS;
  await markParentFailure(row, { attemptsAfter, reason, giveUp });
  logger.info(
    { outboxId: row.id, kind: row.kind, refId: row.refId, attempts: attemptsAfter, reason, giveUp },
    giveUp ? "email_retry.gave_up" : "email_retry.requeued",
  );
}

let sweeping = false;

// Pull the next batch of due rows from `tableName`, restricted to the
// supplied kinds. We only walk root rows (retry_of IS NULL): the per-
// attempt audit children are inserted with attempts=0 and must never
// be re-queued in their own right.
async function fetchDue(
  tableName: "sales_email_outbox" | "procurement_email_outbox",
  kinds: Kind[],
): Promise<QueuedRow[]> {
  // Identifier interpolation is safe: tableName and kinds are
  // constants chosen by this module, never user-supplied.
  const tableId = sql.identifier(tableName);
  const kindList = sql.join(kinds.map((k) => sql`${k}`), sql`, `);
  const result = await db.execute(sql`
    SELECT id,
           kind,
           ref_id        AS "refId",
           reference,
           recipient,
           subject,
           body,
           attempts
      FROM ${tableId}
     WHERE kind IN (${kindList})
       AND status = 'failed'
       AND retry_of IS NULL
       AND attempts < ${MAX_ATTEMPTS}
       AND (next_retry_at IS NULL OR next_retry_at <= now())
     ORDER BY created_at ASC
     LIMIT ${BATCH_SIZE};
  `);
  const rows =
    (result as unknown as { rows?: QueuedRow[] }).rows ??
    (result as unknown as QueuedRow[]);
  return rows ?? [];
}

async function sweep(): Promise<void> {
  if (sweeping) return;
  if (!isMailerConfigured()) return;
  sweeping = true;
  try {
    const batches = [
      await fetchDue("sales_email_outbox", ["invoice", "quotation"]),
      await fetchDue("procurement_email_outbox", ["purchase_order"]),
    ];
    for (const rows of batches) {
      if (rows.length === 0) continue;
      for (const row of rows) {
        try {
          await processOne(row);
        } catch (err) {
          // Throw paths must still advance attempts/backoff so a row
          // with a recurring exception can't get retried in a tight
          // loop. After MAX_ATTEMPTS the parent stays 'failed' with
          // attempts == MAX_ATTEMPTS, so the worker no longer picks it up.
          const reason = err instanceof Error ? err.message : String(err);
          const attemptsAfter = row.attempts + 1;
          try {
            await recordAttempt(row, { status: "failed", error: reason, sent: false });
            await markParentFailure(row, {
              attemptsAfter,
              reason,
              giveUp: attemptsAfter >= MAX_ATTEMPTS,
            });
          } catch (updateErr) {
            logger.error(
              { err: updateErr, outboxId: row.id, kind: row.kind },
              "email_retry.failure_record_failed",
            );
          }
          logger.error(
            { err, outboxId: row.id, kind: row.kind, refId: row.refId, attempts: attemptsAfter },
            "email_retry.unexpected_error",
          );
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "email_retry.sweep_failed");
  } finally {
    sweeping = false;
  }
}

export function startInvoiceEmailRetryWorker(
  intervalMs = 60_000,
): NodeJS.Timeout {
  const handle = setInterval(() => void sweep(), intervalMs);
  handle.unref?.();
  setTimeout(() => void sweep(), 30_000).unref?.();
  logger.info(
    { intervalMs, maxAttempts: MAX_ATTEMPTS, kinds: ["invoice", "quotation", "purchase_order"] },
    "email_retry.worker_started",
  );
  return handle;
}
