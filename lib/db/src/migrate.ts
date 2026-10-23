import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSqlStatements } from "./sql-statements";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.resolve(__dirname, "../drizzle");
const MIGRATIONS_TABLE = "_drizzle_sql_migrations";
const BASELINE = "@bootstrap/installation-20261023";
const BOOTSTRAP_FILE = path.resolve(__dirname, "../bootstrap/0000_installation_baseline.sql");

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
]);

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

async function runStatement(
  client: pg.PoolClient,
  statement: string,
  file: string,
): Promise<void> {
  await client.query("SAVEPOINT migration_statement");
  try {
    await client.query(statement);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code && DUPLICATE_OBJECT_CODES.has(code)) {
      // Do not discard earlier successful statements in this migration.
      await client.query("ROLLBACK TO SAVEPOINT migration_statement");
    } else {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to apply migration ${file}: ${message}`, { cause: err });
    }
  }
  await client.query("RELEASE SAVEPOINT migration_statement");
}

export async function runMigrations(
  databaseUrl: string = process.env.DATABASE_URL ?? "",
  log: (msg: string) => void = (m) => console.log(m),
  options: { migrationsDir?: string; bootstrapFile?: string | null } = {},
): Promise<MigrateResult> {
  const migrationsDir = options.migrationsDir ?? MIGRATIONS_DIR;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set to run migrations.");
  }
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pool = new Pool({ connectionString: databaseUrl });
  const applied: string[] = [];
  const skipped: string[] = [];
  const client = await pool.connect();

  try {
    // Serialize installers before reading history or creating the baseline.
    await client.query("SELECT pg_advisory_lock(hashtextextended('hasba:migrations', 0))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ filename: string }>(
      `SELECT filename FROM ${MIGRATIONS_TABLE}`,
    );
    const done = new Set(rows.map((r) => r.filename));
    const bootstrapFile = options.bootstrapFile === undefined ? BOOTSTRAP_FILE : options.bootstrapFile;
    if (bootstrapFile) {
      if (done.has(BASELINE)) {
        skipped.push(BASELINE);
      } else {
        const { rows: tables } = await client.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename<>$1", [MIGRATIONS_TABLE],
        );
        if (tables.length === 0 && done.size === 0) {
          await client.query("BEGIN");
          try {
            await client.query(fs.readFileSync(bootstrapFile, "utf8"));
            await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)`, [BASELINE]);
            await client.query("COMMIT");
            applied.push(BASELINE);
            log("✓ installed frozen empty-database baseline (no schema push)");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        } else if (!["companies", "products", "users"].every((name) => tables.some((table) => table.tablename === name))) {
          throw new Error("Unrecognized nonempty database: automatic bootstrap refused; review installation history.");
        } else {
          log("Existing application schema: baseline NOT applied; existing data untouched.");
        }
      }
    }

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      const statements = splitSqlStatements(sql);
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
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended('hasba:migrations', 0))").catch(() => undefined);
    client.release();
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
