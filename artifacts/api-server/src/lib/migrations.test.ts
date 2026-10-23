import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "@workspace/db";
import { runMigrations } from "../../../../lib/db/src/migrate";
import { splitSqlStatements } from "../../../../lib/db/src/sql-statements";

describe("PostgreSQL migration statement boundaries", () => {
  it("preserves quoted semicolons, nested comments, and procedural bodies", () => {
    const sql = `-- comment ;
      SELECT ';', 'it''s; safe', E'escaped\\';value';
      /* outer ; /* nested ; */ */ DO $body$ BEGIN PERFORM ';'; END $body$;
      CREATE TABLE "semi;colon" (id int);`;
    expect(splitSqlStatements(sql)).toHaveLength(3);
  });
  it.each(["SELECT 'open", 'SELECT "open', "DO $$BEGIN;", "/* open"])(
    "rejects malformed SQL before executing any statement: %s", (sql) => {
      expect(() => splitSqlStatements(sql)).toThrow("Unterminated SQL");
    },
  );
});

async function sandbox(run: (url: string, pool: InstanceType<typeof Pool>, dir: string) => Promise<void>) {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/hasba_test_verify" ||
    process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Disposable database required");
  const schema = `migration_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url.toString() });
  const dir = mkdtempSync(join(tmpdir(), "hasba-migration-sql-"));
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: url.toString() });
  try { await run(url.toString(), pool, dir); }
  finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("migration file atomicity and retry", () => {
  it("does not lose earlier DDL or skip later statements after a duplicate", () => sandbox(async (url, pool, dir) => {
    writeFileSync(join(dir, "0000_test.sql"), `
      CREATE TABLE preserved(id int PRIMARY KEY);
      CREATE TABLE preserved(id int PRIMARY KEY);
      INSERT INTO preserved VALUES(1);
      CREATE TABLE after_duplicate(id int);
      DO $$ BEGIN INSERT INTO after_duplicate VALUES(2); END $$;`);
    const first = await runMigrations(url, () => {}, { migrationsDir: dir, bootstrapFile: null });
    expect(first.applied).toEqual(["0000_test.sql"]);
    expect((await pool.query("SELECT * FROM preserved")).rows).toEqual([{ id: 1 }]);
    expect((await pool.query("SELECT * FROM after_duplicate")).rows).toEqual([{ id: 2 }]);
    expect((await runMigrations(url, () => {}, { migrationsDir: dir, bootstrapFile: null })).skipped).toEqual(["0000_test.sql"]);
  }));
  it("rolls an entire failed file back and never records it as applied", () => sandbox(async (url, pool, dir) => {
    const file = join(dir, "0000_test.sql");
    writeFileSync(file, "CREATE TABLE must_rollback(id int); INSERT INTO absent_table VALUES(1);");
    await expect(runMigrations(url, () => {}, { migrationsDir: dir, bootstrapFile: null })).rejects.toThrow("Failed to apply migration");
    expect((await pool.query("SELECT to_regclass('must_rollback') AS name")).rows[0].name).toBeNull();
    expect((await pool.query("SELECT * FROM _drizzle_sql_migrations")).rows).toHaveLength(0);
    writeFileSync(file, "CREATE TABLE must_rollback(id int); INSERT INTO must_rollback VALUES(3);");
    await runMigrations(url, () => {}, { migrationsDir: dir, bootstrapFile: null });
    expect((await pool.query("SELECT * FROM must_rollback")).rows).toEqual([{ id: 3 }]);
  }));
});
