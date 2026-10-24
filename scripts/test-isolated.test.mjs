import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the actual pnpm -> runner boundary, but never launch PostgreSQL,
// migrations, bootstrap, or Vitest. The preload intercepts every child command.
function run(args, failVitest = false, corruptLegacy = false) {
  const root = mkdtempSync(join(tmpdir(), "hasba-runner-regression-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "artifacts/api-server/src/lib"), { recursive: true });
    copyFileSync(new URL("./test-isolated.mjs", import.meta.url), join(root, "scripts/test-isolated.mjs"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      private: true,
      scripts: { "test:isolated": "node --import ./stub.mjs scripts/test-isolated.mjs" },
    }));
    writeFileSync(join(root, "stub.mjs"), `
      import childProcess from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
      import { join, dirname } from "node:path";
      childProcess.spawnSync = (command, args, options = {}) => {
        appendFileSync("calls.jsonl", JSON.stringify({
          command, args, cwd: options.cwd,
          database: options.env?.DATABASE_URL,
          testDatabase: options.env?.TEST_DATABASE_URL,
          mode: options.env?.NODE_ENV,
          smtpDisabled: options.env?.SMTP_HOST === "",
          aiDisabled: options.env?.OPENAI_API_KEY === "",
          legacyBootstrap: options.env?.HASBA_LEGACY_TEST_BOOTSTRAP,
        }) + "\\n");
        if (command === "tar") {
          const destination = args[args.indexOf("-C") + 1];
          for (const name of ["app.ts", "test/bootstrap.ts", "lib/workflow-init.ts"]) {
            const path = join(destination, "artifacts/api-server/src", name);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, "pinned fixture source");
          }
        }
        let stdout = "";
        if (command === "git" && args[0] === "rev-parse") stdout = "a".repeat(40);
        if (command === "git" && args[0] === "hash-object") stdout = (${corruptLegacy} ? "b" : "a").repeat(40);
        return {
          status: ${failVitest ? 1 : 0} && args.includes("vitest") ? 1 : 0,
          stdout, stderr: "",
        };
      };
      syncBuiltinESMExports();
    `);
    const result = spawnSync("pnpm", ["--dir", root, "test:isolated", ...args], {
      encoding: "utf8",
      timeout: 20_000,
      // Deliberately bogus application DB: it must never reach a child stage.
      env: { ...process.env, PG_BIN: "/stub-postgres", DATABASE_URL: "must-not-be-used", TEST_DATABASE_URL: "must-be-replaced" },
    });
    assert.ifError(result.error);
    const calls = readFileSync(join(root, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    const stages = calls.filter((call) => call.command === "pnpm");
    assert.equal(stages.length, corruptLegacy ? 0 : args.includes("--legacy-upgrade") ? 4 : 3, "migration-only install, bootstrap, then Vitest; push only in explicit legacy fixture");
    if (!args.includes("--legacy-upgrade")) assert.equal(stages.some((stage) => stage.args.includes("push")), false);
    if (args.includes("--legacy-upgrade") && !corruptLegacy) {
      assert.ok(calls.filter((call) => call.command === "git" && call.args[0] === "hash-object").length >= 3);
      assert.match(stages[2].legacyBootstrap, /\/legacy\/artifacts\/api-server\/src\/test\/bootstrap\.ts$/);
      assert.equal(stages[2].args.at(-1), stages[2].legacyBootstrap, "bootstrap the archived application, not today's initializer");
      assert.equal(calls.some((call) => call.command === "git" && call.args[0] === "diff"), false);
    }
    for (const stage of stages) {
      assert.match(stage.database, /^postgresql:\/\/hasba_test@127\.0\.0\.1:\d+\/hasba_test_verify$/);
      assert.equal(stage.database, stage.testDatabase);
      assert.equal(stage.mode, "test");
      assert.equal(stage.smtpDisabled, true);
      assert.equal(stage.aiDisabled, true);
      assert.equal(stage.cwd, root);
    }
    const init = calls.find((call) => call.command === "/stub-postgres/initdb");
    assert.ok(init);
    const data = init.args[init.args.indexOf("-D") + 1];
    assert.equal(existsSync(join(data, "..")), false, "temporary cluster directory must be removed");
    assert.deepEqual(calls.at(-1).args, ["-D", data, "-m", "immediate", "-w", "stop"]);
    assert.equal(calls.at(-1).command, "/stub-postgres/pg_ctl");
    assert.equal(result.status, failVitest || corruptLegacy ? 1 : 0, result.stdout + result.stderr);
    if (corruptLegacy) assert.match(result.stderr, /Archived legacy initializer does not match/);
    return stages.at(-1)?.args ?? [];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const filters = ["src/routes/sales-return-cost.test.ts", "-t", "matching return تكلفة"];
for (const prefix of [[], ["--"], ["--", "--"]]) {
  test(`forwards file and -t through pnpm with ${prefix.length} leading separators`, () => {
    const args = run([...prefix, ...filters]);
    assert.deepEqual(args.slice(0, -3), [
      "--filter", "@workspace/api-server", "exec", "vitest", "run", ...filters,
    ]);
    assert.deepEqual(args.slice(-3, -1), ["--reporter=default", "--reporter=json"]);
    assert.match(args.at(-1), /--outputFile=.*\/generated-artifacts\/verification\/tests\.json$/);
  });
}

test("keeps a no-filter invocation as the full suite", () => {
  assert.deepEqual(run([]).slice(0, -3), ["--filter", "@workspace/api-server", "exec", "vitest", "run"]);
});

test("does not forward installer-only flags to Vitest", () => {
  assert.deepEqual(run(["--migrations-only", ...filters]).slice(5, -3), filters);
  assert.deepEqual(run(["--legacy-upgrade", ...filters]).slice(5, -3), filters);
});

test("rejects a corrupted pinned initializer before migrations and still cleans the cluster", () => {
  assert.deepEqual(run(["--legacy-upgrade", ...filters], false, true), []);
});

test("preserves option values and non-leading separators", () => {
  const filters = ["src/example.test.ts", "-t", "--", "--", "literal"];
  assert.deepEqual(run(["--", ...filters]).slice(5, -3), filters);
});

test("cleans the disposable cluster and propagates a failed Vitest exit", () => {
  assert.deepEqual(run(["--", ...filters], true).slice(5, -3), filters);
});
