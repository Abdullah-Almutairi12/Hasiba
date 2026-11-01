/** Native UI review host. Disposable PostgreSQL only; no auth or tax gate overrides. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const state = JSON.parse(readFileSync("/tmp/hasba-browser-state.json", "utf8"));
const url = new URL(state.env.TEST_DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "hasba_test");
assert.equal(url.pathname, "/hasba_test_verify");
assert.ok(url.port);
assert.equal(state.env.DATABASE_URL, state.env.TEST_DATABASE_URL);
assert.equal(state.env.ACCOUNT_ISOLATED_TEST, "true");
Object.assign(process.env, state.env, {
  NODE_ENV: "test", VITEST: "true", LOG_LEVEL: "error",
  SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SENTRY_DSN: "",
  OPENAI_API_KEY: "", AI_INTEGRATIONS_OPENAI_API_KEY: "",
});
const { default: app, assertApplicationReady } = await import("../app");
await assertApplicationReady();
const { verificationSource } = await import(
  new URL("../../../../scripts/verification-source.mjs", import.meta.url).href
);
const dir = resolve(import.meta.dirname, "../../../../generated-artifacts/store-review");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "host-source.json"), JSON.stringify({
  startedAt: new Date().toISOString(), source: await verificationSource(resolve(dir, "../..")),
  isolated: true, taxGateOverridden: false, externalMailConfigured: false,
}, null, 2));
app.listen(8080, "0.0.0.0", () => console.log("[store-review] isolated native API ready:8080"));
