import { db, customerInvoicesTable, alertsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendMail, isMailerConfigured } from "./mailer";
import { renderCustomerInvoicePdfById } from "../routes/sales";

// Background auto-retry for customer-invoice email sends. When the
// initial `POST /sales/invoices/:id/send` dispatch fails we store the
// outbox row with status='failed'. This worker periodically picks those
// failed rows back up (capped by MAX_ATTEMPTS, with exponential backoff)
// and tries again — so staff don't have to click "إعادة إرسال" manually.
//
// Audit trail: each retry inserts a NEW outbox row whose `retry_of`
// points back to the original failed row. The original row's status
// stays 'failed' until either (a) a retry succeeds, in which case the
// original is flipped to 'sent' and the invoice's sent_to_customer_at
// stamp is set, or (b) attempts hits MAX_ATTEMPTS, in which case the
// original stays 'failed' permanently and the UI keeps showing it red.

export const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 60 * 60_000;
const BATCH_SIZE = 10;

type QueuedRow = {
  id: number;
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

// Insert a child audit row capturing this single retry attempt. Always
// non-throwing — failure to record the audit row must not stop the
// worker from advancing the parent's attempts counter.
async function recordAttempt(parent: QueuedRow, opts: {
  status: "sent" | "failed";
  error: string | null;
  sent: boolean;
}): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO sales_email_outbox
        (kind, ref_id, reference, recipient, subject, body, status, error,
         created_by, sent_at, retry_of, attempts)
      VALUES ('invoice', ${parent.refId}, ${parent.reference},
              ${parent.recipient}, ${parent.subject}, ${parent.body},
              ${opts.status}, ${opts.error}, null,
              ${opts.sent ? sql`now()` : sql`null`},
              ${parent.id}, 0);
    `);
  } catch (err) {
    logger.error(
      { err, outboxId: parent.id },
      "invoice.retry.audit_insert_failed",
    );
  }
}

// Insert an alert into the shared `alerts` table when an outbox row
// reaches its terminal failed state, so managers see it on the dashboard
// instead of having to spot the red badge in the invoice list. Deduped
// per outbox id: the worker only flips a row to "permanently failed"
// once (attempts becomes MAX_ATTEMPTS and the row stops being polled),
// but we still token-scan the alert messages defensively so any
// upstream re-run can't double-notify for the same outbox row.
async function notifyGaveUp(row: QueuedRow, reason: string): Promise<void> {
  try {
    const token = `[outbox#${row.id}]`;
    const exists = await db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM alerts
         WHERE type = 'invoice_send_failed'
           AND message LIKE ${"%" + token + "%"}
      ) AS exists
    `);
    const rows: Array<{ exists: boolean }> =
      (exists as { rows?: Array<{ exists: boolean }> }).rows ??
      (Array.isArray(exists) ? (exists as Array<{ exists: boolean }>) : []);
    if (rows[0]?.exists) return;

    await db.insert(alertsTable).values({
      type: "invoice_send_failed",
      title: `فشل نهائي في إرسال الفاتورة ${row.reference}`,
      message:
        `تعذّر إرسال الفاتورة ${row.reference} إلى ${row.recipient} بعد ` +
        `${MAX_ATTEMPTS} محاولات. آخر خطأ: ${reason}. ${token}`,
    });
  } catch (err) {
    logger.error(
      { err, outboxId: row.id, invoiceId: row.refId },
      "invoice.retry.alert_insert_failed",
    );
  }
}

async function processOne(row: QueuedRow): Promise<void> {
  // Re-render so the customer always gets the latest PDF (totals,
  // status, ZATCA QR may have changed since the original send).
  const rendered = await renderCustomerInvoicePdfById(row.refId);
  const attemptsAfter = row.attempts + 1;

  if (!rendered.ok) {
    const reason = `invoice render failed: ${rendered.error}`;
    await recordAttempt(row, { status: "failed", error: reason, sent: false });
    if (attemptsAfter >= MAX_ATTEMPTS) {
      await db.execute(sql`
        UPDATE sales_email_outbox
           SET attempts = ${attemptsAfter},
               error = ${reason},
               next_retry_at = null
         WHERE id = ${row.id};
      `);
      logger.warn(
        { outboxId: row.id, invoiceId: row.refId, attempts: attemptsAfter, reason },
        "invoice.retry.gave_up",
      );
      await notifyGaveUp(row, reason);
    } else {
      const delayMs = nextRetryDelayMs(attemptsAfter);
      await db.execute(sql`
        UPDATE sales_email_outbox
           SET attempts = ${attemptsAfter},
               error = ${reason},
               next_retry_at = now() + (${delayMs}::int * INTERVAL '1 millisecond')
         WHERE id = ${row.id};
      `);
      logger.info(
        { outboxId: row.id, invoiceId: row.refId, attempts: attemptsAfter, retryInMs: delayMs },
        "invoice.retry.render_failed_requeued",
      );
    }
    return;
  }

  const filename = `invoice-${rendered.head.reference}.pdf`;
  const dispatch = await sendMail({
    to: row.recipient,
    subject: row.subject,
    body: row.body,
    attachments: [
      { filename, content: rendered.pdf, contentType: "application/pdf" },
    ],
  });

  if (dispatch.sent) {
    await recordAttempt(row, { status: "sent", error: null, sent: true });
    // Flip the original row to 'sent' so the invoice list's last-send
    // signal turns green and the worker won't pick it up again. Stamp
    // the invoice's sent_to_customer_at the same way the foreground
    // /send endpoint does, so the customer record is consistent.
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE sales_email_outbox
           SET status = 'sent',
               error = null,
               attempts = ${attemptsAfter},
               sent_at = now(),
               next_retry_at = null
         WHERE id = ${row.id};
      `);
      await tx
        .update(customerInvoicesTable)
        .set({
          sentToCustomerAt: new Date(),
          sentToCustomerEmail: row.recipient,
        })
        .where(eq(customerInvoicesTable.id, row.refId));
    });
    logger.info(
      { outboxId: row.id, invoiceId: row.refId, attempts: attemptsAfter },
      "invoice.retry.sent",
    );
    return;
  }

  const reason = dispatch.reason ?? "delivery failed";
  await recordAttempt(row, { status: "failed", error: reason, sent: false });

  if (attemptsAfter >= MAX_ATTEMPTS) {
    await db.execute(sql`
      UPDATE sales_email_outbox
         SET status = 'failed',
             error = ${reason},
             attempts = ${attemptsAfter},
             next_retry_at = null
       WHERE id = ${row.id};
    `);
    logger.warn(
      { outboxId: row.id, invoiceId: row.refId, attempts: attemptsAfter, reason },
      "invoice.retry.gave_up",
    );
    await notifyGaveUp(row, reason);
    return;
  }

  const delayMs = nextRetryDelayMs(attemptsAfter);
  await db.execute(sql`
    UPDATE sales_email_outbox
       SET status = 'failed',
           error = ${reason},
           attempts = ${attemptsAfter},
           next_retry_at = now() + (${delayMs}::int * INTERVAL '1 millisecond')
     WHERE id = ${row.id};
  `);
  logger.info(
    { outboxId: row.id, invoiceId: row.refId, attempts: attemptsAfter, retryInMs: delayMs, reason },
    "invoice.retry.requeued",
  );
}

let sweeping = false;

async function sweep(): Promise<void> {
  if (sweeping) return;
  if (!isMailerConfigured()) return;
  sweeping = true;
  try {
    const result = await db.execute(sql`
      SELECT id,
             ref_id        AS "refId",
             reference,
             recipient,
             subject,
             body,
             attempts
        FROM sales_email_outbox
       WHERE kind = 'invoice'
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
    if (!rows || rows.length === 0) return;
    for (const row of rows) {
      try {
        await processOne(row);
      } catch (err) {
        // Throw paths must still advance attempts/backoff so a row with a
        // recurring exception (e.g. corrupt invoice data) can't get
        // retried in a tight loop. After MAX_ATTEMPTS the parent stays
        // 'failed' with attempts == MAX_ATTEMPTS, so the worker no
        // longer picks it up.
        const reason = err instanceof Error ? err.message : String(err);
        const attemptsAfter = row.attempts + 1;
        try {
          await recordAttempt(row, { status: "failed", error: reason, sent: false });
          if (attemptsAfter >= MAX_ATTEMPTS) {
            await db.execute(sql`
              UPDATE sales_email_outbox
                 SET status = 'failed',
                     error = ${reason},
                     attempts = ${attemptsAfter},
                     next_retry_at = null
               WHERE id = ${row.id};
            `);
            await notifyGaveUp(row, reason);
          } else {
            const delayMs = nextRetryDelayMs(attemptsAfter);
            await db.execute(sql`
              UPDATE sales_email_outbox
                 SET status = 'failed',
                     error = ${reason},
                     attempts = ${attemptsAfter},
                     next_retry_at = now() + (${delayMs}::int * INTERVAL '1 millisecond')
               WHERE id = ${row.id};
            `);
          }
        } catch (updateErr) {
          logger.error(
            { err: updateErr, outboxId: row.id },
            "invoice.retry.failure_record_failed",
          );
        }
        logger.error(
          { err, outboxId: row.id, invoiceId: row.refId, attempts: attemptsAfter },
          "invoice.retry.unexpected_error",
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "invoice.retry.sweep_failed");
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
    { intervalMs, maxAttempts: MAX_ATTEMPTS },
    "invoice.retry.worker_started",
  );
  return handle;
}
