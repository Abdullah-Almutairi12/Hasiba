/**
 * Run tests against a fresh local PostgreSQL cluster, never DATABASE_URL.
 * No production credentials, data dump, or application rows are copied.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

const root = resolve(import.meta.dirname, "..");
const reportDir = join(root, "generated-artifacts", "verification");
mkdirSync(reportDir, { recursive: true });
if (!process.argv.includes("--browser")) rmSync(join(reportDir, "tests.json"), { force: true });
const work = mkdtempSync(join(tmpdir(), "hasba-test-"));
const data = join(work, "pg");
const bin = process.env.PG_BIN ?? "";
const executable = (name) => bin ? join(bin, name) : name;
let started = false;
let exitCode = 1;
const pnpm = (args, env) => {
  const result = spawnSync("pnpm", args, { cwd: root, env, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`Test stage failed: ${args.slice(0, 4).join(" ")}`);
};
const pg = (name, args) => {
  const result = spawnSync(executable(name), args, { stdio: "pipe", encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`${name} failed. Install PostgreSQL binaries or set PG_BIN. ${result.stderr ?? ""}`);
};
const port = await new Promise((resolvePort, reject) => {
  const socket = createServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const address = socket.address();
    socket.close(() => resolvePort(address.port));
  });
});
try {
  pg("initdb", ["-D", data, "-A", "trust", "-U", "hasba_test", "--no-locale", "--encoding=UTF8"]);
  pg("pg_ctl", ["-D", data, "-l", join(work, "postgres.log"), "-o", `-F -p ${port} -h 127.0.0.1 -k ${work}`, "-w", "start"]);
  started = true;
  pg("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "hasba_test", "hasba_test_verify"]);
  const url = `postgresql://hasba_test@127.0.0.1:${port}/hasba_test_verify`;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    VITEST: "true",
    DATABASE_URL: url,
    TEST_DATABASE_URL: url,
    SESSION_SECRET: randomUUID(),
    // Ensure no external effects are enabled during a verification run.
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "",
    SENTRY_DSN: "", AI_INTEGRATIONS_OPENAI_API_KEY: "", OPENAI_API_KEY: "",
    LOG_LEVEL: "error",
  };
  console.log("[test:isolated] Created a fresh local database; application data is not used.");
  // Legacy SQL history assumes tables created by application initializers.
  // For an EMPTY disposable database, materialize the current schema first.
  pnpm(["--filter", "@workspace/db", "exec", "drizzle-kit", "push", "--force"], env);
  pnpm(["--filter", "@workspace/db", "run", "migrate"], env);
  pnpm(["--filter", "@workspace/scripts", "exec", "tsx", "../artifacts/api-server/src/test/bootstrap.ts"], env);
  if (process.argv.includes("--browser")) {
    const state = join(tmpdir(), "hasba-browser-state.json");
    pnpm(["--filter", "@workspace/scripts", "exec", "tsx", "../artifacts/api-server/src/test/browser-fixtures.ts"],
      { ...env, HASBA_BROWSER_STATE: state, HASBA_BROWSER_RECEIPTS: process.argv.includes("--receipts") ? "true" : "",
        HASBA_BROWSER_RETURNS: process.argv.includes("--returns") ? "true" : "" });
    console.log("[test:isolated] Browser fixtures ready. State: /tmp/hasba-browser-state.json (synthetic data only).");
    await new Promise((done) => {
      const timer = setTimeout(done, 15 * 60 * 1000);
      for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { clearTimeout(timer); done(); });
    });
    rmSync(state, { force: true });
    exitCode = 0;
  } else {
  const args = process.argv.slice(2);
  pnpm(["--filter", "@workspace/api-server", "exec", "vitest", "run", ...args,
    "--reporter=default", "--reporter=json", `--outputFile=${join(reportDir, "tests.json")}`], env);
  exitCode = 0;
  }
} catch (err) {
  console.error("[test:isolated]", err.message);
} finally {
  if (started) spawnSync(executable("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  rmSync(work, { recursive: true, force: true });
}
process.exitCode = exitCode;
