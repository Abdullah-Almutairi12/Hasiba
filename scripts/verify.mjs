import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { writeVerificationReport } from "./verification-report.mjs";
import { verificationSource } from "./verification-source.mjs";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "generated-artifacts", "verification");
mkdirSync(out, { recursive: true });
const source = verificationSource(root);
writeFileSync(join(out, "source-revision.json"), JSON.stringify(source, null, 2));
const checks = [
  ["typecheck", ["run", "typecheck"]],
  ["isolated-runner-tests", ["exec", "node", "--test", "scripts/test-isolated.test.mjs"]],
  ["invoice-cleanup-evidence-tests", ["exec", "node", "--test",
    "scripts/check-browser-repeated-invoice-cleanup.test.mjs",
    "scripts/check-browser-cleanup-identical-invoice.test.mjs",
    "scripts/check-browser-invoice-cleanup-success.test.mjs"]],
  ["receipt-cleanup-evidence-tests", ["exec", "node", "--test",
    "scripts/check-browser-receipt-rejection-cleanup.test.mjs",
    "scripts/check-browser-repeated-receipt-cleanup.test.mjs",
    "scripts/check-browser-multi-receipt-cleanup.test.mjs",
    "scripts/check-browser-receipt-cleanup-success.test.mjs",
    "scripts/check-browser-reloaded-receipt-cleanup.test.mjs",
    "scripts/check-browser-reloaded-identical-receipt.test.mjs"]],
  ["return-cleanup-evidence-tests", ["exec", "node", "--test",
    "scripts/check-browser-repeated-return-cleanup.test.mjs",
    "scripts/check-browser-reloaded-return-cleanup.test.mjs",
    "scripts/check-browser-reloaded-identical-return.test.mjs"]],
  ["migration-upgrade", ["run", "test:isolated", "--", "--legacy-upgrade",
    "src/routes/sales-return-cost.test.ts", "-t", "upgrade preserves"]],
  ["tests", ["run", "test:isolated"]],
  ["erp-ui-tests", ["--filter", "@workspace/erp-system", "run", "test"]],
  ["api-build", ["--filter", "@workspace/api-server", "run", "build"]],
  ...[
    ["erp-system", "/"], ["docs", "/docs/"],
    ["features-deck", "/features-deck/"], ["mockup-sandbox", "/__mockup/"],
  ].map(([name, base]) => [
    `${name}-build`, ["--filter", `@workspace/${name}`, "run", "build"],
    { NODE_ENV: "production", PORT: "8080", BASE_PATH: base },
  ]),
  ["dependency-audit", ["audit", "--json", "--audit-level=low"]],
];
const results = [];
for (const [name, args, env] of checks) {
  console.log(`\n[verify] ${name}`);
  const start = Date.now();
  const result = spawnSync("pnpm", args, {
    cwd: root, env: { ...process.env, ...env },
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(out, `${name}.log`), output);
  if (name === "dependency-audit") {
    writeFileSync(join(out, "audit-after.json"), result.stdout ?? "");
  }
  const passed = !result.error && result.status === 0;
  results.push({ name, passed, exitCode: result.status, durationMs: Date.now() - start });
  console.log(`[verify] ${passed ? "PASS" : "FAIL"} ${name}; log: generated-artifacts/verification/${name}.log`);
}
const after = verificationSource(root);
results.push({ name: "source-unchanged", passed: source.sourceSha256 === after.sourceSha256, exitCode: 0, durationMs: 0 });
const summary = { at: new Date().toISOString(), source, results };
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
writeVerificationReport(out, summary);
console.table(results);
process.exitCode = results.every((r) => r.passed) ? 0 : 1;
