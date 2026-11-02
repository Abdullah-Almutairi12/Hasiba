import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pool } from "@workspace/db";

it("upgrades the previous global SKU constraint without changing product facts or foreign references", async () => {
  expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
  const client = await pool.connect();
  const schema = `sku_upgrade_${Date.now()}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query("CREATE TABLE products (LIKE public.products INCLUDING DEFAULTS INCLUDING CONSTRAINTS)");
    await client.query("ALTER TABLE products ADD PRIMARY KEY(id), ADD CONSTRAINT products_sku_unique UNIQUE(sku)");
    await client.query(`INSERT INTO products(id,name,name_ar,sku,category_id,company_id,price,cost_price,stock)
      VALUES(700001,'Pinned original','صنف سابق','0001',1,101,12.30,4.50,7.0000)`);
    await client.query("CREATE TABLE historical_reference(product_id integer REFERENCES products(id), original_value numeric(12,2))");
    await client.query("INSERT INTO historical_reference VALUES(700001,31.50)");
    const before = (await client.query("SELECT to_jsonb(p) value FROM products p")).rows;
    const refs = (await client.query("SELECT * FROM historical_reference")).rows;
    const migration = readFileSync(new URL("../../../../lib/db/drizzle/0072_company_product_sku.sql", import.meta.url), "utf8");
    await client.query(migration);
    await client.query(migration); // normal idempotence, not a down migration
    expect((await client.query("SELECT to_jsonb(p) value FROM products p")).rows).toEqual(before);
    expect((await client.query("SELECT * FROM historical_reference")).rows).toEqual(refs);
    await client.query(`INSERT INTO products(id,name,name_ar,sku,category_id,company_id,price,cost_price,stock)
      VALUES(700002,'Independent','شركة أخرى','0001',1,102,1,0,0)`);
    await client.query("SAVEPOINT duplicate_test");
    await expect(client.query(`INSERT INTO products(id,name,name_ar,sku,category_id,company_id,price,cost_price,stock)
      VALUES(700003,'Duplicate','مكرر','0001',1,101,1,0,0)`)).rejects.toMatchObject({ code: "23505", constraint: "products_company_sku_unique" });
    await client.query("ROLLBACK TO SAVEPOINT duplicate_test");
    expect((await client.query("SELECT * FROM historical_reference")).rows).toEqual(refs);
    expect((await client.query("SELECT sku FROM products ORDER BY id")).rows).toEqual([{ sku: "0001" }, { sku: "0001" }]);
    const live = await client.query(`SELECT conname FROM pg_constraint WHERE conrelid='public.products'::regclass AND contype='u'`);
    expect(live.rows.map(r => r.conname)).toContain("products_company_sku_unique");
    expect(live.rows.map(r => r.conname)).not.toContain("products_sku_unique");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
