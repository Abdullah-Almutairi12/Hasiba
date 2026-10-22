import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
/**
 * Task #205 — HTTP integration tests for the per-recipient resend
 * guardrails on `POST /admin/system-settings/cleanup-report-sends/:id/resend`.
 *
 * The endpoint added a `recipients[]` body so admins can re-send a
 * historical cleanup-report email to a *subset* of the original
 * audience ("I never got the May 12 report"). The contract:
 *   - No body / empty `recipients[]` → re-send to the FULL original list.
 *   - A real subset → re-send to ONLY those addresses, response `subset`
 *     flag is `true`, audit log details string carries the `(subset)`
 *     marker.
 *   - Any requested address NOT in the original list → 400 (never
 *     introduce new addresses; "send now" is the right tool for that).
 *   - Malformed entries (empty / whitespace-only strings) → 400 from
 *     the strict body schema.
 *
 * Mocks `mailer`, `alerts-cleanup-pdf`, and `compliance/report-section`
 * so the test never touches SMTP or rebuilds a real PDF — mirrors the
 * pattern in `alerts-cleanup-report-email.test.ts`. The full Express
 * middleware chain runs (session → requireAuth → requireCompanyContext
 * → adminGuard → route) via a real supertest cookie-jar login.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, desc, eq, or } from "drizzle-orm";
import {
  db,
  companiesTable,
  usersTable,
  userCompaniesTable,
  cleanupReportSendsTable,
  auditLogsTable,
  warehousesTable,
} from "@workspace/db";

// Keep the real audit writer, but let this suite join fire-and-forget writes
// before reading/deleting fixtures. Production audit behavior is unchanged.
const auditWrites = vi.hoisted(() => ({
  pending: [] as Promise<void>[],
  beforeWrite: undefined as ((req: import("express").Request) => Promise<void>) | undefined,
}));

vi.mock("../lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/audit")>();
  return {
    ...actual,
    recordAudit: (...args: Parameters<typeof actual.recordAudit>) => {
      const pending = (async () => {
        await auditWrites.beforeWrite?.(args[0]);
        await actual.recordAudit(...args);
      })();
      auditWrites.pending.push(pending);
      return pending;
    },
  };
});

async function waitForAuditWrites(): Promise<void> {
  while (auditWrites.pending.length) {
    await Promise.all(auditWrites.pending.splice(0));
  }
}

vi.mock("../lib/mailer", () => ({
  isMailerConfigured: vi.fn(() => true),
  sendMail: vi.fn(async () => ({
    sent: true as const,
    provider: "smtp" as const,
    messageId: "<test@local>",
  })),
}));

vi.mock("../lib/alerts-cleanup-pdf", () => ({
  buildAlertsCleanupPdf: vi.fn(async () => ({
    buffer: Buffer.from("%PDF-stub"),
    filename: "stub.pdf",
    rowCount: 0,
    complianceAlertCount: 0,
  })),
}));

vi.mock("../lib/compliance/report-section", () => ({
  loadComplianceReportSummary: vi.fn(async () => ({
    counts: { transferPricing: 0, agreementMissing: 0, zakat: 0 },
    alerts: [],
  })),
}));

const app = (await import("../app")).default;
const mailer = await import("../lib/mailer");

const RUN_TAG = `vitest-resend-${Date.now()}`;
const PASSWORD = "Test1234!";

let companyId = 0;
let userId = 0;
let sendRowId = 0;
const ORIGINAL_RECIPIENTS = [
  "alice@example.com",
  "bob@example.com",
  "carol@example.com",
];
let agent: request.Agent;

beforeAll(async () => {
  const [co] = await db
    .insert(companiesTable)
    .values({ name: `Resend Co ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  companyId = co.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  const [u] = await db
    .insert(usersTable)
    .values({
      name: `Mgr ${RUN_TAG}`,
      email: `mgr-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "manager",
      isActive: true,
    })
    .returning();
  userId = u.id;

  await db.insert(userCompaniesTable).values({
    userId,
    companyId,
    role: "manager",
    isDefault: true,
  });

  const [row] = await db
    .insert(cleanupReportSendsTable)
    .values({
      trigger: "cron",
      triggeredByUserId: null,
      triggeredByUserName: null,
      recipientCount: ORIGINAL_RECIPIENTS.length,
      recipients: ORIGINAL_RECIPIENTS.join(", "),
      rowCount: 7,
      status: "success",
      failureReason: null,
      windowFrom: new Date("2026-02-10T00:00:00.000Z"),
      windowTo: new Date("2026-02-17T00:00:00.000Z"),
    })
    .returning();
  sendRowId = row.id;

  agent = request.agent(app);
  const login = await agent
    .post("/api/auth/login")
    .send({ email: `mgr-${RUN_TAG}@test.local`, password: PASSWORD });
  if (login.status !== 200) {
    throw new Error(
      `login failed — ${login.status} body=${JSON.stringify(login.body)}`,
    );
  }
});

afterAll(async () => {
  // A response is not evidence that its unawaited audit INSERT has finished.
  await waitForAuditWrites();
  if (sendRowId) {
    await db
      .delete(cleanupReportSendsTable)
      .where(
        or(
          eq(cleanupReportSendsTable.id, sendRowId),
          eq(cleanupReportSendsTable.triggeredByUserId, userId),
        ),
      );
  }
  if (companyId) {
    await db
      .delete(auditLogsTable)
      .where(eq(auditLogsTable.companyId, companyId));
    await db
      .delete(warehousesTable)
      .where(eq(warehousesTable.companyId, companyId));
  }
  if (userId) {
    await db
      .delete(userCompaniesTable)
      .where(eq(userCompaniesTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
  if (companyId) {
    await cleanupCompanyDefaults([companyId]);
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  }
});

beforeEach(() => {
  vi.mocked(mailer.isMailerConfigured).mockReturnValue(true);
  vi.mocked(mailer.sendMail).mockClear();
  vi.mocked(mailer.sendMail).mockResolvedValue({
    sent: true,
    provider: "smtp",
    messageId: "<test@local>",
    accepted: [],
    rejected: [],
    pending: [],
  });
});

async function latestResendAudit(): Promise<{
  details: string | null;
} | null> {
  await waitForAuditWrites();
  const rows = await db
    .select({
      id: auditLogsTable.id,
      details: auditLogsTable.details,
      action: auditLogsTable.action,
    })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.companyId, companyId),
        eq(auditLogsTable.action, "system_settings.cleanup_report_resent"),
      ),
    )
    .orderBy(desc(auditLogsTable.id))
    .limit(1);
  return rows[0] ? { details: rows[0].details } : null;
}

async function clearResendAudits(): Promise<void> {
  await waitForAuditWrites();
  await db
    .delete(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.companyId, companyId),
        eq(auditLogsTable.action, "system_settings.cleanup_report_resent"),
      ),
    );
}

describe("POST /admin/system-settings/cleanup-report-sends/:id/resend", () => {
  it("rejects (400) when mail is not configured without sending or auditing a successful resend", async () => {
    await clearResendAudits();
    vi.mocked(mailer.isMailerConfigured).mockReturnValue(false);

    const res = await agent
      .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
      .send();

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "البريد غير مُهيأ — يرجى ضبط SMTP_HOST/SMTP_PORT.",
      reason: "mailer_not_configured",
    });
    expect(mailer.sendMail).not.toHaveBeenCalled();
    // Join real audit writes before asserting that no success was recorded.
    expect(await latestResendAudit()).toBeNull();
  });

  it("rejects (400) when the mail provider fails without auditing a successful resend", async () => {
    await clearResendAudits();
    const reason = "SMTP provider rejected the test dispatch";
    vi.mocked(mailer.sendMail).mockResolvedValue({ sent: false, reason });

    const res = await agent
      .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
      .send({ recipients: ["alice@example.com"] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: reason, reason });
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "alice@example.com" }),
    );
    expect(await latestResendAudit()).toBeNull();
  });

  it("retries the same report after a provider failure and records exactly one successful resend", async () => {
    await clearResendAudits();
    const selected = ["alice@example.com", "bob@example.com"];
    const reason = "SMTP provider temporarily unavailable";
    // Only the first dispatch fails; beforeEach's successful provider response
    // remains in place for the retry, without clearing calls or audit rows.
    vi.mocked(mailer.sendMail).mockResolvedValueOnce({ sent: false, reason });
    const endpoint =
      `/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`;

    try {
      const failed = await agent.post(endpoint).send({ recipients: selected });
      expect(failed.status).toBe(400);
      expect(failed.body).toEqual({ error: reason, reason });
      expect(mailer.sendMail).toHaveBeenCalledTimes(1);
      expect(mailer.sendMail).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ to: selected.join(", ") }),
      );
      expect(await latestResendAudit()).toBeNull();

      const retried = await agent.post(endpoint).send({ recipients: selected });
      expect(retried.status).toBe(200);
      expect(retried.body).toEqual({
        ok: true,
        sent: true,
        recipients: selected,
        rowCount: 0,
        subset: true,
        additional: 0,
      });
      expect(mailer.sendMail).toHaveBeenCalledTimes(2);
      expect(mailer.sendMail).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ to: selected.join(", ") }),
      );

      await waitForAuditWrites();
      // Read every matching row: a latest-row query would hide duplicates.
      const audits = await db
        .select({ details: auditLogsTable.details })
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.companyId, companyId),
            eq(auditLogsTable.action, "system_settings.cleanup_report_resent"),
          ),
        );
      expect(audits).toEqual([
        { details: `source=${sendRowId} recipients=2/3 (subset) rows=0` },
      ]);
    } finally {
      await waitForAuditWrites();
    }
  });

  it("keeps a successful resend successful without sending twice when the real audit writer fails", async () => {
    await clearResendAudits();
    const auditFailure = new Error("Simulated audit INSERT failure");
    const warn = vi.fn();
    let restoreWarn: (() => void) | undefined;
    let auditInsertAttempts = 0;
    let mailCallsAtAuditFailure = 0;
    const realInsert = db.insert.bind(db);
    const insertSpy = vi.spyOn(db, "insert").mockImplementation((table) => {
      // Fail inside the real recordAudit try/catch, not in its wrapper.
      // All other INSERTs (including send history) still use the real DB.
      if (table === auditLogsTable) {
        auditInsertAttempts++;
        mailCallsAtAuditFailure = vi.mocked(mailer.sendMail).mock.calls.length;
        throw auditFailure;
      }
      return realInsert(table);
    });
    auditWrites.beforeWrite = async (req) => {
      const spy = vi.spyOn(req.log, "warn").mockImplementation(warn);
      restoreWarn = () => spy.mockRestore();
    };

    try {
      const res = await agent
        .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
        .send({ recipients: ["alice@example.com"] });
      // A response alone does not prove the fire-and-forget writer settled.
      await waitForAuditWrites();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        sent: true,
        recipients: ["alice@example.com"],
        rowCount: 0,
        subset: true,
        additional: 0,
      });
      expect(auditInsertAttempts).toBe(1);
      expect(mailCallsAtAuditFailure).toBe(1);
      expect(mailer.sendMail).toHaveBeenCalledTimes(1);
      expect(mailer.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "alice@example.com" }),
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        {
          err: auditFailure,
          entry: {
            action: "system_settings.cleanup_report_resent",
            entity: "cleanup_report_sends",
            details: `source=${sendRowId} recipients=1/3 (subset) rows=0`,
            severity: "info",
          },
        },
        "audit log failed",
      );
      expect(await latestResendAudit()).toBeNull();
    } finally {
      // Drain before restoring the fault/logger or allowing fixture teardown.
      try {
        await waitForAuditWrites();
      } finally {
        auditWrites.beforeWrite = undefined;
        restoreWarn?.();
        insertSpy.mockRestore();
      }
    }
  });

  it("full-list path (no body) emails every original recipient, response.subset=false, audit lacks the (subset) marker", async () => {
    await clearResendAudits();
    const res = await agent
      .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.subset).toBe(false);
    expect((res.body.recipients as string[]).sort()).toEqual(
      [...ORIGINAL_RECIPIENTS].sort(),
    );

    // Underlying mailer received the full comma-joined list.
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = vi.mocked(mailer.sendMail).mock.calls[0][0]!;
    for (const r of ORIGINAL_RECIPIENTS) {
      expect(mailArgs.to).toContain(r);
    }

    // Audit log carries n/n recipients and NO `(subset)` marker.
    const audit = await latestResendAudit();
    expect(audit).not.toBeNull();
    expect(audit?.details).toContain(`source=${sendRowId}`);
    expect(audit?.details).toContain(
      `recipients=${ORIGINAL_RECIPIENTS.length}/${ORIGINAL_RECIPIENTS.length}`,
    );
    expect(audit?.details).not.toContain("(subset)");
  });

  it("valid subset path emails ONLY the selected addresses, response.subset=true, audit carries the (subset) marker", async () => {
    await clearResendAudits();
    const selected = ["alice@example.com", "bob@example.com"];
    const res = await agent
      .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
      .send({ recipients: selected });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.subset).toBe(true);
    expect((res.body.recipients as string[]).sort()).toEqual(
      [...selected].sort(),
    );

    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = vi.mocked(mailer.sendMail).mock.calls[0][0]!;
    // Selected addresses are included…
    for (const r of selected) expect(mailArgs.to).toContain(r);
    // …and the unselected original recipient is NOT.
    expect(mailArgs.to).not.toContain("carol@example.com");

    const audit = await latestResendAudit();
    expect(audit?.details).toContain(`source=${sendRowId}`);
    expect(audit?.details).toContain(
      `recipients=${selected.length}/${ORIGINAL_RECIPIENTS.length}`,
    );
    expect(audit?.details).toContain("(subset)");
  });

  it("full subset (selecting every original recipient) is NOT flagged as a subset", async () => {
    await clearResendAudits();
    const res = await agent
      .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
      .send({ recipients: [...ORIGINAL_RECIPIENTS] });
    expect(res.status).toBe(200);
    // recipients.length === originalRecipients.length → isSubset stays false.
    expect(res.body.subset).toBe(false);
    const audit = await latestResendAudit();
    expect(audit?.details).not.toContain("(subset)");
  });

  it("rejects (400) when any requested recipient is NOT in the original list — never introduces new addresses", async () => {
    await clearResendAudits();
    vi.mocked(mailer.sendMail).mockClear();
    const res = await agent
      .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
      .send({
        recipients: ["alice@example.com", "stranger@evil.example"],
      });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    // Mailer must not have been invoked.
    expect(mailer.sendMail).not.toHaveBeenCalled();
    // No audit row for a rejected resend.
    const audit = await latestResendAudit();
    expect(audit).toBeNull();
  });

  it("rejects (400) malformed selections (empty or whitespace-only strings) at the body schema", async () => {
    await clearResendAudits();
    vi.mocked(mailer.sendMail).mockClear();
    const empty = await agent
      .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
      .send({ recipients: [""] });
    expect(empty.status).toBe(400);
    const ws = await agent
      .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
      .send({ recipients: ["   "] });
    expect(ws.status).toBe(400);
    expect(mailer.sendMail).not.toHaveBeenCalled();
    const audit = await latestResendAudit();
    expect(audit).toBeNull();
  });

  it("subset path matches recipients case-insensitively but preserves the original casing in the response", async () => {
    await clearResendAudits();
    const res = await agent
      .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
      .send({ recipients: ["ALICE@example.com"] });
    expect(res.status).toBe(200);
    expect(res.body.subset).toBe(true);
    // The response reflects the *original* casing, not what the admin typed.
    expect(res.body.recipients).toEqual(["alice@example.com"]);
  });

  it("waits for a delayed real audit write before fixture cleanup", async () => {
    await clearResendAudits();
    let releaseWrite!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    auditWrites.beforeWrite = () => {
      markStarted();
      return gate;
    };
    let drained = false;
    let draining: Promise<void> | undefined;
    try {
      const res = await agent
        .post(`/api/admin/system-settings/cleanup-report-sends/${sendRowId}/resend`)
        .send({ recipients: ["alice@example.com"] });
      expect(res.status).toBe(200);
      await started;
      // The same barrier used by afterAll must not finish just because the
      // HTTP response arrived. No sleeps or assumptions about DB speed.
      draining = waitForAuditWrites().then(() => { drained = true; });
      await Promise.resolve();
      expect(drained).toBe(false);
      const rows = await db.select().from(auditLogsTable).where(
        and(
          eq(auditLogsTable.companyId, companyId),
          eq(auditLogsTable.action, "system_settings.cleanup_report_resent"),
        ),
      );
      expect(rows).toHaveLength(0);
    } finally {
      releaseWrite();
      auditWrites.beforeWrite = undefined;
      await draining;
      await waitForAuditWrites();
    }
    expect(drained).toBe(true);
    // Real persistence, not a stub: teardown will have an audit FK to remove.
    expect((await latestResendAudit())?.details).toContain(`source=${sendRowId}`);
  });
});
