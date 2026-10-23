import { test } from "node:test";
import assert from "node:assert/strict";
import { assertDisposableSeedTarget, requireSeedPassword } from "./src/seed-safety.ts";

const valid = {
  databaseName: "hasiba_seed_0123456789abcdef",
  environment: "development",
  args: ["--confirm-disposable-seed"],
};

test("destructive seed requires both a disposable database and explicit confirmation", () => {
  assert.doesNotThrow(() => assertDisposableSeedTarget(valid));
  for (const databaseName of ["neondb", "postgres", "hasiba", "hasiba_seed_", "prefix_hasiba_seed_0123456789abcdef"]) {
    assert.throws(() => assertDisposableSeedTarget({ ...valid, databaseName }));
  }
  assert.throws(() => assertDisposableSeedTarget({ ...valid, args: [] }));
  assert.throws(() => assertDisposableSeedTarget({ ...valid, environment: "production" }));
});

test("seed password is required, bounded and never included in errors", () => {
  const synthetic = "Synthetic-Only-719!";
  assert.equal(requireSeedPassword(synthetic), synthetic);
  for (const value of [undefined, "", "short", "a".repeat(80), "ONLYUPPERCASE123!", "NoNumberPassword!", "NoSymbolPassword123"]) {
    assert.throws(() => requireSeedPassword(value), (error) => !value || !error.message.includes(value));
  }
  assert.throws(() => requireSeedPassword("ك".repeat(36) + "Aa1!"));
});
