/**
 * Tests for the scheduled cleanup-report email worker (task #178, #180).
 *
 * `isDue` is pure and exercised directly. `sendCleanupReportEmail` is
 * exercised against the live DATABASE_URL (same convention as
 * `alerts-cleanup-cron.test.ts`): we drive config through the real
 * `app_settings.system.cleanupReport` blob, then stub the mailer + PDF
 * builder so the suite never touches SMTP or rebuilds a real PDF.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db, pool, appSettingsTable } from "@workspace/db";

// Hoisted mocks for the two side-effectful collaborators. vi.mock is
// hoisted above imports, so the SUT below imports the mocked modules.
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

vi.mock("./alerts-cleanup-pdf", () => ({
  buildAlertsCleanupPdf: vi.fn(async () => ({
    buffer: Buffer.from("%PDF-stub"),
    filename: "stub.pdf",
    rowCount: 0,
    complianceAlertCount: 0,
  })),
}));

vi.mock("./compliance/report-section", () => ({
  loadComplianceReportSummary: vi.fn(async () => ({
    counts: { transferPricing: 0, agreementMissing: 0, zakat: 0 },
    alerts: [],
  })),
}));

const {
  isDue,
  sendCleanupReportEmail,
  sendCleanupReportTestEmail,
  readCleanupReportConfig,
  defaultCleanupReportConfig,
  renderCleanupReportEmail,
} = await import("./alerts-cleanup-report-email");
const mailer = await import("./mailer");
const pdfMod = await import("./alerts-cleanup-pdf");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let originalSystem: unknown = null;
let hadSettingsRow = false;

async function setCleanupReport(
  patch: Partial<{
    schedule: "off" | "weekly" | "monthly";
    recipients: string[];
    lastSentAt: string | null;
  }>,
): Promise<void> {
  await pool.query(
    `
    INSERT INTO app_settings (id, system, updated_at)
    VALUES (1, jsonb_build_object('cleanupReport', $1::jsonb), NOW())
    ON CONFLICT (id) DO UPDATE
      SET system = COALESCE(app_settings.system, '{}'::jsonb)
                   || jsonb_build_object(
                        'cleanupReport',
                        COALESCE(app_settings.system->'cleanupReport', '{}'::jsonb)
                          || $1::jsonb
                      ),
          updated_at = NOW()
    `,
    [JSON.stringify(patch)],
  );
}

async function getStoredCleanupReport(): Promise<Record<string, unknown> | null> {
  const r = await pool.query<{ cleanup: unknown }>(
    `SELECT system->'cleanupReport' AS cleanup FROM app_settings WHERE id = 1`,
  );
  const v = r.rows[0]?.cleanup;
  if (!v || typeof v !== "object") return null;
  return v as Record<string, unknown>;
}

beforeAll(async () => {
  const existing = await db.select().from(appSettingsTable).limit(1);
  if (existing.length > 0) {
    hadSettingsRow = true;
    originalSystem = existing[0].system;
  }
});

afterAll(async () => {
  if (hadSettingsRow) {
    await pool.query(
      `UPDATE app_settings SET system = $1::jsonb, updated_at = NOW() WHERE id = 1`,
      [JSON.stringify(originalSystem ?? {})],
    );
  } else {
    await pool.query(`DELETE FROM app_settings WHERE id = 1`);
  }
});

beforeEach(() => {
  vi.mocked(mailer.isMailerConfigured).mockReturnValue(true);
  vi.mocked(mailer.sendMail).mockResolvedValue({
    sent: true,
    provider: "smtp",
    messageId: "<test@local>",
    accepted: [],
    rejected: [],
    pending: [],
  });
  vi.mocked(pdfMod.buildAlertsCleanupPdf).mockResolvedValue({
    buffer: Buffer.from("%PDF-stub"),
    filename: "stub.pdf",
    rowCount: 0,
    complianceAlertCount: 0,
  });
});

afterEach(async () => {
  await pool.query(
    `
    UPDATE app_settings
       SET system = system - 'cleanupReport',
           updated_at = NOW()
     WHERE id = 1
    `,
  );
  vi.clearAllMocks();
});

describe("isDue — cadence math", () => {
  const now = new Date("2026-05-25T12:00:00Z");

  it("returns false when schedule is 'off' regardless of lastSentAt", () => {
    expect(
      isDue(
        {
          schedule: "off",
          recipients: ["a@b.com"],
          lastSentAt: null,
          subject: null,
          intro: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isDue(
        {
          schedule: "off",
          recipients: ["a@b.com"],
          lastSentAt: "2020-01-01T00:00:00.000Z",
          subject: null,
          intro: null,
        },
        now,
      ),
    ).toBe(false);
  });

  it("returns false when recipients list is empty", () => {
    expect(
      isDue(
        {
          schedule: "weekly",
          recipients: [],
          lastSentAt: null,
          subject: null,
          intro: null,
        },
        now,
      ),
    ).toBe(false);
  });

  it("returns true on weekly schedule when never sent before", () => {
    expect(
      isDue(
        {
          schedule: "weekly",
          recipients: ["a@b.com"],
          lastSentAt: null,
          subject: null,
          intro: null,
        },
        now,
      ),
    ).toBe(true);
  });

  it("weekly cadence respects the 7-day window", () => {
    const justUnder = new Date(now.getTime() - 7 * ONE_DAY_MS + 60_000);
    const exactly = new Date(now.getTime() - 7 * ONE_DAY_MS);
    const wellPast = new Date(now.getTime() - 14 * ONE_DAY_MS);

    expect(
      isDue(
        {
          schedule: "weekly",
          recipients: ["a@b.com"],
          lastSentAt: justUnder.toISOString(),
          subject: null,
          intro: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isDue(
        {
          schedule: "weekly",
          recipients: ["a@b.com"],
          lastSentAt: exactly.toISOString(),
          subject: null,
          intro: null,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isDue(
        {
          schedule: "weekly",
          recipients: ["a@b.com"],
          lastSentAt: wellPast.toISOString(),
          subject: null,
          intro: null,
        },
        now,
      ),
    ).toBe(true);
  });

  it("monthly cadence respects the 30-day window", () => {
    const justUnder = new Date(now.getTime() - 30 * ONE_DAY_MS + 60_000);
    const exactly = new Date(now.getTime() - 30 * ONE_DAY_MS);
    const oneWeek = new Date(now.getTime() - 7 * ONE_DAY_MS);

    expect(
      isDue(
        {
          schedule: "monthly",
          recipients: ["a@b.com"],
          lastSentAt: oneWeek.toISOString(),
          subject: null,
          intro: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isDue(
        {
          schedule: "monthly",
          recipients: ["a@b.com"],
          lastSentAt: justUnder.toISOString(),
          subject: null,
          intro: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isDue(
        {
          schedule: "monthly",
          recipients: ["a@b.com"],
          lastSentAt: exactly.toISOString(),
          subject: null,
          intro: null,
        },
        now,
      ),
    ).toBe(true);
  });
});

describe("readCleanupReportConfig — parsing", () => {
  it("returns defaults for malformed input", () => {
    expect(readCleanupReportConfig(null)).toEqual(defaultCleanupReportConfig());
    expect(readCleanupReportConfig({ cleanupReport: "nope" })).toEqual(
      defaultCleanupReportConfig(),
    );
  });

  it("strips non-string recipients and trims/drops empties", () => {
    const cfg = readCleanupReportConfig({
      cleanupReport: {
        schedule: "weekly",
        recipients: ["  a@b.com  ", "", 42, null, "c@d.com"],
        lastSentAt: "2026-05-01T00:00:00.000Z",
      },
    });
    expect(cfg.schedule).toBe("weekly");
    expect(cfg.recipients).toEqual(["a@b.com", "c@d.com"]);
    expect(cfg.lastSentAt).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("sendCleanupReportEmail", () => {
  it("returns {sent:false, reason:'no_recipients'} when recipient list is empty", async () => {
    await setCleanupReport({
      schedule: "weekly",
      recipients: [],
      lastSentAt: null,
    });

    const result = await sendCleanupReportEmail();
    expect(result).toEqual({ sent: false, reason: "no_recipients" });
    expect(mailer.sendMail).not.toHaveBeenCalled();
    expect(pdfMod.buildAlertsCleanupPdf).not.toHaveBeenCalled();
  });

  it("returns {sent:false, reason:'mailer_not_configured'} when SMTP missing", async () => {
    await setCleanupReport({
      schedule: "weekly",
      recipients: ["ops@example.com"],
      lastSentAt: null,
    });
    vi.mocked(mailer.isMailerConfigured).mockReturnValue(false);

    const result = await sendCleanupReportEmail();
    expect(result).toEqual({ sent: false, reason: "mailer_not_configured" });
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it("returns {sent:false, reason:'schedule_off'} when schedule is off and not forced", async () => {
    await setCleanupReport({
      schedule: "off",
      recipients: ["ops@example.com"],
      lastSentAt: null,
    });

    const result = await sendCleanupReportEmail();
    expect(result).toEqual({ sent: false, reason: "schedule_off" });
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it("force=true bypasses the schedule cadence and sends even when schedule is 'off'", async () => {
    await setCleanupReport({
      schedule: "off",
      recipients: ["ops@example.com"],
      lastSentAt: null,
    });

    const result = await sendCleanupReportEmail({ force: true });
    expect(result.sent).toBe(true);
    expect(result.recipients).toEqual(["ops@example.com"]);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    // force without an active schedule defaults to a 7-day weekly window.
    const pdfArgs = vi.mocked(pdfMod.buildAlertsCleanupPdf).mock.calls[0][0]!;
    const windowMs = pdfArgs.to!.getTime() - pdfArgs.from!.getTime();
    expect(Math.round(windowMs / ONE_DAY_MS)).toBe(7);
  });

  it("persists lastSentAt to app_settings after a successful send", async () => {
    await setCleanupReport({
      schedule: "weekly",
      recipients: ["ops@example.com"],
      lastSentAt: null,
    });

    const beforeSend = Date.now();
    const result = await sendCleanupReportEmail();
    const afterSend = Date.now();

    expect(result.sent).toBe(true);
    const stored = await getStoredCleanupReport();
    expect(stored).not.toBeNull();
    const last = stored?.["lastSentAt"];
    expect(typeof last).toBe("string");
    const parsed = new Date(last as string).getTime();
    expect(parsed).toBeGreaterThanOrEqual(beforeSend - 1000);
    expect(parsed).toBeLessThanOrEqual(afterSend + 1000);
    // Other config keys must be preserved by the partial JSON merge.
    expect(stored?.["schedule"]).toBe("weekly");
    expect(stored?.["recipients"]).toEqual(["ops@example.com"]);
  });

  it("recipientsOverride + asTest=false (task #196 resend) sends as 'manual' without bumping lastSentAt and without the [اختبار] prefix", async () => {
    await setCleanupReport({
      schedule: "weekly",
      recipients: ["full-list@example.com"],
      lastSentAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await sendCleanupReportEmail({
      force: true,
      recipientsOverride: ["only-me@example.com"],
      asTest: false,
    });

    expect(result.sent).toBe(true);
    expect(result.recipients).toEqual(["only-me@example.com"]);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = vi.mocked(mailer.sendMail).mock.calls[0][0]!;
    expect(mailArgs.to).toBe("only-me@example.com");
    expect(mailArgs.subject.startsWith("[اختبار]")).toBe(false);
    // Targeted re-send must NOT bump the cron's lastSentAt.
    const stored = await getStoredCleanupReport();
    expect(stored?.["lastSentAt"]).toBe("2026-01-01T00:00:00.000Z");
  });

  it("windowOverride is forwarded to buildAlertsCleanupPdf so a resend reproduces the exact same date window (task #196)", async () => {
    await setCleanupReport({
      schedule: "weekly",
      recipients: ["full-list@example.com"],
      lastSentAt: "2026-01-01T00:00:00.000Z",
    });
    const from = new Date("2026-02-10T00:00:00.000Z");
    const to = new Date("2026-02-17T00:00:00.000Z");

    const result = await sendCleanupReportEmail({
      force: true,
      recipientsOverride: ["only-me@example.com"],
      asTest: false,
      windowOverride: { from, to },
    });

    expect(result.sent).toBe(true);
    const pdfArgs = vi.mocked(pdfMod.buildAlertsCleanupPdf).mock.calls[0][0]!;
    expect(pdfArgs.from!.toISOString()).toBe(from.toISOString());
    expect(pdfArgs.to!.toISOString()).toBe(to.toISOString());
  });

  it("recipientsOverride with default asTest (true) keeps existing test-send behavior (prefixed subject, no lastSentAt bump)", async () => {
    await setCleanupReport({
      schedule: "weekly",
      recipients: ["full-list@example.com"],
      lastSentAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await sendCleanupReportEmail({
      recipientsOverride: ["tester@example.com"],
    });

    expect(result.sent).toBe(true);
    const mailArgs = vi.mocked(mailer.sendMail).mock.calls[0][0]!;
    expect(mailArgs.subject.startsWith("[اختبار]")).toBe(true);
    const stored = await getStoredCleanupReport();
    expect(stored?.["lastSentAt"]).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does NOT persist lastSentAt when the underlying sendMail fails", async () => {
    await setCleanupReport({
      schedule: "weekly",
      recipients: ["ops@example.com"],
      lastSentAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(mailer.sendMail).mockResolvedValue({
      sent: false,
      reason: "smtp boom",
    });

    const result = await sendCleanupReportEmail({ force: true });
    expect(result).toEqual({ sent: false, reason: "smtp boom" });
    const stored = await getStoredCleanupReport();
    expect(stored?.["lastSentAt"]).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("sendCleanupReportTestEmail — one-off test send (task #189)", () => {
  it("returns {sent:false, reason:'invalid_recipient'} when recipient is malformed", async () => {
    const blank = await sendCleanupReportTestEmail({ recipient: "   " });
    expect(blank).toEqual({ sent: false, reason: "invalid_recipient" });
    const bad = await sendCleanupReportTestEmail({ recipient: "not-an-email" });
    expect(bad).toEqual({ sent: false, reason: "invalid_recipient" });
    // Must short-circuit before touching the mailer or PDF builder.
    expect(mailer.sendMail).not.toHaveBeenCalled();
    expect(pdfMod.buildAlertsCleanupPdf).not.toHaveBeenCalled();
  });

  it("returns {sent:false, reason:'mailer_not_configured'} when SMTP is missing", async () => {
    vi.mocked(mailer.isMailerConfigured).mockReturnValue(false);
    const result = await sendCleanupReportTestEmail({
      recipient: "qa@example.com",
    });
    expect(result).toEqual({ sent: false, reason: "mailer_not_configured" });
    expect(mailer.sendMail).not.toHaveBeenCalled();
    expect(pdfMod.buildAlertsCleanupPdf).not.toHaveBeenCalled();
  });

  it("sends successfully with subject prefixed [TEST] and does NOT update lastSentAt", async () => {
    // Seed an existing lastSentAt so we can prove the test path leaves
    // it untouched (the scheduled cron must still fire on its real
    // cadence after a verification ping).
    const PRIOR = "2026-01-01T00:00:00.000Z";
    await setCleanupReport({
      schedule: "weekly",
      recipients: ["audit@example.com"],
      lastSentAt: PRIOR,
    });

    const result = await sendCleanupReportTestEmail({
      recipient: "qa@example.com",
    });

    expect(result.sent).toBe(true);
    expect(result.recipients).toEqual(["qa@example.com"]);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mailer.sendMail).mock.calls[0][0];
    // Recipient is the caller-supplied address, NOT the configured list.
    expect(call.to).toBe("qa@example.com");
    expect(call.subject.startsWith("[TEST] ")).toBe(true);
    // PDF attachment is still produced exactly like the real path.
    expect(pdfMod.buildAlertsCleanupPdf).toHaveBeenCalledTimes(1);
    expect(call.attachments?.[0]?.contentType).toBe("application/pdf");

    // lastSentAt is preserved — the cron cadence must not slip just
    // because someone sent a test.
    const stored = await getStoredCleanupReport();
    expect(stored?.["lastSentAt"]).toBe(PRIOR);
  });

  it("propagates the underlying mailer failure reason without mutating lastSentAt", async () => {
    const PRIOR = "2026-02-02T00:00:00.000Z";
    await setCleanupReport({
      schedule: "weekly",
      recipients: ["audit@example.com"],
      lastSentAt: PRIOR,
    });
    vi.mocked(mailer.sendMail).mockResolvedValue({
      sent: false,
      reason: "smtp boom",
    });

    const result = await sendCleanupReportTestEmail({
      recipient: "qa@example.com",
    });
    expect(result).toEqual({ sent: false, reason: "smtp boom" });
    const stored = await getStoredCleanupReport();
    expect(stored?.["lastSentAt"]).toBe(PRIOR);
  });
});

describe("renderCleanupReportEmail — pure rendering", () => {
  const from = new Date("2026-05-18T00:00:00.000Z");
  const to = new Date("2026-05-25T00:00:00.000Z");
  const zeroCounts = {
    transferPricing: 0,
    agreementMissing: 0,
    zakat: 0,
  };

  it("falls back to the default weekly subject and intro when both are null", () => {
    const out = renderCleanupReportEmail({
      subject: null,
      intro: null,
      schedule: "weekly",
      from,
      to,
      rowCount: 3,
      complianceCounts: zeroCounts,
    });
    expect(out.periodLabel).toBe("الأسبوعي");
    expect(out.from).toBe("2026-05-18");
    expect(out.to).toBe("2026-05-25");
    expect(out.subject).toBe(
      "تقرير تنظيف التنبيهات الأسبوعي (2026-05-18 → 2026-05-25)",
    );
    expect(out.body).toContain("مرفق تقرير تنظيف التنبيهات الأسبوعي.");
    expect(out.body).toContain("النطاق: 2026-05-18 إلى 2026-05-25");
    expect(out.body).toContain("عدد عمليات التنظيف في هذا النطاق: 3");
    expect(out.body).toContain("تم إنشاء هذا التقرير تلقائياً");
  });

  it("uses the monthly period label when schedule is 'monthly'", () => {
    const out = renderCleanupReportEmail({
      subject: null,
      intro: null,
      schedule: "monthly",
      from,
      to,
      rowCount: 0,
      complianceCounts: zeroCounts,
    });
    expect(out.periodLabel).toBe("الشهري");
    expect(out.subject).toBe(
      "تقرير تنظيف التنبيهات الشهري (2026-05-18 → 2026-05-25)",
    );
    expect(out.body).toContain("مرفق تقرير تنظيف التنبيهات الشهري.");
  });

  it("treats schedule='off' as weekly for rendering (force-send path)", () => {
    const out = renderCleanupReportEmail({
      subject: null,
      intro: null,
      schedule: "off",
      from,
      to,
      rowCount: 0,
      complianceCounts: zeroCounts,
    });
    expect(out.periodLabel).toBe("الأسبوعي");
  });

  it("substitutes {period}, {from}, {to} tokens in a custom subject (all occurrences)", () => {
    const out = renderCleanupReportEmail({
      subject:
        "[{period}] {from} → {to} | تقرير {period} من {from} حتى {to}",
      intro: null,
      schedule: "monthly",
      from,
      to,
      rowCount: 0,
      complianceCounts: zeroCounts,
    });
    expect(out.subject).toBe(
      "[الشهري] 2026-05-18 → 2026-05-25 | تقرير الشهري من 2026-05-18 حتى 2026-05-25",
    );
  });

  it("leaves a custom subject without tokens unchanged (no default appended)", () => {
    const out = renderCleanupReportEmail({
      subject: "موضوع ثابت بدون رموز",
      intro: null,
      schedule: "weekly",
      from,
      to,
      rowCount: 0,
      complianceCounts: zeroCounts,
    });
    expect(out.subject).toBe("موضوع ثابت بدون رموز");
  });

  it("uses the custom intro verbatim (no token substitution applied)", () => {
    const out = renderCleanupReportEmail({
      subject: null,
      intro: "مرحباً يا فريق المراجعة — هذا التقرير {period}",
      schedule: "weekly",
      from,
      to,
      rowCount: 5,
      complianceCounts: zeroCounts,
    });
    // intro tokens are intentionally NOT substituted (only subject is).
    expect(out.body.startsWith("مرحباً يا فريق المراجعة — هذا التقرير {period}\n\n")).toBe(
      true,
    );
    // Default intro line must not also appear when a custom intro is provided.
    expect(out.body).not.toContain("مرفق تقرير تنظيف التنبيهات");
  });

  it("totals the three compliance counts and surfaces each subcategory", () => {
    const out = renderCleanupReportEmail({
      subject: null,
      intro: null,
      schedule: "weekly",
      from,
      to,
      rowCount: 0,
      complianceCounts: {
        transferPricing: 2,
        agreementMissing: 3,
        zakat: 5,
      },
    });
    expect(out.complianceAlertCount).toBe(10);
    expect(out.body).toContain(
      "تنبيهات الامتثال (تسعير تحويلي / زكاة / اتفاقيات): 10",
    );
    expect(out.body).toContain("• تسعير تحويلي: 2");
    expect(out.body).toContain("• اتفاقيات مفقودة: 3");
    expect(out.body).toContain("• زكاة: 5");
  });

  it("returns zero compliance total when all three counts are zero", () => {
    const out = renderCleanupReportEmail({
      subject: null,
      intro: null,
      schedule: "weekly",
      from,
      to,
      rowCount: 0,
      complianceCounts: zeroCounts,
    });
    expect(out.complianceAlertCount).toBe(0);
    expect(out.body).toContain(
      "تنبيهات الامتثال (تسعير تحويلي / زكاة / اتفاقيات): 0",
    );
  });
});
