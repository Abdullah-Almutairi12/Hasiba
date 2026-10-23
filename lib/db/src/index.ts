import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export const { Pool } = pg;

// Fail closed: tests must never silently connect to application data.
const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const connectionString = isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (isTest) {
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL is required. Use pnpm test:isolated.");
  }
  const target = new URL(connectionString);
  if (!/^hasba_test_[a-z0-9_]+$/.test(target.pathname.slice(1))) {
    throw new Error("Tests require a dedicated database named hasba_test_<name>.");
  }
}

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
