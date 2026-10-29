import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMigrations } from "../../../../lib/db/src/migrate";
import {
  db, pool, companiesTable, usersTable, userCompaniesTable, categoriesTable,
  productsTable, customersTable, branchesTable, warehousesTable, posSessionsTable,
  fiscalYearsTable, fiscalPeriodsTable, customerInvoicesTable, customerInvoiceLinesTable,
  approvalRulesTable, approvalStepsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordStockMove } from "../lib/stock-engine";
import { postJournalEntry } from "../lib/journal-posting";
import { actOnApproval } from "../lib/workflow-engine";

// Run only through test:isolated: all rows are synthetic in a disposable PG cluster.
// Never initialize today's application against the pre-upgrade fixture.
const application = process.env.HASBA_LEGACY_API_APP
  ? await import(process.env.HASBA_LEGACY_API_APP)
  : await import("../app");
const app = application.default;
beforeAll(application.assertApplicationReady);
let clientNumber = 0;
async function rows(sql: string, params: unknown[] = []) { return (await pool.query(sql, params)).rows; }
function ok(response: request.Response, status = 201) {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
}
async function fixture(method: "fifo" | "average" | "standard" = "fifo", layers = [[2, 10], [4, 20]]) {
  const tag = `return-cost-${randomUUID()}`;
  const [company] = await db.insert(companiesTable).values({ name: tag, vatRegistrationStatus: "not_registered" }).returning();
  const companyId = company.id;
  const year = new Date().getUTCFullYear();
  const [fy] = await db.insert(fiscalYearsTable).values({
    companyId, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`,
  }).returning();
  await db.insert(fiscalPeriodsTable).values({
    fiscalYearId: fy.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open",
  });
  const password = "Synthetic-return-only-123!";
  const [user] = await db.insert(usersTable).values({
    name: tag, email: `${tag}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "owner",
  }).returning();
  await db.insert(userCompaniesTable).values({ userId: user.id, companyId, role: "owner", isDefault: true });
  const [branch] = await db.insert(branchesTable).values({ companyId, name: tag, nameAr: tag, city: "Test" }).returning();
  const [warehouse] = await db.insert(warehousesTable).values({
    companyId, branchId: branch.id, name: tag, nameAr: tag, isDefault: true,
  }).returning();
  const [category] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  const [product] = await db.insert(productsTable).values({
    companyId, categoryId: category.id, name: tag, nameAr: tag, sku: tag,
    price: "100", costPrice: "10", stock: "0", costingMethod: method,
  }).returning();
  const [customer] = await db.insert(customersTable).values({ companyId, name: tag }).returning();
  // These are historical columns only. The upgrade fixture must not issue
  // latest-ORM DEFAULT/RETURNING columns before their migrations exist.
  const [session] = await rows(`INSERT INTO pos_sessions
    (session_number,cashier_name,branch_id,opening_cash,status)
    VALUES($1,$1,$2,'0','open') RETURNING id,session_number AS "sessionNumber"`,[tag,branch.id]);
  const legacyApp = process.env.HASBA_LEGACY_API_APP ? await import(process.env.HASBA_LEGACY_API_APP) : null;
  if (legacyApp) await legacyApp.assertApplicationReady();
  const agent = request.agent(legacyApp?.default ?? app);
  // Independent synthetic clients; preserve the real login limiter in tests.
  ok(await agent.post("/api/auth/login").set("X-Forwarded-For", `192.0.2.${++clientNumber}`)
    .send({ email: user.email, password }), 200);
  // Distinct inbound cost layers: 2×10 + 4×20 = SAR 100.
  await db.transaction(async (tx) => {
    for (const [quantity, unitCost] of layers) {
      await recordStockMove(tx, {
        companyId, productId: product.id, toWarehouseId: warehouse.id,
        kind: "receipt", quantity, unitCost, sourceRef: tag,
      });
    }
  });
  return { tag, companyId, userId: user.id, productId: product.id, warehouseId: warehouse.id, customerId: customer.id, sessionId: session.id, agent };
}
it("checks credit-note limits against normalized tax defaults before any financial effect", async () => {
  const f = await fixture();
  await rows("INSERT INTO financial_limits(company_id,role,action_key,max_value) VALUES($1,'sales','sales.credit_note_amount',100)", [f.companyId]);
  await rows("UPDATE user_companies SET role='sales' WHERE company_id=$1 AND user_id=$2", [f.companyId, f.userId]);
  const before = await rows(`SELECT
    (SELECT count(*) FROM credit_notes WHERE company_id=$1) AS notes,
    (SELECT count(*) FROM journal_entries WHERE company_id=$1) AS entries`, [f.companyId]);
  // The document schema defaults taxRate to 15. The old raw-body check saw
  // only 100 and let a 115-total request pass a company cap of 100.
  const response = await f.agent.post("/api/sales/credit-notes").send({
    customerId: f.customerId, restock: false,
    lines: [{ description: f.tag, quantity: 1, unitPrice: 100 }],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(403);
  expect(response.body.actionKey).toBe("sales.credit_note_amount");
  expect(await rows(`SELECT
    (SELECT count(*) FROM credit_notes WHERE company_id=$1) AS notes,
    (SELECT count(*) FROM journal_entries WHERE company_id=$1) AS entries`, [f.companyId])).toEqual(before);
});
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function sale(f: Fixture, items = [{ productId: f.productId, quantity: 4 }]) {
  const pos = ok(await f.agent.post("/api/pos/orders").send({
    sessionId: f.sessionId, customerId: f.customerId, items, paymentMethod: "cash", discount: 0,
  }));
  const [invoice] = await rows("SELECT * FROM customer_invoices WHERE company_id=$1 AND source_ref=$2", [f.companyId, pos.orderNumber]);
  const lines = await rows("SELECT * FROM customer_invoice_lines WHERE invoice_id=$1 ORDER BY id", [invoice.id]);
  return { invoice, lines };
}
function returnBody(f: Fixture, invoiceId: number, invoiceLineId: number, quantity: number, unitPrice = 100, restock = true) {
  return {
    invoiceId, customerId: f.customerId, warehouseId: f.warehouseId, restock,
    lines: [{ invoiceLineId, productId: f.productId, description: f.tag, quantity, unitPrice, taxRate: 0 }],
  };
}
async function reconcile(f: Fixture, expected: { inventory: number; cogs: number; profit: number }, fifo = true) {
  const balances = await rows(`SELECT a.system_key, sum(l.base_debit-l.base_credit)::float8 AS value
    FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id JOIN accounts a ON a.id=l.account_id
    WHERE j.company_id=$1 AND j.status='posted' GROUP BY a.system_key`, [f.companyId]);
  const balance = (key: string) => Number(balances.find((r) => r.system_key === key)?.value ?? 0);
  const [quant] = await rows("SELECT sum(quantity*avg_cost)::float8 AS value FROM stock_quants WHERE product_id=$1", [f.productId]);
  // A completed transfer has both legs on ONE movement, so its net company
  // value/quantity is zero, not another receipt.
  const [moves] = await rows(`SELECT sum(
    (CASE WHEN to_warehouse_id IS NOT NULL THEN quantity*unit_cost ELSE 0 END) -
    (CASE WHEN from_warehouse_id IS NOT NULL THEN quantity*unit_cost ELSE 0 END)
    )::float8 AS value FROM stock_moves WHERE product_id=$1 AND state='done'`, [f.productId]);
  expect(balance("inventory")).toBeCloseTo(expected.inventory, 2);
  expect(balance("cogs")).toBeCloseTo(expected.cogs, 2);
  expect(-balance("sales_revenue") - balance("sales_returns") - balance("sales_discount") - balance("cogs")).toBeCloseTo(expected.profit, 2);
  expect(Number(quant.value)).toBeCloseTo(expected.inventory, 2);
  expect(Number(moves.value)).toBeCloseTo(expected.inventory, 2);
  const [quantities] = await rows(`SELECT
    (SELECT coalesce(sum(quantity),0) FROM stock_quants WHERE product_id=$1)::float8 AS quant,
    (SELECT coalesce(sum(
      (CASE WHEN to_warehouse_id IS NOT NULL THEN quantity ELSE 0 END) -
      (CASE WHEN from_warehouse_id IS NOT NULL THEN quantity ELSE 0 END)),0)
      FROM stock_moves WHERE product_id=$1 AND state='done')::float8 AS moves,
    (SELECT stock FROM products WHERE id=$1)::float8 AS cached,
    (SELECT coalesce(sum(remaining_qty),0) FROM stock_layers WHERE product_id=$1)::float8 AS layers`,
  [f.productId]);
  expect(quantities.quant).toBeCloseTo(quantities.moves, 4);
  expect(quantities.cached).toBeCloseTo(quantities.quant, 4);
  if (fifo) expect(quantities.layers).toBeCloseTo(quantities.quant, 4);
  if (fifo) {
    const [layers] = await rows("SELECT sum(remaining_qty*unit_cost)::float8 AS value FROM stock_layers WHERE product_id=$1", [f.productId]);
    expect(Number(layers.value)).toBeCloseTo(expected.inventory, 2);
  }
}

describe("original POS invoice: independent linked return lifecycle", () => {
  it.skipIf(!process.env.HASBA_MIGRATION_REFERENCE)("upgrade preserves a pinned previous installation and its financial relationships", async () => {
    const f = await fixture();
    const sold = await sale(f);
    ok(await f.agent.post("/api/sales/credit-notes").set("Idempotency-Key", `${f.tag}-upgrade-credit`)
      .send(returnBody(f, sold.invoice.id, sold.lines[0].id, 1)));
    const snapshots = async () => {
      const result: Record<string, unknown> = {};
      for (const table of ["companies", "branches", "warehouses", "products", "customers",
        "customer_invoices", "customer_receipts", "credit_notes", "journal_entries",
        "stock_moves", "stock_quants", "stock_layers"]) {
        const stock = ["stock_moves", "stock_quants", "stock_layers"].includes(table);
        const receipt = table === "customer_receipts";
        const column = stock ? "product_id" : receipt ? "customer_id" : table === "companies" ? "id" : "company_id";
        result[table] = await rows(`SELECT * FROM ${table} WHERE ${column}=$1 ORDER BY id`,
          [stock ? f.productId : receipt ? f.customerId : f.companyId]);
      }
      result.lines = await rows(`SELECT l.* FROM journal_entry_lines l
        JOIN journal_entries j ON j.id=l.entry_id WHERE j.company_id=$1 ORDER BY l.id`, [f.companyId]);
      result.invoiceLines = await rows("SELECT * FROM customer_invoice_lines WHERE invoice_id=$1 ORDER BY id", [sold.invoice.id]);
      return result;
    };
    const before = await snapshots();
    const expectedAfter={...before,companies:(before.companies as Record<string,unknown>[]).map(c=>({...c,account_mfa_required:false}))};
    await rows(`INSERT INTO financial_limits(role,action_key,max_value,description)
      VALUES('hr','sales.refund_amount',333,'Synthetic pre-upgrade policy evidence') ON CONFLICT DO NOTHING RETURNING id`);
    const oldLimits = await rows("SELECT id,role,action_key,max_value,description,updated_at FROM financial_limits ORDER BY id");
    // Seed this observation through the actual previous installation's SQL
    // shape, before the new revision column exists. Financial/quantity values
    // must survive the additive migration, with a usable initial revision.
    const [oldTake]=await rows("INSERT INTO stock_takes(reference,warehouse_id) VALUES($1,$2) RETURNING id",
      [`${f.tag}-old-count`,f.warehouseId]);
    const [oldCount]=await rows(`INSERT INTO stock_take_lines(stock_take_id,product_id,expected_qty,counted_qty,unit_cost)
      VALUES($1,$2,9.5000,8.2500,10.0000) RETURNING id,expected_qty::text,counted_qty::text,unit_cost::text`,
      [oldTake.id,f.productId]);
    const first = await runMigrations(process.env.TEST_DATABASE_URL!, () => {});
    expect(first.applied).toEqual([
      "0026_pos_return_settlement.sql",
      "0027_document_print_identity.sql",
      "0028_seller_attribution.sql",
      "0029_approval_tenant_ownership.sql",
      "0030_financial_limit_company.sql",
      "0031_automation_notification_company.sql",
      "0032_approval_policy_snapshot.sql",
      "0033_approval_source_facts.sql",
      "0034_approval_decision_identity.sql",
      "0035_approval_live_authority.sql",
      "0036_scoped_approval_delegation.sql",
      "0037_team_scoped_access.sql",
      "0038_legacy_team_conversion.sql",
      "0039_pos_independent_return_receipt.sql",
      "0040_owner_cash_responsibility.sql",
      "0041_stocktake_count_revision.sql",
      "0042_company_administration.sql",
      "0043_primary_system_owner.sql",
      "0044_membership_departure.sql",
      "0045_permission_templates.sql",
      "0046_pos_device_identity.sql",
      "0047_pos_station_evidence.sql",
      "0048_pos_cashier_evidence.sql",
      "0049_discard_legacy_unlock_challenges.sql",
      "0050_cash_closing_review_evidence.sql",
      "0051_account_security.sql",
      "0052_account_recovery_delivery.sql",
      "0053_procurement_responsibilities.sql",
      "0054_procurement_self_receiving.sql",
      "0055_supplier_invoice_evidence.sql",
      "0056_supplier_invoice_lifecycle.sql",
      "0057_supplier_invoice_receipt_allocations.sql",
      "0058_supplier_invoice_currency_fence.sql",
      "0059_supplier_invoice_identity_scope.sql",
      "0060_scoped_app_settings.sql",
      "0061_stocktake_observation_cutoff.sql",
      "0062_stocktake_count_participants.sql",
      "0063_stocktake_variance_review.sql",
      "0064_customer_invoice_permissions.sql",
      "0065_invoice_editor.sql",
      "0066_sale_document_audit.sql",
    ]);
    expect(first.skipped).toHaveLength(26);
    // The editor migration is prospective: an old install must not acquire
    // a published design or have issued-document evidence rewritten.
    expect(await rows("SELECT count(*)::int AS n FROM invoice_editor_releases")).toEqual([{n:0}]);
    expect(await rows("SELECT count(*)::int AS n FROM invoice_editor_activation")).toEqual([{n:0}]);
    // Admission of a resource is not a backfill of authority. The pinned
    // installation must gain no customer-invoice grant or template.
    expect(await rows("SELECT count(*)::int AS n FROM responsibility_grants WHERE resource='sales'")).toEqual([{n:0}]);
    expect(await rows("SELECT count(*)::int AS n FROM team_permission_templates WHERE resource='sales'")).toEqual([{n:0}]);
    // Upgrade is additive: a legacy company neither opts into self receiving
    // nor gains its independent permission merely by installing the new code.
    expect(await (await import("../lib/procurement-receiving-policy")).receivingPolicy(f.companyId))
      .toEqual({allowCreator:false,revision:0});
    expect(await rows("SELECT count(*)::int AS n FROM responsibility_grants WHERE 'procurement.receipts.receive_self'=ANY(actions)"))
      .toEqual([{n:0}]);
    expect(await snapshots()).toEqual(expectedAfter);
    expect(await rows("SELECT id,expected_qty::text,counted_qty::text,unit_cost::text FROM stock_take_lines WHERE id=$1",[oldCount.id]))
      .toEqual([oldCount]);
    expect(await rows("SELECT count_revision::text FROM stock_take_lines WHERE id=$1",[oldCount.id])).toEqual([{count_revision:"0"}]);
    expect(await rows("SELECT variance_review FROM stock_takes WHERE id=$1",[oldTake.id])).toEqual([{variance_review:null}]);
    expect(await rows("SELECT count(*)::int n FROM team_access_policy WHERE stocktake_policy->>'allowParticipant'='true'")).toEqual([{n:0}]);
    expect(await rows("SELECT count(*)::int n FROM responsibility_grants WHERE 'inventory.stocktake.approve_self'=ANY(actions)")).toEqual([{n:0}]);
    expect(await rows("SELECT count_checkpoint FROM stock_take_lines WHERE id=$1",[oldCount.id])).toEqual([{count_checkpoint:null}]);
    expect(await rows("SELECT closure_result FROM stock_takes WHERE id=$1",[oldTake.id])).toEqual([{closure_result:null}]);
    expect(await rows("SELECT user_id FROM stocktake_count_participants WHERE take_id=$1",[oldTake.id])).toEqual([]);
    expect(await rows("SELECT count_participation_incomplete FROM stock_takes WHERE id=$1",[oldTake.id]))
      .toEqual([{count_participation_incomplete:true}]);
    expect(await rows("SELECT count(*)::int AS n FROM stocktake_product_fences")).toEqual([{n:0}]);
    expect(await rows("SELECT id,role,action_key,max_value,description,updated_at FROM financial_limits ORDER BY id")).toEqual(oldLimits);
    expect(await rows("SELECT count(*)::int AS n FROM financial_limits WHERE company_id IS NOT NULL")).toEqual([{ n: 0 }]);
    expect(await rows("SELECT count(*)::int AS n FROM document_issuer_snapshots WHERE company_id=$1", [f.companyId])).toEqual([{ n: 0 }]);
    expect(await rows("SELECT count(*)::int AS n FROM invoice_seller_lines WHERE company_id=$1", [f.companyId])).toEqual([{ n: 0 }]);
    // Installing the bridge must not silently convert old memberships.
    expect(await rows("SELECT count(*)::int AS n FROM legacy_team_conversions")).toEqual([{ n: 0 }]);
    expect(await rows("SELECT count(*)::int AS n FROM pos_devices")).toEqual([{ n: 0 }]);
    expect(await rows("SELECT count(*)::int AS n FROM pos_employee_credentials")).toEqual([{ n: 0 }]);
    expect(await rows(`SELECT column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='return_controls' AND column_name='receipt_required'`))
      .toEqual([{ column_default: "false" }]);
    expect(await rows(`SELECT count(*)::int AS n FROM return_controls
      WHERE receipt_required OR received_by IS NOT NULL OR received_at IS NOT NULL OR receipt_reference IS NOT NULL`))
      .toEqual([{ n: 0 }]);
    const second = await runMigrations(process.env.TEST_DATABASE_URL!, () => {});
    expect(second.applied).toHaveLength(0);
    expect(await snapshots()).toEqual(expectedAfter);
    const unbalanced = await rows(`SELECT j.id FROM journal_entries j
      JOIN journal_entry_lines l ON l.entry_id=j.id WHERE j.company_id=$1
      GROUP BY j.id HAVING sum(l.base_debit)<>sum(l.base_credit)`, [f.companyId]);
    expect(unbalanced).toHaveLength(0);
    const out = resolve(process.cwd(), "../../generated-artifacts/return-settlement");
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, "legacy-upgrade.json"), JSON.stringify({
      reference: process.env.HASBA_MIGRATION_REFERENCE,
      fixture: "Pinned old application, initializers, workspace schema and migrator; synthetic data",
      unchangedTables: Object.keys(before), passes: 2, applied: first.applied, skipped: first.skipped,
      journalsBalanced: true,
      limitation: "Representative financial relationships, not a backup or proof for all older installations",
    }, null, 2));
  });
  it("returns part then the remainder exactly once, leaving cash as explicit customer credit", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    const snapshot = async () => (await rows(`SELECT
      (SELECT count(*) FROM credit_notes WHERE company_id=$1) AS credits,
      (SELECT count(*) FROM journal_entries WHERE company_id=$1) AS journals,
      (SELECT count(*) FROM stock_moves WHERE product_id=$2) AS moves,
      (SELECT sum(quantity) FROM stock_quants WHERE product_id=$2) AS quantity,
      (SELECT sum(r.amount) FROM customer_receipts r JOIN customers c ON c.id=r.customer_id WHERE c.company_id=$1) AS collected`, [f.companyId, f.productId]))[0];
    const initial = await snapshot();
    const partialBody = returnBody(f, invoice.id, lines[0].id, 1);
    const partialKey = `${f.tag}-partial`;
    const partial = ok(await f.agent.post("/api/sales/credit-notes").set("Idempotency-Key", partialKey).send(partialBody));
    const afterPartial = await snapshot();
    expect(Number(afterPartial.quantity)).toBe(3);
    expect(afterPartial.collected).toBe(initial.collected);
    expect(ok(await f.agent.post("/api/sales/credit-notes").set("Idempotency-Key", partialKey).send(partialBody)).id).toBe(partial.id);
    expect(await snapshot()).toEqual(afterPartial);
    const finalBody = returnBody(f, invoice.id, lines[0].id, 3);
    const finalKey = `${f.tag}-remainder`;
    const finalCredit = ok(await f.agent.post("/api/sales/credit-notes").set("Idempotency-Key", finalKey).send(finalBody));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
    const afterFull = await snapshot();
    expect(Number(afterFull.quantity)).toBe(6);
    expect(Number(afterFull.credits) - Number(initial.credits)).toBe(2);
    expect(afterFull.collected).toBe(initial.collected);
    expect(ok(await f.agent.post("/api/sales/credit-notes").set("Idempotency-Key", finalKey).send(finalBody)).id).toBe(finalCredit.id);
    const excess = await f.agent.post("/api/sales/credit-notes")
      .set("Idempotency-Key", `${f.tag}-excess`).send(partialBody);
    expect(excess.status, JSON.stringify(excess.body)).toBeGreaterThanOrEqual(400);
    expect(excess.status).toBeLessThan(500);
    expect(await snapshot()).toEqual(afterFull);
    const ledger = await rows(`SELECT a.system_key, sum(l.base_debit-l.base_credit)::float8 AS amount
      FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id JOIN accounts a ON a.id=l.account_id
      WHERE j.company_id=$1 AND j.status='posted' GROUP BY a.system_key`, [f.companyId]);
    const balance = (key: string) => Number(ledger.find((line) => line.system_key === key)?.amount ?? 0);
    // A credit note is NOT a cash refund. No fabricated cash-out journal.
    expect(balance("cash")).toBe(400);
    expect(balance("ar")).toBe(-400);
    const unbalanced = await rows(`SELECT j.id FROM journal_entries j
      JOIN journal_entry_lines l ON l.entry_id=j.id WHERE j.company_id=$1
      GROUP BY j.id HAVING sum(l.base_debit)<>sum(l.base_credit)`, [f.companyId]);
    expect(unbalanced).toHaveLength(0);
  });
  it("rejects foreign invoice, customer, warehouse, and product references without effects", async () => {
    const own = await fixture();
    const foreign = await fixture();
    const a = await sale(own);
    const b = await sale(foreign);
    const snapshot = async () => rows(`SELECT
      (SELECT count(*) FROM credit_notes WHERE company_id=ANY($1::int[])) AS credits,
      (SELECT count(*) FROM journal_entries WHERE company_id=ANY($1::int[])) AS journals,
      (SELECT count(*) FROM stock_moves WHERE product_id=ANY($2::int[])) AS moves,
      (SELECT sum(quantity) FROM stock_quants WHERE product_id=ANY($2::int[])) AS quantity`,
    [[own.companyId, foreign.companyId], [own.productId, foreign.productId]]);
    const before = await snapshot();
    const base = returnBody(own, a.invoice.id, a.lines[0].id, 1);
    for (const body of [
      { ...base, invoiceId: b.invoice.id },
      { ...base, customerId: foreign.customerId },
      { ...base, warehouseId: foreign.warehouseId },
      { ...base, lines: [{ ...base.lines[0], productId: foreign.productId }] },
    ]) {
      const result = await own.agent.post("/api/sales/credit-notes").send(body);
      expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(400);
      expect(result.status, JSON.stringify({ body, error: result.body })).toBeLessThan(500);
      expect(await snapshot()).toEqual(before);
    }
  });
});

describe("original sales cost, inventory carrying value and profit", () => {
  it("preserves large fractional FIFO return value through transfer receipt and destination resale", async () => {
    const quantity = 2_000_000;
    const value = 20_000_100;
    const f = await fixture("fifo", [[quantity / 2, 10], [quantity / 2, 10.0001]]);
    await db.update(productsTable).set({ price: "20" }).where(eq(productsTable.id, f.productId));
    const sold = await sale(f, [{ productId: f.productId, quantity }]);
    await reconcile(f, { inventory: 0, cogs: value, profit: 40_000_000 - value });
    const credit = ok(await f.agent.post("/api/sales/credit-notes")
      .send(returnBody(f, sold.invoice.id, sold.lines[0].id, quantity, 20)));
    await reconcile(f, { inventory: value, cogs: 0, profit: 0 });
    const returnMoves = await rows(
      "SELECT * FROM stock_moves WHERE source_type='credit_note' AND source_id=$1 ORDER BY id", [credit.id]);
    expect(returnMoves).toHaveLength(1);

    // Separate branch/session makes the real POS route issue from the destination.
    const [branch] = await db.insert(branchesTable).values({
      companyId: f.companyId, name: `${f.tag}-destination`, nameAr: f.tag, city: "Test",
    }).returning();
    const [destination] = await db.insert(warehousesTable).values({
      companyId: f.companyId, branchId: branch.id, name: f.tag, nameAr: f.tag, isDefault: true,
    }).returning();
    const [session] = await db.insert(posSessionsTable).values({
      sessionNumber: `${f.tag}-destination`, cashierName: f.tag, branchId: branch.id, openingCash: "0", status: "open",
    }).returning();
    // Today's product price must not replace the evidenced returned carrying cost.
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));

    async function ledger() {
      return rows(`SELECT j.id, j.status, l.id AS line_id, l.account_id, l.base_debit, l.base_credit
        FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id
        WHERE j.company_id=$1 ORDER BY j.id,l.id`, [f.companyId]);
    }
    async function warehouseState(warehouseId: number, expectedQty: number, expectedValue: number) {
      // Compare as PostgreSQL numerics: a float cast or a rounded cents-only
      // assertion could hide the exact storage regression being tested.
      const [state] = await rows(`SELECT
        (SELECT coalesce(sum(quantity),0)=$3::numeric FROM stock_quants
          WHERE product_id=$1 AND warehouse_id=$2) AS quant_qty,
        (SELECT coalesce(sum(quantity*avg_cost),0)=$4::numeric FROM stock_quants
          WHERE product_id=$1 AND warehouse_id=$2) AS quant_value,
        (SELECT coalesce(sum(remaining_qty),0)=$3::numeric FROM stock_layers
          WHERE product_id=$1 AND warehouse_id=$2) AS layer_qty,
        (SELECT coalesce(sum(remaining_qty*unit_cost),0)=$4::numeric FROM stock_layers
          WHERE product_id=$1 AND warehouse_id=$2) AS layer_value,
        NOT EXISTS(SELECT 1 FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2
          AND quantity>0 AND avg_cost<>10.00005) AS quant_cost,
        NOT EXISTS(SELECT 1 FROM stock_layers WHERE product_id=$1 AND warehouse_id=$2
          AND remaining_qty>0 AND unit_cost<>10.00005) AS layer_cost,
        (SELECT coalesce(sum(
          CASE WHEN to_warehouse_id=$2 AND state='done' THEN quantity*unit_cost ELSE 0 END -
          CASE WHEN from_warehouse_id=$2 AND state IN ('done','in_transit') THEN quantity*unit_cost ELSE 0 END
        ),0)=$4::numeric FROM stock_moves WHERE product_id=$1) AS movement_value`,
      [f.productId, warehouseId, expectedQty, expectedValue]);
      expect(state).toEqual({
        quant_qty: true, quant_value: true, layer_qty: true, layer_value: true,
        quant_cost: true, layer_cost: true, movement_value: true,
      });
    }
    await warehouseState(f.warehouseId, quantity, value);
    const beforeTransfer = await ledger();
    const transfer = ok(await f.agent.post("/api/inventory/transfers").send({
      productId: f.productId, quantity, fromWarehouseId: f.warehouseId, toWarehouseId: destination.id,
    }));
    expect(transfer.unitCost).toBe(10.00005);
    const [dispatched] = await rows(`SELECT state, quantity=$2::numeric AS quantity_ok,
      unit_cost=10.00005 AS cost_ok, quantity*unit_cost=$3::numeric AS value_ok
      FROM stock_moves WHERE id=$1`, [transfer.moveId, quantity, value]);
    expect(dispatched).toEqual({ state: "in_transit", quantity_ok: true, cost_ok: true, value_ok: true });
    await warehouseState(f.warehouseId, 0, 0);
    await warehouseState(destination.id, 0, 0);
    expect((await rows("SELECT stock::float8 AS qty FROM products WHERE id=$1", [f.productId]))[0].qty).toBe(0);
    // The whole GL inventory value is in transit, not lost or posted to COGS.
    expect(await ledger()).toEqual(beforeTransfer);

    ok(await f.agent.post(`/api/inventory/transfers/${transfer.moveId}/receive`).send({}), 200);
    await warehouseState(f.warehouseId, 0, 0);
    await warehouseState(destination.id, quantity, value);
    const [received] = await rows(`SELECT state, unit_cost=10.00005 AS cost_ok
      FROM stock_moves WHERE id=$1`, [transfer.moveId]);
    expect(received).toEqual({ state: "done", cost_ok: true });
    const [layer] = await rows(`SELECT receipt_move_id, unit_cost=10.00005 AS cost_ok
      FROM stock_layers WHERE product_id=$1 AND warehouse_id=$2`, [f.productId, destination.id]);
    expect(layer).toEqual({ receipt_move_id: transfer.moveId, cost_ok: true });
    expect(await ledger()).toEqual(beforeTransfer);
    await reconcile(f, { inventory: value, cogs: 0, profit: 0 });
    expect((await f.agent.post(`/api/inventory/transfers/${transfer.moveId}/receive`).send({})).status).toBe(400);
    expect(await rows("SELECT id FROM stock_moves WHERE product_id=$1 AND kind='transfer'", [f.productId]))
      .toEqual([{ id: transfer.moveId }]);
    expect(await rows("SELECT id FROM stock_layers WHERE receipt_move_id=$1", [transfer.moveId])).toHaveLength(1);
    await warehouseState(destination.id, quantity, value);

    const resale = await sale({ ...f, sessionId: session.id }, [{ productId: f.productId, quantity: quantity / 2 }]);
    const [issue] = await rows(`SELECT from_warehouse_id, quantity=1000000 AS quantity_ok,
      unit_cost=10.00005 AS cost_ok, quantity*unit_cost=10000050 AS value_ok
      FROM stock_moves WHERE kind='issue' AND invoice_line_id=$1`, [resale.lines[0].id]);
    expect(issue).toEqual({ from_warehouse_id: destination.id, quantity_ok: true, cost_ok: true, value_ok: true });
    await warehouseState(f.warehouseId, 0, 0);
    await warehouseState(destination.id, quantity / 2, value / 2);
    await reconcile(f, { inventory: value / 2, cogs: value / 2, profit: 9_999_950 });
    expect(await rows("SELECT * FROM stock_moves WHERE source_type='credit_note' AND source_id=$1 ORDER BY id", [credit.id]))
      .toEqual(returnMoves);
  });

  it("mixes a high-precision FIFO return with older destination layers without changing transfer profit", async () => {
    const quantity = 2_000_000;
    const returnValue = 20_000_100; // 2m × 10.00005, not a four-decimal cost.
    const f = await fixture("fifo", [[quantity / 2, 10], [quantity / 2, 10.0001]]);
    await db.update(productsTable).set({ price: "20" }).where(eq(productsTable.id, f.productId));
    const [branch] = await db.insert(branchesTable).values({
      companyId: f.companyId, name: `${f.tag}-mixed`, nameAr: f.tag, city: "Test",
    }).returning();
    const [destination] = await db.insert(warehousesTable).values({
      companyId: f.companyId, branchId: branch.id, name: f.tag, nameAr: f.tag, isDefault: true,
    }).returning();
    const [session] = await db.insert(posSessionsTable).values({
      sessionNumber: `${f.tag}-mixed`, cashierName: f.tag, branchId: branch.id, openingCash: "0", status: "open",
    }).returning();
    const older = await db.transaction(async (tx) => {
      const receipts = [];
      for (const unitCost of [6, 9]) {
        receipts.push(await recordStockMove(tx, {
          companyId: f.companyId, productId: f.productId, toWarehouseId: destination.id,
          kind: "receipt", quantity: 1_000_000, unitCost, sourceRef: f.tag,
        }));
      }
      return receipts;
    });
    await reconcile(f, { inventory: returnValue + 15_000_000, cogs: 0, profit: 0 });
    const sold = await sale(f, [{ productId: f.productId, quantity }]);
    await reconcile(f, { inventory: 15_000_000, cogs: returnValue, profit: 19_999_900 });
    const credit = ok(await f.agent.post("/api/sales/credit-notes")
      .send(returnBody(f, sold.invoice.id, sold.lines[0].id, quantity, 20)));
    const returnMoves = await rows(
      "SELECT * FROM stock_moves WHERE source_type='credit_note' AND source_id=$1 ORDER BY id", [credit.id]);
    expect(returnMoves).toHaveLength(1);
    await reconcile(f, { inventory: 35_000_100, cogs: 0, profit: 0 });
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));

    async function warehouseState(warehouseId: number, qty: number, avgCost: number, value: number, tolerance = 0) {
      // Compare PostgreSQL numerics, allowing only the explicitly supplied
      // sub-micro-riyal binary arithmetic residue, never a cents-only check.
      const [state] = await rows(`SELECT
        (SELECT count(*)=1 AND bool_and(quantity=$3::numeric AND
          abs(avg_cost-$4::numeric)*greatest(quantity,1)<=$6::numeric)
          FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2) AS quant,
        (SELECT abs(sum(quantity*avg_cost)-$5::numeric)<=$6::numeric FROM stock_quants
          WHERE product_id=$1 AND warehouse_id=$2) AS quant_value,
        (SELECT coalesce(sum(remaining_qty),0)=$3::numeric AND
          coalesce(sum(remaining_qty*unit_cost),0)=$5::numeric FROM stock_layers
          WHERE product_id=$1 AND warehouse_id=$2) AS layers,
        (SELECT coalesce(sum(
          CASE WHEN to_warehouse_id=$2 AND state='done' THEN quantity*unit_cost ELSE 0 END -
          CASE WHEN from_warehouse_id=$2 AND state IN ('done','in_transit') THEN quantity*unit_cost ELSE 0 END
        ),0)=$5::numeric FROM stock_moves WHERE product_id=$1) AS moves`,
      [f.productId, warehouseId, qty, avgCost, value, tolerance]);
      expect(state).toEqual({ quant: true, quant_value: true, layers: true, moves: true });
    }
    // Only scoped aggregates, not a replay or snapshot of the full journal history.
    async function financialState() {
      return rows(`SELECT a.system_key, count(DISTINCT j.id)::int AS entries,
        count(*)::int AS lines, sum(l.base_debit)::text AS debits, sum(l.base_credit)::text AS credits
        FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id
        JOIN accounts a ON a.id=l.account_id WHERE j.company_id=$1 AND j.status='posted'
        GROUP BY a.system_key ORDER BY a.system_key`, [f.companyId]);
    }
    await warehouseState(f.warehouseId, quantity, 10.00005, returnValue);
    await warehouseState(destination.id, quantity, 7.5, 15_000_000);
    const beforeTransfer = await financialState();
    const transfer = ok(await f.agent.post("/api/inventory/transfers").send({
      productId: f.productId, quantity, fromWarehouseId: f.warehouseId, toWarehouseId: destination.id,
    }));
    expect(transfer.unitCost).toBe(10.00005);
    const [dispatched] = await rows(`SELECT state, quantity=$2::numeric AS qty,
      unit_cost=10.00005 AS cost, quantity*unit_cost=$3::numeric AS value
      FROM stock_moves WHERE id=$1`, [transfer.moveId, quantity, returnValue]);
    expect(dispatched).toEqual({ state: "in_transit", qty: true, cost: true, value: true });
    await warehouseState(f.warehouseId, 0, 0, 0);
    await warehouseState(destination.id, quantity, 7.5, 15_000_000);
    expect((await rows("SELECT stock=2000000 AS qty FROM products WHERE id=$1", [f.productId]))[0].qty).toBe(true);
    // In transit the missing on-hand value remains GL inventory, not COGS.
    expect(await financialState()).toEqual(beforeTransfer);

    ok(await f.agent.post(`/api/inventory/transfers/${transfer.moveId}/receive`).send({}), 200);
    const [received] = await rows(`SELECT state, unit_cost=10.00005 AS cost
      FROM stock_moves WHERE id=$1`, [transfer.moveId]);
    expect(received).toEqual({ state: "done", cost: true });
    await warehouseState(f.warehouseId, 0, 0, 0);
    // (1m×6 + 1m×9 + 2m×10.00005) / 4m, not the incoming cost or today's price.
    await warehouseState(destination.id, 4_000_000, 8.750025, 35_000_100);
    expect(await financialState()).toEqual(beforeTransfer);
    await reconcile(f, { inventory: 35_000_100, cogs: 0, profit: 0 });

    async function destinationLayers(firstQty: number, secondQty: number, returnedQty: number) {
      const layers = await rows(`SELECT receipt_move_id,
        remaining_qty=CASE receipt_move_id WHEN $3 THEN $6::numeric WHEN $4 THEN $7::numeric
          WHEN $5 THEN $8::numeric END AS qty,
        unit_cost=CASE receipt_move_id WHEN $3 THEN 6 WHEN $4 THEN 9 WHEN $5 THEN 10.00005 END AS cost
        FROM stock_layers WHERE product_id=$1 AND warehouse_id=$2 ORDER BY created_at,id`,
      [f.productId, destination.id, older[0].moveId, older[1].moveId, transfer.moveId,
        firstQty, secondQty, returnedQty]);
      expect(layers).toEqual([older[0].moveId, older[1].moveId, transfer.moveId]
        .map((receipt_move_id) => ({ receipt_move_id, qty: true, cost: true })));
    }
    await destinationLayers(1_000_000, 1_000_000, quantity);
    const destinationFixture = { ...f, sessionId: session.id };
    // First sale exhausts the oldest layer and only half of the second.
    // The transferred return layer must be entirely untouched.
    const firstResale = await sale(destinationFixture, [{ productId: f.productId, quantity: 1_500_000 }]);
    const [firstIssue] = await rows(`SELECT from_warehouse_id, quantity=1500000 AS qty,
      unit_cost=7 AS cost, quantity*unit_cost=10500000 AS value
      FROM stock_moves WHERE kind='issue' AND invoice_line_id=$1`, [firstResale.lines[0].id]);
    expect(firstIssue).toEqual({ from_warehouse_id: destination.id, qty: true, cost: true, value: true });
    await destinationLayers(0, 500_000, quantity);
    await warehouseState(destination.id, 2_500_000, 9.80004, 24_500_100);
    await reconcile(f, { inventory: 24_500_100, cogs: 10_500_000, profit: 19_500_000 });

    // Then cross from the final old 500k×9 into 500k×10.00005 of the return.
    const secondResale = await sale(destinationFixture, [{ productId: f.productId, quantity: 1_000_000 }]);
    const [secondIssue] = await rows(`SELECT from_warehouse_id, quantity=1000000 AS qty,
      unit_cost=9.500025 AS cost, quantity*unit_cost=9500025 AS value
      FROM stock_moves WHERE kind='issue' AND invoice_line_id=$1`, [secondResale.lines[0].id]);
    expect(secondIssue).toEqual({ from_warehouse_id: destination.id, qty: true, cost: true, value: true });
    await destinationLayers(0, 0, 1_500_000);
    await warehouseState(f.warehouseId, 0, 0, 0);
    // applyQuantDelta uses JS arithmetic: the final subtraction can leave
    // nanoriyals in the quant, while movement/layer values above remain exact.
    await warehouseState(destination.id, 1_500_000, 10.00005, 15_000_075, 0.000001);
    await reconcile(f, { inventory: 15_000_075, cogs: 20_000_025, profit: 29_999_975 });
    expect(await rows("SELECT * FROM stock_moves WHERE source_type='credit_note' AND source_id=$1 ORDER BY id", [credit.id]))
      .toEqual(returnMoves);
  });

  it.each([
    ["SAR", false, null], ["USD", false, null], ["SAR", true, null], ["USD", true, null],
    ["SAR", false, 1], ["USD", false, 1], ["SAR", false, 0], ["USD", false, 0],
  ] as const)("reconciles large fractional FIFO costs in %s (full: %s, cancelled slice: %s)", async (currencyCode, full, cancelIndex) => {
    // Halfway between four-decimal costs. The old movement/quant storage
    // loses SAR 100 on two million units even though the issue GL is right.
    const quantity = 2_000_000;
    const unitCost = 10.00005;
    const initialValue = 20_000_100;
    const rate = currencyCode === "USD" ? 3.75 : 1;
    const price = 20;
    const f = await fixture("fifo", [[quantity / 2, 10], [quantity / 2, 10.0001]]);
    await db.update(productsTable).set({ price: String(price) }).where(eq(productsTable.id, f.productId));
    await reconcile(f, { inventory: initialValue, cogs: 0, profit: 0 });
    const { invoice, line } = currencyCode === "SAR"
      ? await (async () => {
        const sold = await sale(f, [{ productId: f.productId, quantity }]);
        return { invoice: sold.invoice, line: sold.lines[0] };
      })()
      : await db.transaction(async (tx) => {
        const [invoice] = await tx.insert(customerInvoicesTable).values({
          companyId: f.companyId, reference: `${f.tag}-USD`, customerId: f.customerId, customerName: f.tag,
          invoiceDate: new Date().toISOString().slice(0, 10), currencyCode,
          subtotal: String(quantity * price), total: String(quantity * price), vat: "0", status: "open",
        }).returning();
        const [line] = await tx.insert(customerInvoiceLinesTable).values({
          invoiceId: invoice.id, productId: f.productId, description: f.tag,
          quantity: String(quantity), unitPrice: String(price), taxRate: "0", lineTotal: String(quantity * price),
        }).returning();
        const issued = await recordStockMove(tx, {
          companyId: f.companyId, productId: f.productId, quantity, kind: "issue",
          fromWarehouseId: f.warehouseId, invoiceLineId: line.id, sourceRef: invoice.reference,
        });
        expect(issued.unitCost).toBeCloseTo(unitCost, 10);
        await postJournalEntry(tx, {
          companyId: f.companyId, entryDate: new Date(), description: f.tag, reference: invoice.reference,
          currencyCode, exchangeRate: rate,
        }, [{ systemKey: "ar", debit: quantity * price }, { systemKey: "sales_revenue", credit: quantity * price }]);
        return { invoice, line };
      });
    const [issue] = await rows("SELECT unit_cost FROM stock_moves WHERE invoice_line_id=$1 AND kind='issue'", [line.id]);
    expect(Number(issue.unit_cost)).toBeCloseTo(unitCost, 10);
    await reconcile(f, { inventory: 0, cogs: initialValue, profit: quantity * price * rate - initialValue });
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    if (currencyCode === "USD") await pool.query(`INSERT INTO exchange_rates(from_currency,to_currency,rate,rate_date)
      VALUES ('USD','SAR',4.2,current_date)
      ON CONFLICT (from_currency,to_currency,rate_date) DO UPDATE SET rate=4.2`);
    let returned = 0;
    const credits: number[] = [];
    // Three equal partial slices deliberately round up independently.
    let previouslyRestored = 0;
    const parts = full ? [quantity] : [333_333, 333_333, 333_333, 1_000_001];
    if (cancelIndex !== null) parts.push(333_333);
    for (const [index, part] of parts.entries()) {
      const body = returnBody(f, invoice.id, line.id, part, price);
      const credit = ok(await f.agent.post("/api/sales/credit-notes")
        .set("Idempotency-Key", `${f.tag}-${index}`).send(body));
      credits.push(credit.id);
      returned += part;
      const restored = Math.round(returned * unitCost * 100) / 100;
      await reconcile(f, {
        inventory: restored, cogs: initialValue - restored,
        profit: (quantity - returned) * price * rate - (initialValue - restored),
      });
      const [costLine] = await rows(`SELECT l.base_debit::float8 AS value
        FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
        WHERE l.entry_id=$1 AND a.system_key='inventory'`, [credit.journalEntryId]);
      expect(costLine.value).toBeCloseTo(restored - previouslyRestored, 6);
      previouslyRestored = restored;
      const [journal] = await rows("SELECT currency_code,exchange_rate FROM journal_entries WHERE id=$1", [credit.journalEntryId]);
      expect(journal.currency_code).toBe(currencyCode);
      expect(Number(journal.exchange_rate)).toBe(rate);
      if (index === 1 && cancelIndex !== null) {
        const cancelledId = credits[cancelIndex];
        const history = await rows("SELECT * FROM stock_moves WHERE source_type='credit_note' AND source_id=$1", [cancelledId]);
        ok(await f.agent.post(`/api/sales/credit-notes/${cancelledId}/cancel`).send({}), 200);
        returned -= 333_333;
        previouslyRestored = Math.round(returned * unitCost * 100) / 100;
        await reconcile(f, {
          inventory: previouslyRestored, cogs: initialValue - previouslyRestored,
          profit: (quantity - returned) * price * rate - (initialValue - previouslyRestored),
        });
        expect(await rows("SELECT * FROM stock_moves WHERE source_type='credit_note' AND source_id=$1", [cancelledId])).toEqual(history);
        expect((await f.agent.post(`/api/sales/credit-notes/${cancelledId}/cancel`).send({})).status).toBe(409);
      }
    }
    const [totals] = await rows(`SELECT
      sum(l.base_debit-l.base_credit)::text AS value
      FROM credit_notes cn JOIN journal_entry_lines l ON l.entry_id=cn.journal_entry_id
      JOIN accounts a ON a.id=l.account_id WHERE cn.id=ANY($1::int[]) AND cn.status <> 'cancelled'
        AND a.system_key='inventory'`, [credits]);
    const [rounding] = await rows("SELECT coalesce(sum(cancellation_rounding),0)::float8 AS value FROM credit_notes WHERE id=ANY($1::int[]) AND status='cancelled'", [credits]);
    expect(Number(totals.value) + rounding.value).toBeCloseTo(initialValue, 6);
    expect((await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, 1, price))).status).toBe(409);
    await reconcile(f, { inventory: initialValue, cogs: 0, profit: 0 });
  });

  it("preserves fractional delivery cost allocations for large partial SO invoices and their final returns", async () => {
    const f = await fixture("fifo", [[1_000_000, 10], [1_000_000, 10.0001]]);
    const order = ok(await f.agent.post("/api/sales/orders").send({
      customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
      lines: [{ productId: f.productId, description: f.tag, quantity: 2_000_000, unitPrice: 20, taxRate: 0 }],
    }));
    ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id }));
    await reconcile(f, { inventory: 0, cogs: 20_000_100, profit: -20_000_100 });
    let revenue = 0;
    let restored = 0;
    for (const quantity of [800_000, 1_200_000]) {
      const invoice = ok(await f.agent.post("/api/sales/invoices").send({
        soId: order.id,
        lines: [{ productId: f.productId, description: f.tag, quantity, unitPrice: 20, taxRate: 0 }],
      }));
      revenue += quantity * 20;
      const [line] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [invoice.id]);
      const [allocation] = await rows("SELECT quantity,unit_cost FROM sales_issue_allocations WHERE invoice_line_id=$1", [line.id]);
      expect(Number(allocation.quantity)).toBe(quantity);
      expect(Number(allocation.unit_cost)).toBe(10.00005);
      await reconcile(f, { inventory: restored, cogs: 20_000_100 - restored, profit: revenue - (20_000_100 - restored) });
      let returned = 0;
      const priorInvoicesValue = restored;
      for (const part of [333_333, quantity - 333_333]) {
        ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, part, 20)));
        returned += part;
        revenue -= part * 20;
        restored = priorInvoicesValue + Math.round(returned * 10.00005 * 100) / 100;
        await reconcile(f, {
          inventory: restored, cogs: 20_000_100 - restored, profit: revenue - (20_000_100 - restored),
        });
      }
    }
    await reconcile(f, { inventory: 20_000_100, cogs: 0, profit: 0 });
  });

  it.each(["fifo", "average", "standard"] as const)("reconciles %s after price changes and repeated partial returns through the real POS/CN routes", async (method) => {
    const f = await fixture(method);
    const { invoice, lines } = await sale(f);
    const cost = method === "fifo" ? 60 : 200 / 3;
    await reconcile(f, { inventory: 100 - cost, cogs: cost, profit: 400 - cost }, method === "fifo");
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    const body = returnBody(f, invoice.id, lines[0].id, 1);
    const credit = ok(await f.agent.post("/api/sales/credit-notes").set("Idempotency-Key", `${f.tag}-partial`).send(body));
    await reconcile(f, { inventory: 100 - cost * 3 / 4, cogs: cost * 3 / 4, profit: 300 - cost * 3 / 4 }, method === "fifo");
    const [trace] = await rows(`SELECT r.unit_cost, r.quantity, r.original_move_id, r.invoice_line_id,
      m.unit_cost AS issue_cost, r.kind FROM stock_moves r JOIN stock_moves m ON m.id=r.original_move_id
      WHERE r.source_type='credit_note' AND r.source_id=$1`, [credit.id]);
    expect(trace.kind).toBe("return_in");
    expect(trace.invoice_line_id).toBe(lines[0].id);
    expect(trace.unit_cost).toBe(trace.issue_cost);
    expect(Number(trace.unit_cost)).not.toBe(99);
    expect(ok(await f.agent.post("/api/sales/credit-notes").set("Idempotency-Key", `${f.tag}-partial`).send(body)).id).toBe(credit.id);
    await db.update(productsTable).set({ costPrice: "150" }).where(eq(productsTable.id, f.productId));
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 3)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 }, method === "fifo");
    const over = await f.agent.post("/api/sales/credit-notes").send(body);
    expect(over.status).toBe(409);
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 }, method === "fifo");
  });

  it("keeps duplicate-product invoice lines tied to their own FIFO issue costs", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f, [{ productId: f.productId, quantity: 2 }, { productId: f.productId, quantity: 2 }]);
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[1].id, 1)));
    await reconcile(f, { inventory: 60, cogs: 40, profit: 260 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1)));
    await reconcile(f, { inventory: 70, cogs: 30, profit: 170 });
  });

  it.each(["delivered", "ready"] as const)("reconciles SO delivery (%s), invoice and partial return using original delivery cost", async (status) => {
    const f = await fixture();
    const order = ok(await f.agent.post("/api/sales/orders").send({
      customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
      lines: [{ productId: f.productId, description: f.tag, quantity: 4, unitPrice: 100, taxRate: 0 }],
    }));
    const delivery = ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id, status }));
    if (status === "ready") {
      await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
      ok(await f.agent.post(`/api/sales/deliveries/${delivery.id}/transition`).send({ to: "delivered" }), 200);
    }
    await reconcile(f, { inventory: 40, cogs: 60, profit: -60 });
    const invoice = ok(await f.agent.post("/api/sales/invoices").send({ customerId: f.customerId, soId: order.id }));
    const [line] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [invoice.id]);
    await reconcile(f, { inventory: 40, cogs: 60, profit: 340 });
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, 1)));
    await reconcile(f, { inventory: 55, cogs: 45, profit: 255 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, 3)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });

  it("returns the second partial invoice at its own SAR 20 issue cost, not the first invoice's SAR 10", async () => {
    const f = await fixture();
    const order = ok(await f.agent.post("/api/sales/orders").send({
      customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
      lines: [{ productId: f.productId, description: f.tag, quantity: 4, unitPrice: 100, taxRate: 0 }],
    }));
    const [soLine] = await rows("SELECT id FROM sales_order_lines WHERE so_id=$1", [order.id]);
    const invoices: Array<{ id: number; lineId: number }> = [];
    for (let installment = 0; installment < 2; installment++) {
      ok(await f.agent.post("/api/sales/deliveries").send({
        soId: order.id, lines: [{ soLineId: soLine.id, quantity: 2 }],
      }));
      const invoice = ok(await f.agent.post("/api/sales/invoices").send({
        soId: order.id,
        lines: [{ productId: f.productId, description: f.tag, quantity: 2, unitPrice: 100, taxRate: 0 }],
      }));
      const [line] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [invoice.id]);
      invoices.push({ id: invoice.id, lineId: line.id });
    }
    const allocations = await rows(`SELECT a.invoice_line_id, a.quantity, a.unit_cost, a.issue_move_id
      FROM sales_issue_allocations a JOIN customer_invoice_lines il ON il.id=a.invoice_line_id
      WHERE il.invoice_id=ANY($1::int[]) ORDER BY il.invoice_id`, [invoices.map((i) => i.id)]);
    expect(allocations.map((a) => Number(a.unit_cost))).toEqual([10, 20]);
    expect(allocations.map((a) => Number(a.quantity))).toEqual([2, 2]);
    expect(allocations[0].issue_move_id).not.toBe(allocations[1].issue_move_id);
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoices[1].id, invoices[1].lineId, 1)));
    await reconcile(f, { inventory: 60, cogs: 40, profit: 260 });
    const [returned] = await rows(`SELECT original_move_id, unit_cost FROM stock_moves
      WHERE invoice_line_id=$1 AND kind='return_in'`, [invoices[1].lineId]);
    expect(returned.original_move_id).toBe(allocations[1].issue_move_id);
    expect(Number(returned.unit_cost)).toBe(20);
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoices[1].id, invoices[1].lineId, 1)));
    await reconcile(f, { inventory: 80, cogs: 20, profit: 180 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoices[0].id, invoices[0].lineId, 2)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });

  it("reserves separate quantity slices when two invoices share one delivery issue", async () => {
    const f = await fixture();
    const order = ok(await f.agent.post("/api/sales/orders").send({
      customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
      lines: [{ productId: f.productId, description: f.tag, quantity: 4, unitPrice: 100, taxRate: 0 }],
    }));
    ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id }));
    const invoices = [];
    for (let installment = 0; installment < 2; installment++) {
      const invoice = ok(await f.agent.post("/api/sales/invoices").send({
        soId: order.id,
        lines: [{ productId: f.productId, description: f.tag, quantity: 2, unitPrice: 100, taxRate: 0 }],
      }));
      const [line] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [invoice.id]);
      invoices.push({ id: invoice.id, lineId: line.id });
    }
    const allocations = await rows(`SELECT a.quantity, a.issue_move_id
      FROM sales_issue_allocations a JOIN customer_invoice_lines il ON il.id=a.invoice_line_id
      WHERE il.invoice_id=ANY($1::int[])`, [invoices.map((i) => i.id)]);
    expect(allocations).toHaveLength(2);
    expect(allocations[0].issue_move_id).toBe(allocations[1].issue_move_id);
    expect(allocations.map((a) => Number(a.quantity))).toEqual([2, 2]);
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoices[1].id, invoices[1].lineId, 2)));
    await reconcile(f, { inventory: 70, cogs: 30, profit: 170 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoices[0].id, invoices[0].lineId, 2)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });

  it("preserves allocation history but releases billing capacity only after an explicit invoice reversal", async () => {
    const f = await fixture();
    const order = ok(await f.agent.post("/api/sales/orders").send({
      customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
      lines: [{ productId: f.productId, description: f.tag, quantity: 4, unitPrice: 100, taxRate: 0 }],
    }));
    ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id }));
    const original = ok(await f.agent.post("/api/sales/invoices").send({ soId: order.id }));
    const [originalLine] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [original.id]);
    const allocationBefore = await rows("SELECT * FROM sales_issue_allocations WHERE invoice_line_id=$1", [originalLine.id]);
    ok(await f.agent.post(`/api/sales/invoices/${original.id}/reverse`).send({ reason: "Synthetic re-billing" }), 200);
    const replacement = ok(await f.agent.post("/api/sales/invoices").send({ soId: order.id }));
    const [replacementLine] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [replacement.id]);
    const allocationAfter = await rows("SELECT * FROM sales_issue_allocations WHERE invoice_line_id=$1", [originalLine.id]);
    expect(allocationAfter).toEqual(allocationBefore);
    const replacementAllocations = await rows("SELECT quantity,issue_move_id FROM sales_issue_allocations WHERE invoice_line_id=$1", [replacementLine.id]);
    expect(replacementAllocations).toHaveLength(1);
    expect(Number(replacementAllocations[0].quantity)).toBe(4);
    expect(replacementAllocations[0].issue_move_id).toBe(allocationBefore[0].issue_move_id);
    expect((await f.agent.post("/api/sales/credit-notes").send(returnBody(f, original.id, originalLine.id, 1))).status).toBe(409);
    await reconcile(f, { inventory: 40, cogs: 60, profit: 340 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, replacement.id, replacementLine.id, 4)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });

  it("serializes concurrent partial returns without allocating original cost twice", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    const responses = await Promise.all([1, 3].map((quantity) => f.agent.post("/api/sales/credit-notes")
      .set("Idempotency-Key", `${f.tag}-${quantity}`).send(returnBody(f, invoice.id, lines[0].id, quantity))));
    responses.forEach((response) => ok(response));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });

  it("restores the historical cost even after receiving a newer expensive purchase layer", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    await db.transaction(async (tx) => {
      await recordStockMove(tx, {
        companyId: f.companyId, productId: f.productId, quantity: 3, unitCost: 90,
        kind: "receipt", toWarehouseId: f.warehouseId,
      });
      await tx.update(productsTable).set({ costPrice: "90" }).where(eq(productsTable.id, f.productId));
    });
    await reconcile(f, { inventory: 310, cogs: 60, profit: 340 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1)));
    await reconcile(f, { inventory: 325, cogs: 45, profit: 255 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 3)));
    await reconcile(f, { inventory: 370, cogs: 0, profit: 0 });
  });

  it("rolls back a restock when the journal cannot post to a closed period", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    await pool.query(`UPDATE fiscal_periods SET status='closed'
      WHERE fiscal_year_id IN (SELECT id FROM fiscal_years WHERE company_id=$1)`, [f.companyId]);
    const response = await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1));
    expect(response.status).toBe(403);
    const [count] = await rows("SELECT count(*)::int AS n FROM stock_moves WHERE product_id=$1 AND kind='return_in'", [f.productId]);
    expect(count.n).toBe(0);
    await reconcile(f, { inventory: 40, cogs: 60, profit: 340 });
  });

  it("does not reverse cost or add stock for a commercial credit without a physical return", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1, 100, false)));
    await reconcile(f, { inventory: 40, cogs: 60, profit: 240 });
  });

  it("rejects absent historical cost evidence without changing inventory, journals or creating a reserved draft", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    // Simulate a legacy sale: leave the original expense intact but remove
    // only its new trace reference in this disposable fixture.
    await pool.query("UPDATE stock_moves SET invoice_line_id=NULL WHERE invoice_line_id=$1", [lines[0].id]);
    const [before] = await rows("SELECT count(*)::int AS n FROM credit_notes WHERE company_id=$1", [f.companyId]);
    const result = await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1));
    expect(result.status).toBe(409);
    expect(result.body.error).toContain("تكلفة الصرف الأصلية");
    const [after] = await rows("SELECT count(*)::int AS n FROM credit_notes WHERE company_id=$1", [f.companyId]);
    expect(after.n).toBe(before.n);
    await reconcile(f, { inventory: 40, cogs: 60, profit: 340 });
  });

  it("reverses USD revenue at its historical rate but restores SAR cost only once despite a changed rate", async () => {
    const f = await fixture();
    // Foreign-currency invoices are supported by persisted accounting data.
    // The POS UI currently emits SAR; create a real posted USD fixture rather
    // than pretend the public POS accepts an unsupported currency field.
    const { invoice, line } = await db.transaction(async (tx) => {
      const [invoice] = await tx.insert(customerInvoicesTable).values({
        companyId: f.companyId, reference: `${f.tag}-USD`, customerId: f.customerId, customerName: f.tag,
        invoiceDate: new Date().toISOString().slice(0, 10), currencyCode: "USD",
        subtotal: "80", total: "80", vat: "0", status: "open",
      }).returning();
      const [line] = await tx.insert(customerInvoiceLinesTable).values({
        invoiceId: invoice.id, productId: f.productId, description: f.tag,
        quantity: "4", unitPrice: "20", taxRate: "0", lineTotal: "80",
      }).returning();
      // Two issue records under one invoice line: partial returns span them.
      for (const quantity of [2, 2]) await recordStockMove(tx, {
        companyId: f.companyId, productId: f.productId, quantity, kind: "issue",
        fromWarehouseId: f.warehouseId, invoiceLineId: line.id, sourceRef: invoice.reference,
      });
      await postJournalEntry(tx, {
        companyId: f.companyId, entryDate: new Date(), description: f.tag, reference: invoice.reference,
        sourceRef: invoice.reference, currencyCode: "USD", exchangeRate: 3.75,
      }, [{ systemKey: "ar", debit: 80 }, { systemKey: "sales_revenue", credit: 80 }]);
      return { invoice, line };
    });
    await pool.query(`INSERT INTO exchange_rates(from_currency,to_currency,rate,rate_date)
      VALUES ('USD','SAR',4.2,current_date)
      ON CONFLICT (from_currency,to_currency,rate_date) DO UPDATE SET rate=4.2`);
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    await reconcile(f, { inventory: 40, cogs: 60, profit: 240 });
    const credit = ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, 3, 20)));
    expect(credit.currencyCode).toBe("USD");
    const [journal] = await rows("SELECT currency_code,exchange_rate FROM journal_entries WHERE id=$1", [credit.journalEntryId]);
    expect(journal.currency_code).toBe("USD"); expect(Number(journal.exchange_rate)).toBe(3.75);
    await reconcile(f, { inventory: 80, cogs: 20, profit: 55 });
    const [ar] = await rows(`SELECT sum(l.base_debit-l.base_credit)::float8 AS value
      FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id JOIN accounts a ON a.id=l.account_id
      WHERE j.company_id=$1 AND a.system_key='ar'`, [f.companyId]);
    expect(ar.value).toBe(75); // USD 20 remaining × historical 3.75, not current 4.2.
    // Resell three units, including one returned unit, then replenish at 50.
    // Cancellation consumes 10+20+50=80, not the original returned value 40.
    await sale(f, [{ productId: f.productId, quantity: 3 }]);
    await db.transaction(async (tx) => {
      await recordStockMove(tx, { companyId: f.companyId, productId: f.productId, quantity: 1,
        unitCost: 50, kind: "receipt", toWarehouseId: f.warehouseId });
    });
    await reconcile(f, { inventory: 80, cogs: 70, profit: 305 });
    ok(await f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({}), 200);
    await reconcile(f, { inventory: 0, cogs: 150, profit: 450 });
    const [restoredAr] = await rows(`SELECT sum(l.base_debit-l.base_credit)::float8 AS value
      FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id JOIN accounts a ON a.id=l.account_id
      WHERE j.company_id=$1 AND a.system_key='ar'`, [f.companyId]);
    expect(restoredAr.value).toBe(300);
    const [reversal] = await rows("SELECT * FROM journal_entries WHERE reversal_of=$1", [credit.journalEntryId]);
    expect(reversal.currency_code).toBe("USD");
    expect(Number(reversal.exchange_rate)).toBe(3.75);
    const [difference] = await rows(`SELECT sum(l.base_debit-l.base_credit)::float8 AS value
      FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id JOIN accounts a ON a.id=l.account_id
      WHERE j.company_id=$1 AND j.source_ref=$2 AND a.system_key='cogs'`,
    [f.companyId, `${credit.reference}-CXL-COST`]);
    expect(difference.value).toBe(40);
    // Replenish after depletion and return again: cancellation released the
    // original invoice's return capacity, without deleting its cost evidence.
    await db.transaction(async (tx) => {
      await recordStockMove(tx, { companyId: f.companyId, productId: f.productId, quantity: 1,
        unitCost: 20, kind: "receipt", toWarehouseId: f.warehouseId });
    });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, 1, 20)));
    await reconcile(f, { inventory: 30, cogs: 140, profit: 385 });
  });
});

describe("credit-note cancellation reconciles actual depletion, not only journal balance", () => {
  it("charges the positive FIFO cost difference and rejects simultaneous/repeated cancellation", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    const credit = ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1)));
    await reconcile(f, { inventory: 55, cogs: 45, profit: 255 });
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    const responses = await Promise.all([0, 1].map(() =>
      f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({})));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    await reconcile(f, { inventory: 35, cogs: 65, profit: 335 });
    const [count] = await rows(`SELECT count(*)::int AS n FROM stock_moves
      WHERE source_type='credit_note_cancel' AND source_id=$1`, [credit.id]);
    expect(count.n).toBe(1);
    const [rev] = await rows("SELECT count(*)::int AS n FROM journal_entries WHERE reversal_of=$1", [credit.journalEntryId]);
    expect(rev.n).toBe(1);
    expect((await f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({})).status).toBe(409);
    await reconcile(f, { inventory: 35, cogs: 65, profit: 335 });
  });

  it("credits a negative FIFO difference without rewriting the original return or its layers", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    const first = ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 2)));
    // Original issue was weighted at 15. A second sale consumes 2×20.
    const second = await sale(f, [{ productId: f.productId, quantity: 2 }]);
    const credit = ok(await f.agent.post("/api/sales/credit-notes").send(
      returnBody(f, second.invoice.id, second.lines[0].id, 1)));
    const history = await rows("SELECT * FROM stock_moves WHERE source_type='credit_note' AND source_id=$1", [credit.id]);
    ok(await f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({}), 200);
    // Current FIFO layer is from the first return at 15, not the 20 being reversed.
    await reconcile(f, { inventory: 35, cogs: 65, profit: 335 });
    expect(await rows("SELECT * FROM stock_moves WHERE source_type='credit_note' AND source_id=$1", [credit.id])).toEqual(history);
    expect((await rows("SELECT status FROM credit_notes WHERE id=$1", [first.id]))[0].status).toBe("issued");
  });

  it.each(["average", "standard"] as const)("uses %s carrying value after the standard price changes", async (method) => {
    const f = await fixture(method);
    const { invoice, lines } = await sale(f);
    const credit = ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1)));
    const [before] = await rows("SELECT sum(quantity*avg_cost)::float8 AS v FROM stock_quants WHERE product_id=$1", [f.productId]);
    const expectedCost = Number(before.v) / 3;
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    ok(await f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({}), 200);
    const inventory = Number(before.v) - expectedCost;
    await reconcile(f, { inventory, cogs: 100 - inventory, profit: 300 + inventory }, false);
  });

  it("rolls back all cancellation effects in a closed period or on insufficient stock", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    const credit = ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 4)));
    const before = await rows("SELECT * FROM stock_layers WHERE product_id=$1 ORDER BY id", [f.productId]);
    await pool.query(`UPDATE fiscal_periods SET status='closed'
      WHERE fiscal_year_id IN (SELECT id FROM fiscal_years WHERE company_id=$1)`, [f.companyId]);
    expect((await f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({})).status).toBe(403);
    expect(await rows("SELECT * FROM stock_layers WHERE product_id=$1 ORDER BY id", [f.productId])).toEqual(before);
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
    await pool.query(`UPDATE fiscal_periods SET status='open'
      WHERE fiscal_year_id IN (SELECT id FROM fiscal_years WHERE company_id=$1)`, [f.companyId]);
    await sale(f, [{ productId: f.productId, quantity: 4 }]);
    expect((await f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({})).status).toBe(409);
    expect((await rows("SELECT status FROM credit_notes WHERE id=$1", [credit.id]))[0].status).toBe("issued");
    expect(await rows("SELECT id FROM journal_entries WHERE reversal_of=$1", [credit.journalEntryId])).toHaveLength(0);
    expect(await rows("SELECT id FROM stock_moves WHERE source_type='credit_note_cancel' AND source_id=$1", [credit.id])).toHaveLength(0);
    await reconcile(f, { inventory: 30, cogs: 70, profit: 330 });
  });

  it("rejects missing or inconsistent historical return evidence without repairing it", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    const credit = ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1)));
    await pool.query("UPDATE stock_moves SET original_move_id=NULL WHERE source_type='credit_note' AND source_id=$1", [credit.id]);
    expect((await f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({})).status).toBe(409);
    await reconcile(f, { inventory: 55, cogs: 45, profit: 255 });
    expect((await rows("SELECT status FROM credit_notes WHERE id=$1", [credit.id]))[0].status).toBe("issued");
  });

  it("cancels a commercial-only credit without changing inventory or COGS", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    const credit = ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1, 100, false)));
    ok(await f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({}), 200);
    await reconcile(f, { inventory: 40, cogs: 60, profit: 340 });
  });

  it("uses the same atomic valuation through approval, including retry after closed-period failure", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    const credit = ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1)));
    const [approver] = await db.insert(usersTable).values({
      name: f.tag, email: `${f.tag}-approver@example.invalid`, role: "manager",
    }).returning();
    await db.insert(userCompaniesTable).values({ userId: approver.id, companyId: f.companyId, role: "manager" });
    const [rule] = await db.insert(approvalRulesTable).values({
      companyId: f.companyId,
      name: f.tag, docType: "credit_note_cancel", minAmount: "0", isActive: true, mode: "sequential",
    }).returning();
    try {
      await db.insert(approvalStepsTable).values({
        ruleId: rule.id, sequence: 1, approverRole: "manager", approverUserId: approver.id, minAmount: "0",
      });
      const pending = ok(await f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({}), 202);
      await reconcile(f, { inventory: 55, cogs: 45, profit: 255 });
      await pool.query(`UPDATE fiscal_periods SET status='closed'
        WHERE fiscal_year_id IN (SELECT id FROM fiscal_years WHERE company_id=$1)`, [f.companyId]);
      await expect(actOnApproval(pending.approvalRequestId, approver.id, f.tag, "approve", f.companyId)).rejects.toThrow("الفترة");
      expect((await rows("SELECT status FROM approval_requests WHERE id=$1", [pending.approvalRequestId]))[0].status).toBe("pending");
      await reconcile(f, { inventory: 55, cogs: 45, profit: 255 });
      await pool.query(`UPDATE fiscal_periods SET status='open'
        WHERE fiscal_year_id IN (SELECT id FROM fiscal_years WHERE company_id=$1)`, [f.companyId]);
      await actOnApproval(pending.approvalRequestId, approver.id, f.tag, "approve", f.companyId);
      await reconcile(f, { inventory: 35, cogs: 65, profit: 335 });
      expect((await rows("SELECT status FROM credit_notes WHERE id=$1", [credit.id]))[0].status).toBe("cancelled");
      expect((await f.agent.post(`/api/sales/credit-notes/${credit.id}/cancel`).send({})).status).toBe(409);
    } finally {
      await db.delete(approvalRulesTable).where(eq(approvalRulesTable.id, rule.id));
    }
  });

  it("serializes two cancellations on one SO invoice and restores fulfilment counters exactly once", async () => {
    const f = await fixture();
    const order = ok(await f.agent.post("/api/sales/orders").send({
      customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
      lines: [{ productId: f.productId, description: f.tag, quantity: 4, unitPrice: 100, taxRate: 0 }],
    }));
    ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id }));
    const invoice = ok(await f.agent.post("/api/sales/invoices").send({ soId: order.id }));
    const [line] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [invoice.id]);
    const credits = [];
    for (let n = 0; n < 2; n++) credits.push(ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, 1))));
    const responses = await Promise.all(credits.map((c) => f.agent.post(`/api/sales/credit-notes/${c.id}/cancel`).send({})));
    responses.forEach((r) => ok(r, 200));
    await reconcile(f, { inventory: 30, cogs: 70, profit: 330 });
    const [counter] = await rows("SELECT invoiced_qty,delivered_qty FROM sales_order_lines WHERE so_id=$1", [order.id]);
    expect(Number(counter.invoiced_qty)).toBe(4);
    expect(Number(counter.delivered_qty)).toBe(4);
    expect((await rows("SELECT status FROM sales_orders WHERE id=$1", [order.id]))[0].status).toBe("invoiced");
    expect((await rows("SELECT status FROM customer_invoices WHERE id=$1", [invoice.id]))[0].status).toBe("open");
  });
});
