import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.resolve(__dirname, "../drizzle");
const MIGRATIONS_TABLE = "_drizzle_sql_migrations";

// Postgres error codes that mean "object already exists" — safe to ignore
// because all of our hand-rolled migrations are intentionally idempotent
// (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, …). The very first
// `0000_init.sql` is the original drizzle-kit generated migration which does
// NOT use IF NOT EXISTS; tolerating these codes turns the whole file into a
// no-op when the schema is already in place.
const DUPLICATE_OBJECT_CODES = new Set([
  "42P07", // duplicate_table
  "42710", // duplicate_object (constraints, indexes, types)
  "42701", // duplicate_column
  "42P06", // duplicate_schema
  "42723", // duplicate_function
  "42P16", // invalid_table_definition (e.g. PK already exists)
]);

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

function splitStatements(sql: string): string[] {
  // drizzle-kit uses the `--> statement-breakpoint` marker between
  // statements. Files we hand-author may have no marker — in that case we
  // execute the whole file as a single statement.
  return sql
    .split(/-->\s*statement-breakpoint/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function runStatement(
  client: pg.PoolClient,
  statement: string,
  file: string,
): Promise<void> {
  try {
    await client.query(statement);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code && DUPLICATE_OBJECT_CODES.has(code)) {
      // Idempotent re-apply: object already exists. Reset the txn aborted
      // state by issuing a ROLLBACK + fresh BEGIN so subsequent statements
      // can still run inside the same migration.
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to apply migration ${file}: ${message}\n--- statement ---\n${statement.slice(0, 500)}`,
    );
  }
}

export async function runMigrations(
  databaseUrl: string = process.env.DATABASE_URL ?? "",
  log: (msg: string) => void = (m) => console.log(m),
): Promise<MigrateResult> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set to run migrations.");
  }
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pool = new Pool({ connectionString: databaseUrl });
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await pool.query<{ filename: string }>(
      `SELECT filename FROM ${MIGRATIONS_TABLE}`,
    );
    const done = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      const statements = splitStatements(sql);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const stmt of statements) {
          await runStatement(client, stmt, file);
        }
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)
           ON CONFLICT (filename) DO NOTHING`,
          [file],
        );
        await client.query("COMMIT");
        applied.push(file);
        log(`✓ applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }

  return { applied, skipped };
}

const isDirectInvocation = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(argv1);
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  runMigrations()
    .then(({ applied, skipped }) => {
      console.log(
        `Migrations done. Applied: ${applied.length}, skipped: ${skipped.length}.`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
