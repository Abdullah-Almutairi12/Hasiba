import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { auditJournalReversals, type ReversalFinding } from "./journal-reversal-audit";

// The dedicated runner supplies this; fail closed for ad-hoc invocations.
const url = process.env.TEST_DATABASE_URL;
if (!url || !/^hasba_test_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1))
  || new URL(url).hostname !== "127.0.0.1") {
  throw new Error("Use pnpm --filter @workspace/scripts run test:journal-reversal-audit");
}
const pool = new pg.Pool({ connectionString: url });
const stamp = "2026-10-22 10:00:00";
let findings: ReversalFinding[];
let beforeAudit: unknown;

async function snapshot() {
  // All public table contents AND sequence positions, not just row counts.
  const { rows: tables } = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const rows = [];
  for (const { tablename } of tables) {
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    rows.push([tablename, (await pool.query(
      `SELECT to_jsonb(t) AS row FROM public.${quoted} t ORDER BY to_jsonb(t)::text`,
    )).rows]);
  }
  return { rows, sequences: (await pool.query(
    "SELECT sequencename, last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
  )).rows };
}

async function entry(id: number, options: {
  company?: number; reversalOf?: number; reversedAt?: boolean;
  reversedBy?: number | null; postedBy?: number | null; status?: string;
  amount?: string;
} = {}) {
  await pool.query(`INSERT INTO journal_entries
    (id, entry_number, entry_date, description, company_id, status,
     reversal_of, reversed_at, reversed_by, posted_by)
    VALUES ($1, $2, '2026-10-22', 'Synthetic audit fixture', $3, $4, $5, $6, $7, $8)`,
  [id, `AUDIT-${id}`, options.company ?? 1, options.status ?? "posted",
    options.reversalOf ?? null, options.reversedAt ? stamp : null,
    options.reversedBy ?? null, options.postedBy ?? null]);
  const reverse = options.reversalOf !== undefined;
  const amount = options.amount ?? "100.00";
  await pool.query(`INSERT INTO journal_entry_lines
    (entry_id, line_number, account_id, debit, credit, base_debit, base_credit)
    VALUES ($1, 1, 1, $2, $3, $2, $3), ($1, 2, 2, $3, $2, $3, $2)`,
  [id, reverse ? "0.00" : amount, reverse ? amount : "0.00"]);
}
function finding(id: number) {
  const result = findings.find((f) => f.reversal_of === id);
  assert.ok(result, `Expected finding for ${id}`);
  return result;
}
function cli(args: string[], target: string | undefined = url) {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "postgresql://unused.invalid/never_connect" };
  if (target) env.JOURNAL_AUDIT_DATABASE_URL = target;
  else delete env.JOURNAL_AUDIT_DATABASE_URL;
  return spawnSync("tsx", ["src/audit-journal-reversals.ts", ...args], { env, encoding: "utf8" });
}

before(async () => {
  // This database was created empty by our runner from the real Drizzle schema.
  await pool.query(`
    INSERT INTO companies (id, name) VALUES (1, 'Synthetic A'), (2, 'Synthetic B');
    INSERT INTO users (id, name, email, role) VALUES
      (1, 'Synthetic actor', 'actor@example.invalid', 'admin'),
      (2, 'Synthetic other', 'other@example.invalid', 'admin');
    INSERT INTO currencies (code, name, name_ar, symbol) VALUES ('SAR', 'SAR', 'ريال', 'SAR');
    INSERT INTO accounts (id, code, name, name_ar, type) VALUES
      (1, 'AUDIT-1', 'Cash', 'نقد', 'asset'), (2, 'AUDIT-2', 'Offset', 'مقابل', 'liability');
  `);
  // Ordinary posted/draft entries, valid human and automated reversals.
  await entry(1);
  await entry(2, { status: "draft" });
  await entry(10, { reversedAt: true, reversedBy: 1 });
  await entry(11, { reversalOf: 10, postedBy: 1 });
  await entry(20, { company: 2, reversedAt: true });
  await entry(21, { company: 2, reversalOf: 20 }); // null actor is valid
  // Legitimate reversal-of-a-reversal chain.
  await entry(30, { reversedAt: true });
  await entry(31, { reversalOf: 30, reversedAt: true });
  await entry(32, { reversalOf: 31 });
  assert.equal((await auditJournalReversals(pool)).finding_count, 0);
  assert.equal(cli(["--read-only"]).status, 0);

  await entry(100, { reversedAt: true, reversedBy: 1 });
  await entry(101, { reversalOf: 100, postedBy: 1 });
  await entry(102, { reversalOf: 100, postedBy: 1 });
  await entry(110, { reversedAt: true, reversedBy: 1 }); // no counterpart
  await entry(120);
  await entry(121, { reversalOf: 120 }); // no timestamp, null actors
  await entry(130, { reversedBy: 1 }); // actor without timestamp/child
  await entry(140, { reversedAt: true, reversedBy: 1 });
  await entry(141, { reversalOf: 140, postedBy: 2 });
  await entry(150, { reversedAt: true });
  await entry(151, { reversalOf: 150, company: 2 });
  await entry(160, { reversalOf: 999999 }); // schema deliberately has no reversal_of FK
  await entry(170, { reversedAt: true, status: "reversed" });
  await entry(171, { reversalOf: 170 });
  await entry(180, { reversedAt: true });
  await entry(181, { reversalOf: 180, status: "draft" });
  await entry(190, { reversedAt: true, reversalOf: 190 });
  await entry(200, { reversedAt: true });
  await entry(201, { reversalOf: 200, postedBy: 1 }); // null vs nonnull actor
  await entry(210, { reversedAt: true, amount: "9999999999999999.99" });
  await entry(211, { reversalOf: 210, amount: "9999999999999999.99" });
  await entry(212, { reversalOf: 210, amount: "9999999999999999.99" });
  // Run with a SELECT-only role too; read-only is enforced even for privileged users.
  await pool.query(`CREATE ROLE audit_reader LOGIN;
    GRANT CONNECT ON DATABASE hasba_test_journal_audit TO audit_reader;
    GRANT USAGE ON SCHEMA public TO audit_reader;
    GRANT SELECT ON journal_entries, journal_entry_lines TO audit_reader;`);
  beforeAudit = await snapshot();
  const readerUrl = new URL(url!);
  readerUrl.username = "audit_reader";
  readerUrl.password = "";
  const reader = new pg.Pool({ connectionString: readerUrl.toString() });
  try {
    findings = (await auditJournalReversals(reader)).findings;
  } finally {
    await reader.end();
  }
});
after(async () => { await pool.end(); });

test("clean entries, human/automated reversals and chains produce no findings", () => {
  for (const id of [1, 2, 10, 20, 30, 31]) {
    assert.equal(findings.some((f) => f.reversal_of === id), false);
  }
  assert.equal(findings.length, 12);
});
test("duplicate counterparts include IDs, company and exact GL residual by account", () => {
  const f = finding(100);
  assert.deepEqual(f.issue_codes, ["MULTIPLE_REVERSALS"]);
  assert.equal(f.company_id, 1);
  assert.equal(f.original?.id, 100);
  assert.deepEqual(f.reversals.map((r) => r.id), [101, 102]);
  assert.deepEqual(f.gl_posted_net_by_company_account.map((r) => [r.account_id, r.net_base_debit]),
    [[1, "-100.00"], [2, "100.00"]]);
});
test("timestamp/actor evidence disagreements are detected, including null actors", () => {
  assert.deepEqual(finding(110).issue_codes, ["METADATA_WITHOUT_REVERSAL"]);
  assert.deepEqual(finding(120).issue_codes, ["REVERSAL_WITHOUT_TIMESTAMP"]);
  assert.deepEqual(finding(130).issue_codes, ["METADATA_WITHOUT_REVERSAL", "ACTOR_WITHOUT_TIMESTAMP"]);
  assert.deepEqual(finding(140).issue_codes, ["ACTOR_MISMATCH"]);
  assert.deepEqual(finding(200).issue_codes, ["ACTOR_MISMATCH"]);
});
test("cross-company reversal is not netted across companies", () => {
  const f = finding(150);
  assert.deepEqual(f.issue_codes, ["CROSS_COMPANY_REVERSAL"]);
  assert.equal(f.original?.company_id, 1);
  assert.equal(f.reversals[0].company_id, 2);
  assert.deepEqual(f.gl_posted_net_by_company_account.map((r) => [r.company_id, r.account_id, r.net_base_debit]),
    [[1, 1, "100.00"], [1, 2, "-100.00"], [2, 1, "-100.00"], [2, 2, "100.00"]]);
});
test("dangling links, legacy reversed status, draft counterpart and self-link are visible", () => {
  assert.equal(finding(999999).original, null);
  assert.equal(finding(999999).company_id, null);
  assert.equal(finding(999999).reversals[0].company_id, 1);
  assert.deepEqual(finding(999999).issue_codes, ["MISSING_ORIGINAL"]);
  assert.deepEqual(finding(170).issue_codes, ["NON_POSTED_ORIGINAL"]);
  assert.deepEqual(finding(180).issue_codes, ["NON_POSTED_REVERSAL"]);
  assert.deepEqual(finding(170).gl_posted_net_by_company_account.map((r) => r.net_base_debit), ["-100.00", "100.00"]);
  assert.deepEqual(finding(180).gl_posted_net_by_company_account.map((r) => r.net_base_debit), ["100.00", "-100.00"]);
  assert.deepEqual(finding(190).issue_codes, ["SELF_REVERSAL"]);
  assert.equal(finding(190).gl_posted_net_by_company_account[0].net_base_debit, "-100.00");
});
test("GL money retains PostgreSQL decimal precision without JS floating point", () => {
  assert.equal(finding(210).gl_posted_net_by_company_account[0].net_base_debit, "-9999999999999999.99");
});
test("CLI emits JSON with exit 2 for findings and works with read-only connection defaults", () => {
  const result = cli(["--read-only"]);
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.read_only, true);
  assert.deepEqual(report.findings, findings);
});
test("CLI rejects missing target, unknown or repair options; help never connects", () => {
  assert.equal(cli(["--help"], undefined).status, 0);
  assert.equal(cli(["--read-only"], "").status, 1);
  assert.equal(cli([]).status, 1);
  assert.equal(cli(["--repair"]).status, 1);
  const failure = cli(["--read-only"], "postgresql://audit:do-not-print@127.0.0.1:1/no_database");
  assert.equal(failure.status, 1);
  assert.equal(failure.stderr.includes("do-not-print"), false);
});
test("auditor starts a PostgreSQL read-only repeatable-read transaction", async () => {
  // Observe the real connection used by the auditor, not a simulated SQL engine.
  const client = await pool.connect();
  const query = client.query.bind(client);
  let checked = false;
  const originalQuery = client.query;
  client.query = (async (text: string, ...args: unknown[]) => {
    if (text.startsWith("\nWITH targets")) {
      const state = await query("SHOW transaction_read_only");
      assert.equal(state.rows[0].transaction_read_only, "on");
      assert.equal((await query("SHOW transaction_isolation")).rows[0].transaction_isolation, "repeatable read");
      await query("SAVEPOINT write_probe");
      await assert.rejects(query("UPDATE public.journal_entries SET reversed_at = NULL"),
        (error: unknown) => (error as { code: string }).code === "25006");
      await query("ROLLBACK TO SAVEPOINT write_probe");
      checked = true;
    }
    return query(text, ...args as []);
  }) as typeof client.query;
  // The auditor owns/release its connection. Supply this one real client.
  try {
    await auditJournalReversals({ connect: async () => client } as unknown as pg.Pool);
  } finally {
    client.query = originalQuery;
  }
  assert.equal(checked, true);
});
test("all public rows and sequence positions are identical before and after diagnostic runs", async () => {
  assert.deepEqual(await snapshot(), beforeAudit);
});
