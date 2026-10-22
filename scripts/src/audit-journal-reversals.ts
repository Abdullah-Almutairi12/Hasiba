import pg from "pg";
import { auditJournalReversals } from "./journal-reversal-audit";

const help = `Read-only journal reversal diagnostic (JSON).
Usage: pnpm --filter @workspace/scripts run audit-journal-reversals --read-only
Requires JOURNAL_AUDIT_DATABASE_URL explicitly; never falls back to DATABASE_URL.
Exit codes: 0 clean, 2 findings, 1 failure/invalid usage.
Do not target production without explicit user approval. No repairs are performed.`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(help);
    return;
  }
  if (args.length !== 1 || args[0] !== "--read-only") throw new Error("usage");
  const connectionString = process.env.JOURNAL_AUDIT_DATABASE_URL;
  if (!connectionString) throw new Error("missing-target");
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    application_name: "journal-reversal-audit",
    options: "-c default_transaction_read_only=on",
  });
  try {
    const report = await auditJournalReversals(pool);
    console.log(JSON.stringify(report, null, 2));
    if (report.finding_count > 0) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  // Driver errors may contain connection details: never print credentials.
  console.error(`Journal audit failed. Check explicit target, SELECT permissions, schema and connectivity.\n${help}`);
  process.exitCode = 1;
});
