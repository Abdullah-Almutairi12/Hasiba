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
  })),
}));

vi.mock("./alerts-cleanup-pdf", () => ({
  buildAlertsCleanupPdf: vi.fn(async () => ({
    buffer: Buffer.from("%PDF-stub"),
    filename: "stub.pdf",
    rowCount: 0,
  })),
}));

const {
  isDue,
  sendCleanupReportEmail,
  readCleanupReportConfig,
  defaultCleanupReportConfig,
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
  });
  vi.mocked(pdfMod.buildAlertsCleanupPdf).mockResolvedValue({
    buffer: Buffer.from("%PDF-stub"),
    filename: "stub.pdf",
    rowCount: 0,
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
        { schedule: "off", recipients: ["a@b.com"], lastSentAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isDue(
        {
          schedule: "off",
          recipients: ["a@b.com"],
          lastSentAt: "2020-01-01T00:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("returns false when recipients list is empty", () => {
    expect(
      isDue({ schedule: "weekly", recipients: [], lastSentAt: null }, now),
    ).toBe(false);
  });

  it("returns true on weekly schedule when never sent before", () => {
    expect(
      isDue(
        { schedule: "weekly", recipients: ["a@b.com"], lastSentAt: null },
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
