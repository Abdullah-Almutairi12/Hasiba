import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pool } from "@workspace/db";

it("preserves supplier identity, blank historical facts, invoice references and balances across the actual VAT migration", async () => {
  expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
  const c = await pool.connect(), schema = `supplier_upgrade_${Date.now()}`;
  try {
    await c.query("BEGIN");
    await c.query(`CREATE SCHEMA "${schema}"`);
    await c.query(`SET LOCAL search_path TO "${schema}",public`);
    await c.query("CREATE TABLE suppliers (LIKE public.suppliers INCLUDING DEFAULTS INCLUDING CONSTRAINTS)");
    await c.query("ALTER TABLE suppliers ADD PRIMARY KEY(id), ADD CONSTRAINT suppliers_vat_number_unique UNIQUE(vat_number)");
    await c.query(`INSERT INTO suppliers(id,company_id,name,vat_number,balance) VALUES
      (800001,101,'مصدر سابق','003001',123.45),(800002,101,'بلا رقم',NULL,0),(800003,101,'فراغ تاريخي','',7.25)`);
    await c.query("CREATE TABLE historical_invoice(supplier_id int REFERENCES suppliers(id),amount numeric(12,2))");
    await c.query("INSERT INTO historical_invoice VALUES(800001,123.45),(800003,7.25)");
    const before = (await c.query("SELECT to_jsonb(s) value FROM suppliers s ORDER BY id")).rows;
    const refs = (await c.query("SELECT * FROM historical_invoice ORDER BY supplier_id")).rows;
    await c.query("SAVEPOINT before_duplicate");
    await expect(c.query("INSERT INTO suppliers(id,company_id,name,vat_number) VALUES(800004,102,'شركة أخرى','003001')"))
      .rejects.toMatchObject({ code: "23505", constraint: "suppliers_vat_number_unique" });
    await c.query("ROLLBACK TO SAVEPOINT before_duplicate");
    const migration = readFileSync(new URL("../../../../lib/db/drizzle/0073_company_supplier_vat.sql", import.meta.url), "utf8");
    await c.query(migration); await c.query(migration);
    expect((await c.query("SELECT to_jsonb(s) value FROM suppliers s ORDER BY id")).rows).toEqual(before);
    expect((await c.query("SELECT * FROM historical_invoice ORDER BY supplier_id")).rows).toEqual(refs);
    await c.query("INSERT INTO suppliers(id,company_id,name,vat_number) VALUES(800004,102,'شركة أخرى','003001')");
    await c.query("SAVEPOINT after_duplicate");
    await expect(c.query("INSERT INTO suppliers(id,company_id,name,vat_number) VALUES(800005,101,'مكرر','003001')"))
      .rejects.toMatchObject({ code: "23505", constraint: "suppliers_company_vat_number_unique" });
    await c.query("ROLLBACK TO SAVEPOINT after_duplicate");
    await c.query("INSERT INTO suppliers(id,company_id,name,vat_number) VALUES(800006,101,'مجهول آخر',NULL)");
    expect((await c.query("SELECT * FROM historical_invoice ORDER BY supplier_id")).rows).toEqual(refs);
    const live = (await c.query(`SELECT conname FROM pg_constraint WHERE conrelid='public.suppliers'::regclass AND contype='u'`)).rows;
    expect(live.map(r => r.conname)).toContain("suppliers_company_vat_number_unique");
    expect(live.map(r => r.conname)).not.toContain("suppliers_vat_number_unique");
  } finally { await c.query("ROLLBACK"); c.release(); }
});
