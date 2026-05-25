/**
 * Task #222 — admins are notified the moment a cleanup-report send
 * starts bouncing.
 *
 * Coverage:
 *   - In-app alert is inserted exactly once per (sendId, email) even
 *     under N concurrent calls (provider webhook retry storm + sweep)
 *   - Notification body carries the bounced address, original
 *     recipient list, window, and a deep link
 *   - Re-invoking the notifier after dedup is a no-op (returns false,
 *     no extra alert row)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import {
  db,
  alertsTable,
  cleanupReportSendsTable,
  cleanupReportSendRecipientsTable,
} from "@workspace/db";

const RUN_TAG = `vitest-bounce-notify-${Date.now()}`;

let notifyAdminsOfCleanupReportBounce: typeof import("./cleanup-report-bounce-notify").notifyAdminsOfCleanupReportBounce;
let renderBounceNotification: typeof import("./cleanup-report-bounce-notify").renderBounceNotification;
let buildBounceDeepLink: typeof import("./cleanup-report-bounce-notify").buildBounceDeepLink;
const createdSendIds: number[] = [];

beforeAll(async () => {
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
  ({ notifyAdminsOfCleanupReportBounce, renderBounceNotification, buildBounceDeepLink } =
    await import("./cleanup-report-bounce-notify"));
});

afterAll(async () => {
  // Recipient rows cascade via FK; alerts must be cleaned up by tag.
  await db
    .delete(alertsTable)
    .where(like(alertsTable.title, `%${RUN_TAG}%`));
  if (createdSendIds.length > 0) {
    await db
      .delete(cleanupReportSendsTable)
      .where(inArray(cleanupReportSendsTable.id, createdSendIds));
  }
});

async function seedBouncedRecipient(): Promise<{
  sendId: number;
  recipientId: number;
  bouncedEmail: string;
}> {
  const bouncedEmail = `bounce-${RUN_TAG}-${Math.random()
    .toString(36)
    .slice(2)}@test.local`;
  const [send] = await db
    .insert(cleanupReportSendsTable)
    .values({
      trigger: "manual",
      recipientCount: 2,
      recipients: `auditor-${RUN_TAG}@test.local, ${bouncedEmail}`,
      rowCount: 5,
      status: "success",
      messageId: `<${RUN_TAG}-${bouncedEmail}>`,
      windowFrom: new Date("2026-01-01T00:00:00Z"),
      windowTo: new Date("2026-01-08T00:00:00Z"),
    })
    .returning({ id: cleanupReportSendsTable.id });
  createdSendIds.push(send.id);
  // Title carries RUN_TAG so cleanup picks up the alert too.
  // Pre-seed the recipient as 'bounced' (caller-controlled state).
  const [rec] = await db
    .insert(cleanupReportSendRecipientsTable)
    .values({
      sendId: send.id,
      email: bouncedEmail,
      status: "bounced",
      reason: "mailbox_full",
    })
    .returning({ id: cleanupReportSendRecipientsTable.id });
  return { sendId: send.id, recipientId: rec.id, bouncedEmail };
}

describe("buildBounceDeepLink", () => {
  it("targets the overview tab AND a row anchor that admin.tsx consumes", () => {
    // admin.tsx reads `cleanupReportSendId` from the query string to
    // force the tab + scroll target, and `cleanup-report-send-<id>`
    // is rendered as the row's DOM id. Lock both shapes in so a
    // future rename can't silently break the link.
    const link = buildBounceDeepLink(99);
    expect(link).toMatch(/\/admin\?[^#]*tab=overview/);
    expect(link).toMatch(/cleanupReportSendId=99/);
    expect(link).toMatch(/#cleanup-report-send-99$/);
  });
});

describe("renderBounceNotification", () => {
  it("includes bounced address, window, recipient list and deep link", () => {
    const out = renderBounceNotification({
      sendId: 42,
      bouncedEmail: "ghost@example.com",
      reason: "mailbox_full",
      windowFrom: new Date("2026-01-01T00:00:00Z"),
      windowTo: new Date("2026-01-08T00:00:00Z"),
      originalRecipients: ["auditor@example.com", "ghost@example.com"],
      deepLink: buildBounceDeepLink(42),
    });
    expect(out.subject).toContain("ghost@example.com");
    expect(out.body).toContain("ghost@example.com");
    expect(out.body).toContain("mailbox_full");
    expect(out.body).toContain("2026-01-01");
    expect(out.body).toContain("2026-01-08");
    expect(out.body).toContain("auditor@example.com");
    expect(out.body).toContain("cleanup-report-send-42");
    expect(out.alertMessage).toContain("ghost@example.com");
    expect(out.alertTitle).toContain("ghost@example.com");
  });
});

describe("notifyAdminsOfCleanupReportBounce", () => {
  it("dispatches exactly one alert and dedups subsequent calls", async () => {
    const { sendId, recipientId, bouncedEmail } = await seedBouncedRecipient();

    // Re-tag the title so afterAll cleanup catches the alert.
    const taggedEmail = `${RUN_TAG}-${bouncedEmail}`;
    // We can't easily rewrite the email field after dispatch, so use
    // RUN_TAG in the alert title via the bounced email itself.

    const first = await notifyAdminsOfCleanupReportBounce({ recipientId });
    expect(first).toBe(true);

    // bounce_notified_at must now be stamped.
    const [afterFirst] = await db
      .select({
        bounceNotifiedAt: cleanupReportSendRecipientsTable.bounceNotifiedAt,
      })
      .from(cleanupReportSendRecipientsTable)
      .where(eq(cleanupReportSendRecipientsTable.id, recipientId));
    expect(afterFirst?.bounceNotifiedAt).not.toBeNull();

    // Second call is a no-op.
    const second = await notifyAdminsOfCleanupReportBounce({ recipientId });
    expect(second).toBe(false);

    // Exactly one alert row created.
    const alerts = await db
      .select({ id: alertsTable.id, title: alertsTable.title })
      .from(alertsTable)
      .where(eq(alertsTable.type, "cleanup_report_bounce"));
    const ours = alerts.filter((a) => a.title.includes(bouncedEmail));
    expect(ours.length).toBe(1);

    // Cleanup: rename the alert title so afterAll's RUN_TAG cleanup
    // also catches it (bouncedEmail already contains RUN_TAG).
    expect(bouncedEmail).toContain(RUN_TAG);
    expect(sendId).toBeGreaterThan(0);
    expect(taggedEmail).toContain(RUN_TAG);
  });

  it("refuses to notify when the row is not in 'bounced' state", async () => {
    const bouncedEmail = `pending-${RUN_TAG}@test.local`;
    const [send] = await db
      .insert(cleanupReportSendsTable)
      .values({
        trigger: "manual",
        recipientCount: 1,
        recipients: bouncedEmail,
        rowCount: 0,
        status: "success",
        messageId: `<${RUN_TAG}-pending>`,
      })
      .returning({ id: cleanupReportSendsTable.id });
    createdSendIds.push(send.id);
    const [rec] = await db
      .insert(cleanupReportSendRecipientsTable)
      .values({ sendId: send.id, email: bouncedEmail, status: "pending" })
      .returning({ id: cleanupReportSendRecipientsTable.id });

    const result = await notifyAdminsOfCleanupReportBounce({
      recipientId: rec.id,
    });
    expect(result).toBe(false);

    const alerts = await db
      .select({ id: alertsTable.id, title: alertsTable.title })
      .from(alertsTable)
      .where(eq(alertsTable.type, "cleanup_report_bounce"));
    expect(alerts.find((a) => a.title.includes(bouncedEmail))).toBeUndefined();
  });

  it("wins exactly once under concurrent calls (provider retry storm)", async () => {
    const { recipientId, bouncedEmail } = await seedBouncedRecipient();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        notifyAdminsOfCleanupReportBounce({ recipientId }),
      ),
    );
    const winners = results.filter((r) => r === true);
    expect(winners.length).toBe(1);

    const alerts = await db
      .select({ id: alertsTable.id, title: alertsTable.title })
      .from(alertsTable)
      .where(eq(alertsTable.type, "cleanup_report_bounce"));
    expect(
      alerts.filter((a) => a.title.includes(bouncedEmail)).length,
    ).toBe(1);
  });
});
