import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendMail, isMailerConfigured } from "./mailer";
import { renderCustomerInvoicePdfById } from "../routes/sales";

const MAX_ATTEMPTS = 5;
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

async function processOne(row: QueuedRow): Promise<void> {
  const rendered = await renderCustomerInvoicePdfById(row.refId);
  if (!rendered.ok) {
    await db.execute(sql`
      UPDATE sales_email_outbox
         SET status = 'failed',
             error = ${`invoice render failed: ${rendered.error}`},
             attempts = attempts + 1
       WHERE id = ${row.id};
    `);
    logger.warn(
      { outboxId: row.id, invoiceId: row.refId, error: rendered.error },
      "invoice.retry.render_failed",
    );
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
  const attemptsAfter = row.attempts + 1;
  if (dispatch.sent) {
    await db.execute(sql`
      UPDATE sales_email_outbox
         SET status = 'sent',
             error = null,
             attempts = ${attemptsAfter},
             sent_at = now(),
             next_retry_at = null
       WHERE id = ${row.id};
    `);
    logger.info(
      { outboxId: row.id, invoiceId: row.refId, attempts: attemptsAfter },
      "invoice.retry.sent",
    );
    return;
  }
  if (attemptsAfter >= MAX_ATTEMPTS) {
    await db.execute(sql`
      UPDATE sales_email_outbox
         SET status = 'failed',
             error = ${dispatch.reason},
             attempts = ${attemptsAfter},
             next_retry_at = null
       WHERE id = ${row.id};
    `);
    logger.warn(
      {
        outboxId: row.id,
        invoiceId: row.refId,
        attempts: attemptsAfter,
        reason: dispatch.reason,
      },
      "invoice.retry.gave_up",
    );
    return;
  }
  const delayMs = nextRetryDelayMs(attemptsAfter);
  await db.execute(sql`
    UPDATE sales_email_outbox
       SET status = 'queued',
           error = ${dispatch.reason},
           attempts = ${attemptsAfter},
           next_retry_at = now() + (${delayMs}::int * INTERVAL '1 millisecond')
     WHERE id = ${row.id};
  `);
  logger.info(
    {
      outboxId: row.id,
      invoiceId: row.refId,
      attempts: attemptsAfter,
      retryInMs: delayMs,
      reason: dispatch.reason,
    },
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
         AND status = 'queued'
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
        // recurring exception (e.g. corrupt invoice data) can't stay
        // "queued" forever — it will eventually flip to 'failed'.
        const reason = err instanceof Error ? err.message : String(err);
        const attemptsAfter = row.attempts + 1;
        try {
          if (attemptsAfter >= MAX_ATTEMPTS) {
            await db.execute(sql`
              UPDATE sales_email_outbox
                 SET status = 'failed',
                     error = ${reason},
                     attempts = ${attemptsAfter},
                     next_retry_at = null
               WHERE id = ${row.id};
            `);
          } else {
            const delayMs = nextRetryDelayMs(attemptsAfter);
            await db.execute(sql`
              UPDATE sales_email_outbox
                 SET status = 'queued',
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
  logger.info({ intervalMs }, "invoice.retry.worker_started");
  return handle;
}
