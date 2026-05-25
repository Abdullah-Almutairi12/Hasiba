/**
 * Tests for the nightly alerts retention sweep (task #158, #161, #164, #171).
 *
 * Runs against the live DATABASE_URL — matches the convention in
 * `scoped-db.test.ts` / `tenant-http.test.ts`. We exercise the
 * resolvers and `runAlertsCleanup()` directly. Fixture rows are
 * tagged with a per-run prefix so we can isolate and clean up.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import {
  db,
  pool,
  alertsTable,
  alertsCleanupRunsTable,
  appSettingsTable,
} from "@workspace/db";
import {
  resolveAuditKeepRuns,
  resolveRetention,
  runAlertsCleanup,
} from "./alerts-cleanup-cron";

const RUN_TAG = `vitest-cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TITLE_PREFIX = `cleanup-test-${RUN_TAG}`;

// Snapshot of the singleton `app_settings.system` blob so we can
// restore whatever the running environment had after the test.
let originalSystem: unknown = null;
let hadSettingsRow = false;

async function setSystem(patch: Record<string, unknown>): Promise<void> {
  await pool.query(
    `
    INSERT INTO app_settings (id, system, updated_at)
    VALUES (1, $1::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE
      SET system = COALESCE(app_settings.system, '{}'::jsonb) || $1::jsonb,
          updated_at = NOW()
    `,
    [JSON.stringify(patch)],
  );
}

async function clearSystemKeys(keys: string[]): Promise<void> {
  const expr = keys.map((_, i) => `$${i + 1}::text`).join(", ");
  await pool.query(
    `
    UPDATE app_settings
       SET system = system - ARRAY[${expr}]::text[],
           updated_at = NOW()
     WHERE id = 1
    `,
    keys,
  );
}

beforeAll(async () => {
  const existing = await db.select().from(appSettingsTable).limit(1);
  if (existing.length > 0) {
    hadSettingsRow = true;
    originalSystem = existing[0].system;
  }
});

afterAll(async () => {
  // Best-effort cleanup of test fixtures.
  await db.delete(alertsTable).where(like(alertsTable.title, `${TITLE_PREFIX}%`));
  await db
    .delete(alertsCleanupRunsTable)
    .where(inArray(alertsCleanupRunsTable.id, fixtureRunIds));

  // Restore original `system` blob. We can't truly "remove" the row
  // if it didn't exist before because INSERT might have created it
  // via setSystem, so we just put the original value back.
  if (hadSettingsRow) {
    await pool.query(
      `UPDATE app_settings SET system = $1::jsonb, updated_at = NOW() WHERE id = 1`,
      [JSON.stringify(originalSystem ?? {})],
    );
  } else {
    await pool.query(`DELETE FROM app_settings WHERE id = 1`);
  }
});

afterEach(async () => {
  await clearSystemKeys([
    "alertRetentionDays",
    "cleanupAuditKeepRuns",
    "lastAlertSweep",
  ]);
  delete process.env.ALERTS_RETENTION_DAYS;
});

const fixtureRunIds: number[] = [];

describe("resolveRetention — precedence", () => {
  it("prefers app_settings.system.alertRetentionDays over env and default", async () => {
    await setSystem({ alertRetentionDays: 42 });
    process.env.ALERTS_RETENTION_DAYS = "30";
    const r = await resolveRetention();
    expect(r).toEqual({ retentionDays: 42, source: "db" });
  });

  it("falls back to ALERTS_RETENTION_DAYS env when DB value is absent", async () => {
    process.env.ALERTS_RETENTION_DAYS = "30";
    const r = await resolveRetention();
    expect(r).toEqual({ retentionDays: 30, source: "env" });
  });

  it("falls back to the hardcoded default when DB and env are absent", async () => {
    const r = await resolveRetention();
    expect(r).toEqual({ retentionDays: 90, source: "default" });
  });

  it("ignores an out-of-range DB value and falls through to env/default", async () => {
    await setSystem({ alertRetentionDays: 1 }); // below MIN (7)
    const r1 = await resolveRetention();
    expect(r1.source).toBe("default");
    expect(r1.retentionDays).toBe(90);

    await setSystem({ alertRetentionDays: 99999 }); // above MAX
    process.env.ALERTS_RETENTION_DAYS = "45";
    const r2 = await resolveRetention();
    expect(r2).toEqual({ retentionDays: 45, source: "env" });
  });
});

describe("resolveAuditKeepRuns — clamp + default fallback", () => {
  it("returns the configured value when in range", async () => {
    await setSystem({ cleanupAuditKeepRuns: 100 });
    expect(await resolveAuditKeepRuns()).toBe(100);
  });

  it("falls back to default 365 when value is missing", async () => {
    expect(await resolveAuditKeepRuns()).toBe(365);
  });

  it("falls back to default when value is below MIN_AUDIT_KEEP (30)", async () => {
    await setSystem({ cleanupAuditKeepRuns: 10 });
    expect(await resolveAuditKeepRuns()).toBe(365);
  });

  it("falls back to default when value is above MAX_AUDIT_KEEP (3650)", async () => {
    await setSystem({ cleanupAuditKeepRuns: 999999 });
    expect(await resolveAuditKeepRuns()).toBe(365);
  });
});

describe("runAlertsCleanup — DELETE behavior", () => {
  it("deletes only read alerts older than the retention window", async () => {
    await setSystem({ alertRetentionDays: 7 });

    // Build four fixture rows:
    //   * old + read    -> SHOULD be deleted
    //   * old + unread  -> kept (is_read=false)
    //   * recent + read -> kept (within retention)
    //   * recent + unread -> kept
    const oldDate = sql`NOW() - INTERVAL '30 days'`;
    const recentDate = sql`NOW() - INTERVAL '1 day'`;
    const inserted = await db
      .insert(alertsTable)
      .values([
        {
          title: `${TITLE_PREFIX}-old-read`,
          message: "x",
          isRead: true,
          createdAt: oldDate as unknown as Date,
        },
        {
          title: `${TITLE_PREFIX}-old-unread`,
          message: "x",
          isRead: false,
          createdAt: oldDate as unknown as Date,
        },
        {
          title: `${TITLE_PREFIX}-recent-read`,
          message: "x",
          isRead: true,
          createdAt: recentDate as unknown as Date,
        },
        {
          title: `${TITLE_PREFIX}-recent-unread`,
          message: "x",
          isRead: false,
          createdAt: recentDate as unknown as Date,
        },
      ])
      .returning({ id: alertsTable.id, title: alertsTable.title });

    const summary = await runAlertsCleanup();
    // Other concurrent test data could exist; assert OUR fixtures.
    expect(summary.retentionDays).toBe(7);
    expect(summary.source).toBe("db");
    expect(summary.deleted).toBeGreaterThanOrEqual(1);

    const survivors = await db
      .select({ title: alertsTable.title })
      .from(alertsTable)
      .where(
        inArray(
          alertsTable.id,
          inserted.map((r) => r.id),
        ),
      );
    const titles = survivors.map((r) => r.title).sort();
    expect(titles).toEqual(
      [
        `${TITLE_PREFIX}-old-unread`,
        `${TITLE_PREFIX}-recent-read`,
        `${TITLE_PREFIX}-recent-unread`,
      ].sort(),
    );

    // Track newly written audit row(s) for cleanup.
    const latestRun = await db
      .select({ id: alertsCleanupRunsTable.id })
      .from(alertsCleanupRunsTable)
      .orderBy(sql`${alertsCleanupRunsTable.ranAt} DESC`)
      .limit(1);
    if (latestRun[0]) fixtureRunIds.push(latestRun[0].id);
  });
});

describe("runAlertsCleanup — audit trim", () => {
  it("trims alerts_cleanup_runs to exactly the configured cap", async () => {
    // Seed the audit table with 5 old rows, then set the cap to 3
    // and run the cleanup — only the 3 most recent rows (including
    // the one runAlertsCleanup itself inserts) must survive.
    const seedRows = await db
      .insert(alertsCleanupRunsTable)
      .values([
        { rowsDeleted: 0, retentionDays: 90, ranAt: new Date(Date.now() - 5 * 60_000) },
        { rowsDeleted: 0, retentionDays: 90, ranAt: new Date(Date.now() - 4 * 60_000) },
        { rowsDeleted: 0, retentionDays: 90, ranAt: new Date(Date.now() - 3 * 60_000) },
        { rowsDeleted: 0, retentionDays: 90, ranAt: new Date(Date.now() - 2 * 60_000) },
        { rowsDeleted: 0, retentionDays: 90, ranAt: new Date(Date.now() - 1 * 60_000) },
      ])
      .returning({ id: alertsCleanupRunsTable.id });
    fixtureRunIds.push(...seedRows.map((r) => r.id));

    const beforeCount = await db.execute(
      sql`SELECT COUNT(*)::int AS c FROM alerts_cleanup_runs`,
    );
    const before = Number(
      (beforeCount.rows[0] as { c: number }).c,
    );
    expect(before).toBeGreaterThanOrEqual(5);

    await setSystem({ cleanupAuditKeepRuns: 30, alertRetentionDays: 90 });
    // The resolver clamps below 30 to default 365, so we lean on the
    // assertion that the cap == 30 actually trims. We need >30 rows
    // total for the trim to bite. Top up to 35 if we're under.
    const need = Math.max(0, 35 - before);
    if (need > 0) {
      const extra = await db
        .insert(alertsCleanupRunsTable)
        .values(
          Array.from({ length: need }, (_, i) => ({
            rowsDeleted: 0,
            retentionDays: 90,
            ranAt: new Date(Date.now() - (100 + i) * 60_000),
          })),
        )
        .returning({ id: alertsCleanupRunsTable.id });
      fixtureRunIds.push(...extra.map((r) => r.id));
    }

    await runAlertsCleanup();

    const afterCount = await db.execute(
      sql`SELECT COUNT(*)::int AS c FROM alerts_cleanup_runs`,
    );
    const after = Number((afterCount.rows[0] as { c: number }).c);
    expect(after).toBe(30);
  });
});
