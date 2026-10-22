import { db, alertsTable, purchaseOrdersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { isMailerConfigured } from "./mailer";
import { dispatchPurchaseOrder } from "../routes/procurement";

// Background auto-retry for purchase-order email sends. When the initial
// `POST /procurement/purchase-orders/:id/send` dispatch fails we store the
// outbox row with status='failed'. This worker periodically picks those
// failed rows back up (capped by MAX_ATTEMPTS, with exponential backoff)
// and tries again — so buyers don't have to click "إعادة إرسال" manually.
//
// Audit trail: each retry inserts a NEW outbox row whose `retry_of` points
// back to the original failed row (handled by `dispatchPurchaseOrder`).
// The original row's status stays 'failed' until either (a) a retry
// succeeds, in which case the original is flipped to 'sent' and stops
// being polled, or (b) attempts hits MAX_ATTEMPTS, in which case the
// original stays 'failed' permanently and the UI keeps showing it red so
// a buyer can still intervene manually.

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

async function notifyGaveUp(row: QueuedRow, reason: string): Promise<void> {
  try {
    const token = `[po-outbox#${row.id}]`;
    const exists = await db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM alerts
         WHERE type = 'po_send_failed'
           AND message LIKE ${"%" + token + "%"}
      ) AS exists
    `);
    const rows: Array<{ exists: boolean }> =
      (exists as { rows?: Array<{ exists: boolean }> }).rows ??
      (Array.isArray(exists) ? (exists as Array<{ exists: boolean }>) : []);
    if (rows[0]?.exists) return;

    const [po] = await db.select({ companyId: purchaseOrdersTable.companyId })
      .from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, row.refId));
    if (!po) return;
    const companyId = po.companyId;

    await db.insert(alertsTable).values({
      companyId,
      type: "po_send_failed",
      title: `فشل نهائي في إرسال أمر الشراء ${row.reference}`,
      message:
        `تعذّر إرسال أمر الشراء ${row.reference} إلى ${row.recipient} بعد ` +
        `${MAX_ATTEMPTS} محاولات. آخر خطأ: ${reason}. ${token}`,
    });
  } catch (err) {
    logger.error(
      { err, outboxId: row.id, poId: row.refId },
      "po.retry.alert_insert_failed",
    );
  }
}

async function markFinalFailure(row: QueuedRow, attemptsAfter: number, reason: string): Promise<void> {
  await db.execute(sql`
    UPDATE procurement_email_outbox
       SET attempts = ${attemptsAfter},
           error = ${reason},
           next_retry_at = null
     WHERE id = ${row.id};
  `);
  logger.warn(
    { outboxId: row.id, poId: row.refId, attempts: attemptsAfter, reason },
    "po.retry.gave_up",
  );
  await notifyGaveUp(row, reason);
}

async function requeue(row: QueuedRow, attemptsAfter: number, reason: string): Promise<void> {
  const delayMs = nextRetryDelayMs(attemptsAfter);
  await db.execute(sql`
    UPDATE procurement_email_outbox
       SET attempts = ${attemptsAfter},
           error = ${reason},
           next_retry_at = now() + (${delayMs}::int * INTERVAL '1 millisecond')
     WHERE id = ${row.id};
  `);
  logger.info(
    { outboxId: row.id, poId: row.refId, attempts: attemptsAfter, retryInMs: delayMs, reason },
    "po.retry.requeued",
  );
}

async function processOne(row: QueuedRow): Promise<void> {
  const attemptsAfter = row.attempts + 1;
  const [po] = await db.select({ companyId: purchaseOrdersTable.companyId })
    .from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, row.refId));
  if (!po) { await markFinalFailure(row, attemptsAfter, "Purchase order not found"); return; }
  // dispatchPurchaseOrder inserts a child outbox row (retry_of -> row.id)
  // capturing this attempt's outcome, regardless of success/failure.
  const result = await dispatchPurchaseOrder({
    companyId: po.companyId,
    poId: row.refId,
    toOverride: row.recipient,
    subjectOverride: row.subject,
    messageOverride: row.body,
    userId: null,
    retryOf: row.id,
  });

  const ok =
    result.status === 200 &&
    (result.payload as { dispatched?: boolean }).dispatched === true;

  if (ok) {
    // Flip the original 'failed' row to 'sent' so the worker won't pick it
    // up again and the list badge resolves to delivered.
    await db.execute(sql`
      UPDATE procurement_email_outbox
         SET status = 'sent',
             error = null,
             attempts = ${attemptsAfter},
             sent_at = now(),
             next_retry_at = null
       WHERE id = ${row.id};
    `);
    logger.info(
      { outboxId: row.id, poId: row.refId, attempts: attemptsAfter },
      "po.retry.sent",
    );
    return;
  }

  // A 400/409 here means the PO is no longer in a sendable state (e.g.
  // cancelled, back to draft, or supplier has no email). Those won't fix
  // themselves on a retry, so we drain attempts immediately and stop.
  const reason =
    (result.payload as { reason?: string; error?: string }).reason ??
    (result.payload as { error?: string }).error ??
    "delivery failed";
  const terminal = result.status === 400 || result.status === 409;

  if (terminal || attemptsAfter >= MAX_ATTEMPTS) {
    await markFinalFailure(row, attemptsAfter, reason);
    return;
  }
  await requeue(row, attemptsAfter, reason);
}

let sweeping = false;

async function sweep(): Promise<void> {
  if (sweeping) return;
  if (!isMailerConfigured()) return;
  sweeping = true;
  try {
    const result = await db.execute(sql`
      SELECT id,
             ref_id    AS "refId",
             reference,
             recipient,
             subject,
             body,
             attempts
        FROM procurement_email_outbox
       WHERE kind = 'purchase_order'
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
        // recurring exception (e.g. missing supplier) can't get retried in
        // a tight loop.
        const reason = err instanceof Error ? err.message : String(err);
        const attemptsAfter = row.attempts + 1;
        try {
          if (attemptsAfter >= MAX_ATTEMPTS) {
            await markFinalFailure(row, attemptsAfter, reason);
          } else {
            await requeue(row, attemptsAfter, reason);
          }
        } catch (updateErr) {
          logger.error(
            { err: updateErr, outboxId: row.id },
            "po.retry.failure_record_failed",
          );
        }
        logger.error(
          { err, outboxId: row.id, poId: row.refId, attempts: attemptsAfter },
          "po.retry.unexpected_error",
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "po.retry.sweep_failed");
  } finally {
    sweeping = false;
  }
}

export function startPoEmailRetryWorker(
  intervalMs = 60_000,
): NodeJS.Timeout {
  const handle = setInterval(() => void sweep(), intervalMs);
  handle.unref?.();
  setTimeout(() => void sweep(), 30_000).unref?.();
  logger.info(
    { intervalMs, maxAttempts: MAX_ATTEMPTS },
    "po.retry.worker_started",
  );
  return handle;
}
