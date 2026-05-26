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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import {
  db,
  pool,
  alertsTable,
  cleanupReportSendsTable,
  cleanupReportSendRecipientsTable,
} from "@workspace/db";

// Mock the mailer so task #230's dispatch tests can flip between
// "send succeeds" and "send fails" branches without touching SMTP.
// The pre-existing notifyAdminsOfCleanupReportBounce tests don't
// configure an admin notification email, so they never hit sendMail
// regardless of the mock state.
vi.mock("./mailer", () => ({
  isMailerConfigured: vi.fn(() => true),
  sendMail: vi.fn(async () => ({
    sent: true as const,
    provider: "smtp" as const,
    messageId: "<test@local>",
    accepted: [] as string[],
    rejected: [] as string[],
    pending: [] as string[],
  })),
}));

const RUN_TAG = `vitest-bounce-notify-${Date.now()}`;

let notifyAdminsOfCleanupReportBounce: typeof import("./cleanup-report-bounce-notify").notifyAdminsOfCleanupReportBounce;
let renderBounceNotification: typeof import("./cleanup-report-bounce-notify").renderBounceNotification;
let buildBounceDeepLink: typeof import("./cleanup-report-bounce-notify").buildBounceDeepLink;
let renderSuppressionsNotification: typeof import("./cleanup-report-bounce-notify").renderSuppressionsNotification;
let buildSuppressionsDeepLink: typeof import("./cleanup-report-bounce-notify").buildSuppressionsDeepLink;
let renderExpiredSuppressionsNotification: typeof import("./cleanup-report-bounce-notify").renderExpiredSuppressionsNotification;
let notifyAdminsOfExpiredCleanupReportSuppressions: typeof import("./cleanup-report-bounce-notify").notifyAdminsOfExpiredCleanupReportSuppressions;
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
  ({
    notifyAdminsOfCleanupReportBounce,
    renderBounceNotification,
    buildBounceDeepLink,
    renderSuppressionsNotification,
    buildSuppressionsDeepLink,
    renderExpiredSuppressionsNotification,
    notifyAdminsOfExpiredCleanupReportSuppressions,
  } = await import("./cleanup-report-bounce-notify"));
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

describe("buildSuppressionsDeepLink", () => {
  it("targets the overview tab and the suppressions anchor", () => {
    const link = buildSuppressionsDeepLink();
    expect(link).toMatch(/\/admin\?[^#]*tab=overview/);
    expect(link).toMatch(/#cleanup-report-suppressions$/);
  });
});

describe("renderSuppressionsNotification", () => {
  it("formats a single-recipient digest with bounce count, reason and deep link", () => {
    const out = renderSuppressionsNotification(
      [
        {
          email: "ghost@example.com",
          suppressedAt: new Date().toISOString(),
          bounceCount: 3,
          lastReason: "mailbox_full",
        },
      ],
      buildSuppressionsDeepLink(),
    );
    expect(out.subject).toContain("ghost@example.com");
    expect(out.body).toContain("ghost@example.com");
    expect(out.body).toContain("3");
    expect(out.body).toContain("mailbox_full");
    expect(out.body).toContain("#cleanup-report-suppressions");
  });

  it("collapses a multi-recipient batch into a single email listing every address", () => {
    const out = renderSuppressionsNotification(
      [
        {
          email: "a@example.com",
          suppressedAt: new Date().toISOString(),
          bounceCount: 3,
          lastReason: "mailbox_full",
        },
        {
          email: "b@example.com",
          suppressedAt: new Date().toISOString(),
          bounceCount: 4,
          lastReason: null,
        },
      ],
      "https://app.example/admin#cleanup-report-suppressions",
    );
    expect(out.subject).toContain("2 عناوين");
    expect(out.body).toContain("a@example.com");
    expect(out.body).toContain("b@example.com");
    expect(out.body).toContain("غير محدد");
  });
});

describe("renderExpiredSuppressionsNotification", () => {
  it("formats a single-recipient expiry digest with max-age and deep link", () => {
    const out = renderExpiredSuppressionsNotification(
      [
        {
          email: "ghost@example.com",
          suppressedAt: "2026-01-01T00:00:00.000Z",
          bounceCount: 3,
          lastReason: "mailbox_full",
        },
      ],
      buildSuppressionsDeepLink(),
      30,
    );
    expect(out.subject).toContain("ghost@example.com");
    expect(out.body).toContain("ghost@example.com");
    expect(out.body).toContain("2026-01-01");
    expect(out.body).toContain("mailbox_full");
    expect(out.body).toContain("30");
    expect(out.body).toContain("#cleanup-report-suppressions");
    expect(out.alertTitle).toContain("ghost@example.com");
    expect(out.alertMessage).toContain("30");
  });

  it("collapses many expired addresses into one combined notification", () => {
    const out = renderExpiredSuppressionsNotification(
      [
        {
          email: "a@example.com",
          suppressedAt: "2026-01-01T00:00:00.000Z",
          bounceCount: 3,
          lastReason: "mailbox_full",
        },
        {
          email: "b@example.com",
          suppressedAt: "2026-01-02T00:00:00.000Z",
          bounceCount: 5,
          lastReason: null,
        },
      ],
      "https://app.example/admin#cleanup-report-suppressions",
      45,
    );
    expect(out.subject).toContain("2 عناوين");
    expect(out.body).toContain("a@example.com");
    expect(out.body).toContain("b@example.com");
    expect(out.body).toContain("غير محدد");
    expect(out.body).toContain("45");
    expect(out.alertTitle).toContain("2");
  });
});

describe("notifyAdminsOfExpiredCleanupReportSuppressions", () => {
  let mailer: typeof import("./mailer");

  beforeAll(async () => {
    mailer = await import("./mailer");
  });

  async function setAdminEmail(email: string | null): Promise<void> {
    await pool.query(
      `
      INSERT INTO app_settings (id, system, updated_at)
      VALUES (
        1,
        jsonb_build_object(
          'cleanupReport',
          jsonb_build_object('adminNotificationEmail', to_jsonb($1::text))
        ),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
        SET system = COALESCE(app_settings.system, '{}'::jsonb)
                     || jsonb_build_object(
                          'cleanupReport',
                          COALESCE(app_settings.system->'cleanupReport', '{}'::jsonb)
                            || jsonb_build_object('adminNotificationEmail', to_jsonb($1::text))
                        ),
            updated_at = NOW()
      `,
      [email ?? ""],
    );
  }

  async function clearAdminEmail(): Promise<void> {
    await pool.query(
      `
      UPDATE app_settings
         SET system = jsonb_set(
               COALESCE(system, '{}'::jsonb),
               '{cleanupReport,adminNotificationEmail}',
               'null'::jsonb,
               true
             ),
             updated_at = NOW()
       WHERE id = 1
      `,
    );
  }

  const sampleExpired = (tag: string) => [
    {
      email: `expired-a-${tag}@example.test`,
      suppressedAt: "2026-01-01T00:00:00.000Z",
      bounceCount: 3,
      lastReason: "mailbox_full",
    },
    {
      email: `expired-b-${tag}@example.test`,
      suppressedAt: "2026-01-02T00:00:00.000Z",
      bounceCount: 4,
      lastReason: null,
    },
  ];

  it("sends ONE combined email when adminNotificationEmail is configured and SMTP works", async () => {
    const adminEmail = `admin-${RUN_TAG}-ok@example.test`;
    await setAdminEmail(adminEmail);
    vi.mocked(mailer.isMailerConfigured).mockReturnValue(true);
    vi.mocked(mailer.sendMail).mockClear();
    vi.mocked(mailer.sendMail).mockResolvedValue({
      sent: true,
      provider: "smtp",
      messageId: "<expiry@test>",
      accepted: [],
      rejected: [],
      pending: [],
    });

    const expired = sampleExpired(`${RUN_TAG}-ok`);
    const result = await notifyAdminsOfExpiredCleanupReportSuppressions(
      expired,
      30,
    );
    expect(result).toBe(true);
    expect(vi.mocked(mailer.sendMail)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mailer.sendMail).mock.calls[0][0]!;
    expect(call.to).toBe(adminEmail);
    expect(call.body).toContain(expired[0].email);
    expect(call.body).toContain(expired[1].email);
    expect(call.body).toContain("30");

    // No in-app alert should have been emitted on the happy path.
    const alerts = await db
      .select({ id: alertsTable.id, title: alertsTable.title })
      .from(alertsTable)
      .where(eq(alertsTable.type, "cleanup_report_suppression_expired"));
    const ours = alerts.filter((a) =>
      a.title.includes(`${RUN_TAG}-ok`),
    );
    expect(ours.length).toBe(0);
    await clearAdminEmail();
  });

  it("falls back to ONE in-app alert listing the addresses when no admin email is configured", async () => {
    await clearAdminEmail();
    vi.mocked(mailer.sendMail).mockClear();

    const expired = sampleExpired(`${RUN_TAG}-noemail`);
    const result = await notifyAdminsOfExpiredCleanupReportSuppressions(
      expired,
      30,
    );
    expect(result).toBe(true);
    expect(vi.mocked(mailer.sendMail)).not.toHaveBeenCalled();

    const alerts = await db
      .select({
        id: alertsTable.id,
        title: alertsTable.title,
        message: alertsTable.message,
      })
      .from(alertsTable)
      .where(eq(alertsTable.type, "cleanup_report_suppression_expired"));
    const ours = alerts.filter((a) =>
      a.message.includes(`${RUN_TAG}-noemail`),
    );
    expect(ours.length).toBe(1);
    expect(ours[0].message).toContain(expired[0].email);
    expect(ours[0].message).toContain(expired[1].email);
    expect(ours[0].message).toContain("#cleanup-report-suppressions");
  });

  it("falls back to an in-app alert (with addresses) when the admin email send fails", async () => {
    const adminEmail = `admin-${RUN_TAG}-fail@example.test`;
    await setAdminEmail(adminEmail);
    vi.mocked(mailer.isMailerConfigured).mockReturnValue(true);
    vi.mocked(mailer.sendMail).mockClear();
    vi.mocked(mailer.sendMail).mockResolvedValue({
      sent: false,
      reason: "smtp_rejected",
    });

    const expired = sampleExpired(`${RUN_TAG}-fail`);
    const result = await notifyAdminsOfExpiredCleanupReportSuppressions(
      expired,
      45,
    );
    expect(result).toBe(true);
    expect(vi.mocked(mailer.sendMail)).toHaveBeenCalledTimes(1);

    const alerts = await db
      .select({
        id: alertsTable.id,
        message: alertsTable.message,
      })
      .from(alertsTable)
      .where(eq(alertsTable.type, "cleanup_report_suppression_expired"));
    const ours = alerts.filter((a) =>
      a.message.includes(`${RUN_TAG}-fail`),
    );
    expect(ours.length).toBe(1);
    expect(ours[0].message).toContain(expired[0].email);
    expect(ours[0].message).toContain(expired[1].email);
    expect(ours[0].message).toContain("45");
    await clearAdminEmail();
  });

  it("no-ops on an empty expired list", async () => {
    vi.mocked(mailer.sendMail).mockClear();
    const result = await notifyAdminsOfExpiredCleanupReportSuppressions(
      [],
      30,
    );
    expect(result).toBe(false);
    expect(vi.mocked(mailer.sendMail)).not.toHaveBeenCalled();
  });

  it("truncates very long expired lists in the in-app alert with a '+N more' tail", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      email: `m${i}@example.com`,
      suppressedAt: "2026-01-01T00:00:00.000Z",
      bounceCount: 3,
      lastReason: null,
    }));
    const out = renderExpiredSuppressionsNotification(
      many,
      "https://app.example/admin#cleanup-report-suppressions",
      30,
    );
    // First 10 listed, +5 إضافي tail.
    expect(out.alertMessage).toContain("m0@example.com");
    expect(out.alertMessage).toContain("m9@example.com");
    expect(out.alertMessage).not.toContain("m10@example.com");
    expect(out.alertMessage).toContain("+5 إضافي");
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
