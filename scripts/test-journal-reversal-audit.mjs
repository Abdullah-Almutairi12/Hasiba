// Dedicated test target: creates/destroys its own PostgreSQL cluster and runs
// only the diagnostic tests. Never uses a configured application database.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

const root = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "hasba-journal-audit-"));
const data = join(work, "pg");
const executable = (name) => process.env.PG_BIN ? join(process.env.PG_BIN, name) : name;
let started = false;
const run = (command, args, env, capture = false) => {
  const result = spawnSync(command, args, {
    cwd: root, env, stdio: capture ? "pipe" : "inherit", encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed${capture ? `: ${result.stderr ?? ""}` : ""}`);
  }
};
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolvePort(address.port));
  });
});
try {
  run(executable("initdb"), ["-D", data, "-A", "trust", "-U", "hasba_test", "--no-locale", "--encoding=UTF8"], process.env, true);
  run(executable("pg_ctl"), ["-D", data, "-l", join(work, "postgres.log"), "-o", `-F -p ${port} -h 127.0.0.1 -k ${work}`, "-w", "start"], process.env, true);
  started = true;
  run(executable("createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", "hasba_test", "hasba_test_journal_audit"], process.env, true);
  const url = `postgresql://hasba_test@127.0.0.1:${port}/hasba_test_journal_audit`;
  const env = {
    ...process.env, NODE_ENV: "test", DATABASE_URL: url, TEST_DATABASE_URL: url,
    JOURNAL_AUDIT_DATABASE_URL: url,
  };
  console.log("Testing journal diagnostic only, on fresh temporary PostgreSQL with the actual project schema.");
  run("pnpm", ["--filter", "@workspace/db", "exec", "drizzle-kit", "push", "--force"], env);
  run("pnpm", ["--filter", "@workspace/scripts", "exec", "tsx", "--test", "src/journal-reversal-audit.test.ts"], env);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) spawnSync(executable("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  rmSync(work, { recursive: true, force: true });
}
