import "reflect-metadata";
import { assertApplicationReady } from "../app";
import { pool } from "@workspace/db";

// Initializers are run once before files execute, avoiding concurrent DDL.
try {
  await assertApplicationReady();
  await pool.query("SELECT 1");
  await pool.end();
  process.exit(0);
} catch (error) {
  const cause = error instanceof Error ? error.cause : undefined;
  const diagnostic = cause as { code?: string; stack?: string } | undefined;
  console.error("[test:isolated] Test schema initialization failed.", {
    code: diagnostic?.code,
    locations: diagnostic?.stack?.split("\n").slice(1).filter((line) => /^\s+at /.test(line)),
  });
  process.exit(1);
}
