/**
 * Run tests against a fresh local PostgreSQL cluster, never DATABASE_URL.
 * No production credentials, data dump, or application rows are copied.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
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
  // Legacy installation mode is reserved for the documented upgrade fixture.
  // Normal verification must exercise the actual empty-database installer.
  if (process.argv.includes("--legacy-upgrade")) {
    const reference = "6e39f6f";
    const initializers = readdirSync(join(root, "artifacts/api-server/src/lib"))
      .filter((name) => name.endsWith("-init.ts")).map((name) => `artifacts/api-server/src/lib/${name}`);
    const unchanged = spawnSync("git", ["diff", "--quiet", reference, "--", "lib/db/src/schema",
      "artifacts/api-server/src/app.ts", "artifacts/api-server/src/test/bootstrap.ts", ...initializers], { cwd: root });
    if (unchanged.status !== 0) throw new Error("Legacy fixture schema/initializers no longer match the pinned reference");
    const legacy = join(work, "legacy");
    mkdirSync(join(legacy, "lib/db"), { recursive: true });
    const archive = spawnSync("git", ["archive", reference, "lib/db"], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    if (archive.status !== 0) throw new Error("Pinned legacy reference unavailable");
    const extract = spawnSync("tar", ["-x", "-C", legacy], { input: archive.stdout });
    if (extract.status !== 0) throw new Error("Legacy database source extraction failed");
    symlinkSync(join(root, "lib/db/node_modules"), join(legacy, "lib/db/node_modules"), "dir");
    pnpm(["--filter", "@workspace/db", "exec", "drizzle-kit", "push", "--force",
      `--config=${join(legacy, "lib/db/drizzle.config.ts")}`], env);
    pnpm(["--filter", "@workspace/db", "exec", "tsx", join(legacy, "lib/db/src/migrate.ts")], env);
    env.HASBA_MIGRATION_REFERENCE = reference;
    console.log(`[test:isolated] Reconstructed legacy install from ${reference}; synthetic data only.`);
  } else {
    pnpm(["--filter", "@workspace/db", "run", "migrate"], env);
  }
  pnpm(["--filter", "@workspace/scripts", "exec", "tsx", "../artifacts/api-server/src/test/bootstrap.ts"], env);
  if (process.argv.includes("--browser")) {
    const state = join(tmpdir(), "hasba-browser-state.json");
    pnpm(["--filter", "@workspace/scripts", "exec", "tsx", "../artifacts/api-server/src/test/browser-fixtures.ts"],
      { ...env, HASBA_BROWSER_STATE: state, HASBA_BROWSER_RECEIPTS: process.argv.includes("--receipts") ? "true" : "",
        HASBA_BROWSER_POS: process.argv.includes("--pos") ? "true" : "",
        HASBA_BROWSER_MULTI_RECEIPTS: process.argv.includes("--multi-receipts") ? "true" : "",
        HASBA_BROWSER_RETURNS: process.argv.includes("--returns") ? "true" : "",
        HASBA_BROWSER_REVALUATIONS: process.argv.includes("--revaluations") ? "true" : "" });
    console.log("[test:isolated] Browser fixtures ready. State: /tmp/hasba-browser-state.json (synthetic data only).");
    await new Promise((done) => {
      const timer = setTimeout(done, 15 * 60 * 1000);
      for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { clearTimeout(timer); done(); });
    });
    rmSync(state, { force: true });
    exitCode = 0;
  } else {
  const args = process.argv.slice(2).filter((arg) => !["--migrations-only", "--legacy-upgrade"].includes(arg));
  // pnpm run forwards its optional separator; Vitest must see filters, not "--".
  // Only strip leading separators so option values and later "--" stay intact.
  while (args[0] === "--") args.shift();
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
