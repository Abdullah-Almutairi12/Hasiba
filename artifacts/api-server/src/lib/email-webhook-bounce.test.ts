/**
 * Task #209: End-to-end test for the email-delivery webhook +
 * bounce-tracking flow.
 *
 * The unit tests for `recordSendAttempt` mock SMTP, so they don't
 * exercise the full pipeline: send-recorded → seeded `pending` rows →
 * provider webhook POST → admin-visible per-recipient status flip.
 *
 * This test boots the real Express app, seeds one
 * `cleanup_report_sends` row plus a matching `cleanup_report_send_recipients`
 * row in `pending`, then POSTs a fake provider event to
 * `/api/integrations/email/webhook` with a valid HMAC-SHA256
 * signature and asserts the row flips to `bounced`.
 *
 * Negative cases:
 *   - wrong signature → 401 invalid_signature
 *   - unknown messageId → 200 ok with updated: 0 (no row touched)
 *
 * Reuses the live `DATABASE_URL` pattern like `tenant-http.test.ts`.
 * Fixture rows are tagged with a per-run timestamp and removed in
 * `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createHmac } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  cleanupReportSendsTable,
  cleanupReportSendRecipientsTable,
} from "@workspace/db";

const RUN_TAG = `vitest-email-wh-${Date.now()}`;
const RECIPIENT = `bounce-${RUN_TAG}@test.local`;
const MESSAGE_ID = `<${RUN_TAG}@hasba.local>`;
const SECRET = `s3cret-${RUN_TAG}`;

let app: typeof import("../app").default;
let sendId = 0;
let recipientId = 0;

beforeAll(async () => {
  // Must be set BEFORE the webhook handler reads it — the handler
  // calls `process.env["EMAIL_WEBHOOK_SECRET"]` per request, so
  // setting it here is sufficient.
  process.env["EMAIL_WEBHOOK_SECRET"] = SECRET;
  app = (await import("../app")).default;
  // app.ts kicks `initCleanupReportDelivery()` off the boot promise
  // chain without awaiting, so the child table may not exist yet by
  // the time the test body runs. We also have to make sure the
  // PARENT `cleanup_report_sends` table exists — that one is normally
  // created by `drizzle-kit push` against the dev DB, but the test
  // suite must self-bootstrap so it can run on any DATABASE_URL.
  const { pool } = await import("@workspace/db");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cleanup_report_sends (
      id serial PRIMARY KEY,
      sent_at timestamp NOT NULL DEFAULT now(),
      trigger text NOT NULL,
      triggered_by_user_id integer,
      triggered_by_user_name text,
      recipient_count integer NOT NULL DEFAULT 0,
      recipients text NOT NULL DEFAULT '',
      row_count integer,
      status text NOT NULL,
      failure_reason text,
      window_from timestamp,
      window_to timestamp
    );
  `);
  const { initCleanupReportDelivery } = await import(
    "./cleanup-report-delivery-init"
  );
  await initCleanupReportDelivery();

  const [send] = await db
    .insert(cleanupReportSendsTable)
    .values({
      trigger: "manual",
      recipientCount: 1,
      recipients: RECIPIENT,
      rowCount: 0,
      status: "success",
      messageId: MESSAGE_ID,
    })
    .returning({ id: cleanupReportSendsTable.id });
  sendId = send.id;

  const [rec] = await db
    .insert(cleanupReportSendRecipientsTable)
    .values({
      sendId,
      email: RECIPIENT,
      status: "pending",
    })
    .returning({ id: cleanupReportSendRecipientsTable.id });
  recipientId = rec.id;
});

afterAll(async () => {
  if (recipientId) {
    await db
      .delete(cleanupReportSendRecipientsTable)
      .where(eq(cleanupReportSendRecipientsTable.id, recipientId));
  }
  if (sendId) {
    await db
      .delete(cleanupReportSendsTable)
      .where(inArray(cleanupReportSendsTable.id, [sendId]));
  }
  delete process.env["EMAIL_WEBHOOK_SECRET"];
});

function sign(rawBody: string): string {
  return createHmac("sha256", SECRET).update(rawBody).digest("hex");
}

describe("POST /api/integrations/email/webhook — bounce-tracking E2E", () => {
  it("rejects requests with a bad HMAC signature (401 invalid_signature) and does NOT flip the row", async () => {
    const payload = JSON.stringify({
      messageId: MESSAGE_ID,
      recipient: RECIPIENT,
      event: "bounced",
      reason: "mailbox_full",
    });
    const res = await request(app)
      .post("/api/integrations/email/webhook")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Signature", "deadbeef".repeat(8))
      .send(payload);

    expect(res.status).toBe(401);
    expect((res.body as { error?: string }).error).toBe("invalid_signature");

    const [row] = await db
      .select({ status: cleanupReportSendRecipientsTable.status })
      .from(cleanupReportSendRecipientsTable)
      .where(eq(cleanupReportSendRecipientsTable.id, recipientId));
    expect(row?.status).toBe("pending");
  });

  it("accepts a 200 with updated: 0 when the messageId is unknown (no fallback match)", async () => {
    const payload = JSON.stringify({
      messageId: `<does-not-exist-${RUN_TAG}@nowhere>`,
      recipient: `unknown-${RUN_TAG}@test.local`,
      event: "bounced",
      reason: "no_such_user",
    });
    const res = await request(app)
      .post("/api/integrations/email/webhook")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Signature", sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, updated: 0 });

    // Sanity: our seeded row is still pending — nothing was clobbered.
    const [row] = await db
      .select({ status: cleanupReportSendRecipientsTable.status })
      .from(cleanupReportSendRecipientsTable)
      .where(eq(cleanupReportSendRecipientsTable.id, recipientId));
    expect(row?.status).toBe("pending");
  });

  it("flips the matching recipient row to 'bounced' when given a valid HMAC + known messageId", async () => {
    const payload = JSON.stringify({
      messageId: MESSAGE_ID,
      recipient: RECIPIENT,
      event: "bounced",
      reason: "mailbox_full",
    });
    const res = await request(app)
      .post("/api/integrations/email/webhook")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Signature", sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, updated: 1 });

    const [row] = await db
      .select({
        status: cleanupReportSendRecipientsTable.status,
        reason: cleanupReportSendRecipientsTable.reason,
      })
      .from(cleanupReportSendRecipientsTable)
      .where(eq(cleanupReportSendRecipientsTable.id, recipientId));
    expect(row?.status).toBe("bounced");
    expect(row?.reason).toBe("mailbox_full");
  });
});
