import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Test runs (NODE_ENV=test, set automatically by Vitest) prefer
// TEST_DATABASE_URL when present so the suite never touches the dev /
// staging tenant data. Falls back to DATABASE_URL with a stderr
// warning — kept as a fallback so existing CI configs don't break.
const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
let connectionString = process.env.DATABASE_URL;
if (isTest && process.env.TEST_DATABASE_URL) {
  connectionString = process.env.TEST_DATABASE_URL;
} else if (isTest && !process.env.TEST_DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[db] WARN: NODE_ENV=test but TEST_DATABASE_URL is not set — " +
      "tests will run against DATABASE_URL (the dev database). " +
      "Provision a dedicated test DB to keep fixtures isolated.",
  );
}

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
