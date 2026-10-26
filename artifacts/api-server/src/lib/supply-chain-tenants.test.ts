import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, companiesTable, usersTable, userCompaniesTable, categoriesTable,
  branchesTable, warehousesTable, productsTable, suppliersTable, invoicesTable,
  stockQuantsTable, stockMovesTable, stockLotsTable, stockSerialsTable,
  productVariantsTable, reorderRulesTable, stockTakesTable, stockTakeLinesTable,
  bomsTable, bomLinesTable, workOrdersTable, qualityChecksTable, scrapRecordsTable,
  workCentersTable, routingsTable, routingOperationsTable,
  rfqsTable, rfqSuppliersTable, rfqQuoteLinesTable, purchaseOrdersTable,
  purchaseOrderLinesTable, goodsReceiptsTable, paymentRunsTable,
  blanketAgreementsTable,
} from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
import { seedCompanyFiscalCalendar } from "./fiscal-calendar";
import { recordStockMove } from "./stock-engine";
import { requireSupplyReference } from "./supply-chain-scope";

const tag = `supply-tenants-${Date.now()}`;
type Fixture = Record<"company" | "user" | "branch" | "warehouse" | "product" | "supplier" |
  "invoice" | "quant" | "move" | "lot" | "serial" | "variant" | "reorder" |
  "take" | "takeLine" | "bom" | "wo" | "qc" | "scrap" | "center" | "routing" |
  "rfq" | "po" | "poLine" | "receipt" | "run" | "agreement", number>;
const fixtures: Fixture[] = [];
const agents: request.Agent[] = [];
const independentReviewers: number[] = [];
let category = 0;
let poisonedBom = 0;
let poisonedPo = 0;
let legacyCenter = 0;
let legacyRouting = 0;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await assertApplicationReady();
  const [cat] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  category = cat.id;
  const hash = await bcrypt.hash("SupplyTest123!", 4);
  for (let n = 0; n < 2; n++) {
    const f = {} as Fixture;
    const name = `${tag}-${n}`;
    f.company = (await db.insert(companiesTable).values({ name }).returning())[0].id;
    await seedCompanyFiscalCalendar(f.company);
    f.user = (await db.insert(usersTable).values({
      name, email: `${name}@test.local`, passwordHash: hash, role: "owner",
    }).returning())[0].id;
    await db.insert(userCompaniesTable).values({ companyId: f.company, userId: f.user, role: "owner", isDefault: true });
    f.branch = (await db.insert(branchesTable).values({ companyId: f.company, name, nameAr: name, city: tag }).returning())[0].id;
    f.warehouse = (await db.insert(warehousesTable).values({ companyId: f.company, branchId: f.branch, name, nameAr: name, isDefault: true }).returning())[0].id;
    f.product = (await db.insert(productsTable).values({
      companyId: f.company, categoryId: category, name, nameAr: name,
      sku: name, barcode: `${name}-barcode`, price: "0", costPrice: "0", stock: "10",
    }).returning())[0].id;
    f.supplier = (await db.insert(suppliersTable).values({ companyId: f.company, name }).returning())[0].id;
    f.invoice = (await db.insert(invoicesTable).values({
      companyId: f.company, supplierId: f.supplier, supplierName: name, invoiceNumber: name, amount: "10",
    }).returning())[0].id;
    f.quant = (await db.insert(stockQuantsTable).values({ productId: f.product, warehouseId: f.warehouse, quantity: "10", avgCost: "0" }).returning())[0].id;
    f.move = (await db.insert(stockMovesTable).values({
      productId: f.product, fromWarehouseId: f.warehouse, toWarehouseId: f.warehouse,
      quantity: "1", kind: "transfer", state: "in_transit",
    }).returning())[0].id;
    f.lot = (await db.insert(stockLotsTable).values({ productId: f.product, lotNumber: name }).returning())[0].id;
    f.serial = (await db.insert(stockSerialsTable).values({ productId: f.product, serialNumber: name, currentWarehouseId: f.warehouse }).returning())[0].id;
    f.variant = (await db.insert(productVariantsTable).values({ productId: f.product, sku: `${name}-variant`, barcode: `${name}-variant-barcode` }).returning())[0].id;
    f.reorder = (await db.insert(reorderRulesTable).values({ productId: f.product, warehouseId: f.warehouse, minQty: "20", maxQty: "30" }).returning())[0].id;
    f.take = (await db.insert(stockTakesTable).values({ reference: name, warehouseId: f.warehouse, status: "in_progress" }).returning())[0].id;
    f.takeLine = (await db.insert(stockTakeLinesTable).values({ stockTakeId: f.take, productId: f.product, expectedQty: "10", countedQty: "10" }).returning())[0].id;
    // This synthetic initial observation has a known actor. Unknown historical
    // actors are exercised separately and must not be "fixed" by recounting.
    await db.execute(sql`INSERT INTO stocktake_count_participants(take_id,user_id,line_id)
      VALUES(${f.take},${f.user},${f.takeLine})`);
    f.center = (await db.insert(workCentersTable).values({ companyId: f.company, code: name, name, nameAr: name }).returning())[0].id;
    f.routing = (await db.insert(routingsTable).values({ companyId: f.company, reference: name, name, nameAr: name }).returning())[0].id;
    await db.insert(routingOperationsTable).values({ routingId: f.routing, workCenterId: f.center, name, nameAr: name });
    f.bom = (await db.insert(bomsTable).values({ companyId: f.company, reference: name, productId: f.product, routingId: f.routing }).returning())[0].id;
    await db.insert(bomLinesTable).values({ bomId: f.bom, componentId: f.product, quantityPer: "1" });
    f.wo = (await db.insert(workOrdersTable).values({
      companyId: f.company, reference: name, bomId: f.bom, productId: f.product, quantity: "1", warehouseId: f.warehouse,
    }).returning())[0].id;
    f.qc = (await db.insert(qualityChecksTable).values({ workOrderId: f.wo, name, nameAr: name }).returning())[0].id;
    f.scrap = (await db.insert(scrapRecordsTable).values({
      reference: name, productId: f.product, quantity: "1", fromWarehouseId: f.warehouse, toWarehouseId: f.warehouse, workOrderId: f.wo,
    }).returning())[0].id;
    f.rfq = (await db.insert(rfqsTable).values({ companyId: f.company, reference: name, status: "sent" }).returning())[0].id;
    await db.insert(rfqSuppliersTable).values({ rfqId: f.rfq, supplierId: f.supplier });
    await db.insert(rfqQuoteLinesTable).values({ rfqId: f.rfq, supplierId: f.supplier, productId: f.product, description: name, quantity: "1", unitPrice: "0" });
    f.po = (await db.insert(purchaseOrdersTable).values({
      companyId: f.company, reference: name, supplierId: f.supplier, supplierName: name, warehouseId: f.warehouse, orderDate: today, status: "confirmed",
    }).returning())[0].id;
    f.poLine = (await db.insert(purchaseOrderLinesTable).values({ poId: f.po, productId: f.product, description: name, quantity: "3", unitPrice: "0", lineTotal: "0" }).returning())[0].id;
    f.receipt = (await db.insert(goodsReceiptsTable).values({ reference: name, poId: f.po, warehouseId: f.warehouse }).returning())[0].id;
    f.run = (await db.insert(paymentRunsTable).values({ companyId: f.company, reference: name, paymentDate: today }).returning())[0].id;
    f.agreement = (await db.insert(blanketAgreementsTable).values({ reference: name, supplierId: f.supplier, startDate: today, endDate: today }).returning())[0].id;
    fixtures.push(f);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: `${name}@test.local`, password: "SupplyTest123!" }).expect(200);
    agents.push(agent);
  }
  const [a, b] = fixtures;
  poisonedBom = (await db.insert(bomsTable).values({ companyId: a.company, reference: `${tag}-mixed`, productId: b.product }).returning())[0].id;
  poisonedPo = (await db.insert(purchaseOrdersTable).values({
    companyId: a.company, reference: `${tag}-mixed`, supplierId: b.supplier, supplierName: tag, warehouseId: a.warehouse, orderDate: today,
  }).returning())[0].id;
  legacyCenter = (await db.insert(workCentersTable).values({ code: `${tag}-legacy`, name: tag, nameAr: tag }).returning())[0].id;
  legacyRouting = (await db.insert(routingsTable).values({ reference: `${tag}-legacy`, name: tag, nameAr: tag }).returning())[0].id;
});

afterAll(async () => {
  const companyIds = fixtures.map((f) => f.company);
  if (!companyIds.length) return;
  const ids = (key: keyof Fixture) => fixtures.map((f) => f[key]);
  // Delete only this suite's tagged synthetic graph, children before parents.
  await db.execute(sql`DELETE FROM procurement_email_outbox WHERE ref_id IN (SELECT id FROM purchase_orders WHERE company_id IN (${sql.join(companyIds.map((id) => sql`${id}`), sql`, `)}))`);
  for (const [table, field] of [
    ["goods_receipts", "po_id"], ["purchase_order_lines", "po_id"],
  ]) await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.identifier(field)} IN (SELECT id FROM purchase_orders WHERE company_id IN (${sql.join(companyIds.map((id) => sql`${id}`), sql`, `)}))`);
  await db.delete(paymentRunsTable).where(inArray(paymentRunsTable.companyId, companyIds));
  await db.delete(invoicesTable).where(inArray(invoicesTable.companyId, companyIds));
  await db.delete(purchaseOrdersTable).where(inArray(purchaseOrdersTable.companyId, companyIds));
  await db.delete(rfqsTable).where(inArray(rfqsTable.companyId, companyIds));
  await db.delete(blanketAgreementsTable).where(inArray(blanketAgreementsTable.supplierId, ids("supplier")));
  await db.delete(scrapRecordsTable).where(inArray(scrapRecordsTable.productId, ids("product")));
  await db.delete(workOrdersTable).where(inArray(workOrdersTable.companyId, companyIds));
  await db.delete(bomsTable).where(inArray(bomsTable.companyId, companyIds));
  await db.delete(routingsTable).where(inArray(routingsTable.id, [...ids("routing"), legacyRouting]));
  await db.delete(workCentersTable).where(inArray(workCentersTable.id, [...ids("center"), legacyCenter]));
  for (const table of [stockTakeLinesTable, stockMovesTable, stockQuantsTable, stockSerialsTable, reorderRulesTable, productVariantsTable, stockLotsTable]) {
    await db.delete(table).where(inArray(table.productId, ids("product")));
  }
  await db.delete(stockTakesTable).where(inArray(stockTakesTable.warehouseId, ids("warehouse")));
  // Disposable fixture teardown only; retain the production FK protection.
  await db.execute(sql`DELETE FROM stocktake_product_fences WHERE warehouse_id IN
    (${sql.join(ids("warehouse").map(id=>sql`${id}`),sql`, `)})`);
  await db.delete(productsTable).where(inArray(productsTable.id, ids("product")));
  await db.delete(warehousesTable).where(inArray(warehousesTable.companyId, companyIds));
  await db.delete(branchesTable).where(inArray(branchesTable.id, ids("branch")));
  await db.delete(suppliersTable).where(inArray(suppliersTable.id, ids("supplier")));
  const userIds=[...ids("user"),...independentReviewers];
  await db.execute(sql`DELETE FROM audit_logs WHERE user_id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`);
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await cleanupCompanyDefaults(companyIds);
  await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
  await db.delete(categoriesTable).where(eq(categoriesTable.id, category));
});

describe("supply-chain tenant boundaries", () => {
  const listCases: [string, keyof Fixture][] = [
    ["/inventory/quants", "quant"], ["/inventory/moves", "move"], ["/inventory/transfers", "move"],
    ["/inventory/lots", "lot"], ["/inventory/serials", "serial"], ["/inventory/variants", "variant"],
    ["/inventory/reorder-rules", "reorder"], ["/inventory/stock-takes", "take"],
    ["/manufacturing/boms", "bom"], ["/manufacturing/work-orders", "wo"],
    ["/manufacturing/work-centers", "center"], ["/manufacturing/routings", "routing"],
    ["/manufacturing/scrap", "scrap"], ["/procurement/rfqs", "rfq"],
    ["/procurement/goods-receipts", "receipt"], ["/procurement/payment-runs", "run"],
    ["/procurement/agreements", "agreement"], ["/procurement/open-invoices", "invoice"],
  ];
  it.each(listCases)("scopes %s before returning rows", async (path, key) => {
    for (let n = 0; n < 2; n++) {
      const response = await agents[n].get(`/api${path}`).expect(200);
      const rows = response.body as Array<Record<string, number>>;
      // Quants have no public id; compare the product/warehouse keys instead.
      if (key === "quant") {
        expect(rows.some((r) => r.productId === fixtures[n].product)).toBe(true);
        expect(rows.every((r) => r.productId !== fixtures[1 - n].product)).toBe(true);
      } else {
        expect(rows.some((r) => r.id === fixtures[n][key])).toBe(true);
        expect(rows.every((r) => r.id !== fixtures[1 - n][key])).toBe(true);
      }
    }
  });

  it("denies every foreign detail/action before any stock, production, email or payment side effect", async () => {
    const b = fixtures[1];
    const paths: [string, string, unknown?][] = [
      ["get", `/inventory/products/${b.product}/balances`],
      ["get", `/inventory/stock-takes/${b.take}`],
      ["patch", `/inventory/stock-takes/${b.take}/lines/${b.takeLine}`, { countedQty: 999 }],
      ["post", `/inventory/stock-takes/${b.take}/lines`, { productId: b.product }],
      ["post", `/inventory/stock-takes/${b.take}/complete`],
      ["post", `/inventory/transfers/${b.move}/receive`],
      ["get", `/manufacturing/boms/${b.bom}`],
      ["get", `/manufacturing/boms/${b.bom}/cost`],
      ["get", `/manufacturing/work-orders/${b.wo}`],
      ["patch", `/manufacturing/work-orders/${b.wo}`, { notes: "forged" }],
      ...["confirm", "start", "consume", "produce", "complete", "cancel"].map((action): [string, string, unknown] =>
        ["post", `/manufacturing/work-orders/${b.wo}/${action}`, { quantity: 1 }]),
      ["post", `/manufacturing/quality-checks/${b.qc}/result`, { result: "pass" }],
      ["post", `/manufacturing/scrap/${b.scrap}/rework`],
      ["get", `/procurement/rfqs/${b.rfq}`],
      ["post", `/procurement/rfqs/${b.rfq}/quotes`, { supplierId: b.supplier, lines: [] }],
      ["post", `/procurement/rfqs/${b.rfq}/award`, { supplierId: b.supplier }],
      ["get", `/procurement/purchase-orders/${b.po}`],
      ["get", `/procurement/purchase-orders/${b.po}/pdf`],
      ["get", `/procurement/purchase-orders/${b.po}/outbox`],
      ["post", `/procurement/purchase-orders/${b.po}/outbox/1/retry`],
      ...["confirm", "approve", "cancel", "close", "send"].map((action): [string, string, unknown] =>
        ["post", `/procurement/purchase-orders/${b.po}/${action}`, { to: "attacker@example.test" }]),
      ["post", `/procurement/payment-runs/${b.run}/execute`],
    ];
    for (const [method, path, body] of paths) {
      const agent = agents[0];
      const call = method === "get" ? agent.get(`/api${path}`) : method === "patch" ? agent.patch(`/api${path}`) : agent.post(`/api${path}`);
      await call.send(body ?? {}).expect(404);
    }
    expect((await db.select().from(stockTakesTable).where(eq(stockTakesTable.id, b.take)))[0].status).toBe("in_progress");
    expect((await db.select().from(stockQuantsTable).where(eq(stockQuantsTable.id, b.quant)))[0].quantity).toBe("10.0000");
    expect((await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, b.wo)))[0].state).toBe("draft");
    expect((await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, b.po)))[0].status).toBe("confirmed");
    expect((await db.select().from(paymentRunsTable).where(eq(paymentRunsTable.id, b.run)))[0].status).toBe("draft");
  });

  it("rejects cross-company creation, nested references and filters", async () => {
    const [a, b] = fixtures;
    const cases: [string, object][] = [
      ["/inventory/moves", { productId: a.product, warehouseId: b.warehouse, kind: "receipt", quantity: 1 }],
      ["/inventory/transfers", { productId: a.product, fromWarehouseId: a.warehouse, toWarehouseId: b.warehouse, quantity: 1 }],
      ["/inventory/stock-takes", { warehouseId: b.warehouse }],
      ["/inventory/stock-takes/" + a.take + "/lines", { productId: b.product }],
      ["/inventory/lots", { productId: b.product, lotNumber: tag }],
      ["/inventory/serials", { productId: a.product, serialNumber: tag, currentWarehouseId: b.warehouse }],
      ["/inventory/variants", { productId: b.product, sku: tag }],
      ["/inventory/reorder-rules", { productId: a.product, warehouseId: b.warehouse, minQty: 0, maxQty: 10 }],
      ["/manufacturing/boms", { productId: a.product, lines: [{ componentId: b.product, quantityPer: 1 }] }],
      ["/manufacturing/work-orders", { bomId: b.bom, warehouseId: a.warehouse, quantity: 1 }],
      ["/manufacturing/quality-checks", { workOrderId: b.wo, name: tag, nameAr: tag }],
      ["/manufacturing/scrap", { productId: a.product, fromWarehouseId: b.warehouse, quantity: 1 }],
      ["/manufacturing/routings", { name: tag, nameAr: tag, operations: [{ name: tag, nameAr: tag, workCenterId: b.center }] }],
      ["/procurement/rfqs", { supplierIds: [a.supplier, b.supplier] }],
      ["/procurement/purchase-orders", { supplierId: a.supplier, lines: [{ productId: b.product }] }],
      ["/procurement/goods-receipts", { poId: b.po, warehouseId: a.warehouse, lines: [{ poLineId: b.poLine, quantity: 1 }] }],
      ["/procurement/goods-receipts", { poId: a.po, warehouseId: a.warehouse, lines: [{ poLineId: b.poLine, quantity: 1 }] }],
      ["/procurement/payment-runs", { lines: [{ supplierId: b.supplier, invoiceId: b.invoice, amount: 10 }] }],
      ["/procurement/agreements", { supplierId: b.supplier }],
    ];
    for (const [path, body] of cases) await agents[0].post(`/api${path}`).send(body).expect(404);
    for (const path of [
      `/inventory/quants?warehouseId=${b.warehouse}`, `/inventory/moves?productId=${b.product}`,
      `/inventory/lots?productId=${b.product}`, `/procurement/supplier-ledger?supplierId=${b.supplier}`,
      `/procurement/po-suggestions?supplierId=${b.supplier}`,
    ]) await agents[0].get(`/api${path}`).expect(404);
    for (const code of [`${tag}-1-barcode`, `${tag}-1-variant-barcode`]) {
      await agents[0].get("/api/inventory/lookup").query({ code }).expect(404);
    }
  });

  it("quarantines mixed-owner historical graphs and unowned manufacturing resources", async () => {
    await agents[0].get(`/api/manufacturing/boms/${poisonedBom}`).expect(404);
    await agents[0].get(`/api/procurement/purchase-orders/${poisonedPo}/pdf`).expect(404);
    const boms = await agents[0].get("/api/manufacturing/boms").expect(200);
    expect(boms.body.some((b: { id: number }) => b.id === poisonedBom)).toBe(false);
    await expect(requireSupplyReference("workCenter", legacyCenter, fixtures[0].company)).rejects.toThrow("Not found");
    await expect(requireSupplyReference("routing", legacyRouting, fixtures[0].company)).rejects.toThrow("Not found");
  });

  it("excludes foreign lot/variant quants from aggregates and refuses mixed-variant transfer receipt", async () => {
    const [a, b] = fixtures;
    const poisonedQuants = await db.insert(stockQuantsTable).values([
      { productId: a.product, warehouseId: a.warehouse, lotId: b.lot, quantity: "80", avgCost: "15" },
      { productId: a.product, warehouseId: a.warehouse, variantId: b.variant, quantity: "90", avgCost: "25" },
    ]).returning();
    const [mixedMove] = await db.insert(stockMovesTable).values({
      productId: a.product, fromWarehouseId: a.warehouse, toWarehouseId: a.warehouse,
      variantId: b.variant, kind: "transfer", state: "in_transit", quantity: "40",
    }).returning();
    try {
      const quants = await agents[0].get("/api/inventory/quants").query({ productId: a.product }).expect(200);
      expect(quants.body).toHaveLength(1);
      expect(quants.body[0].quantity).toBe(10);
      const balances = await agents[0].get(`/api/inventory/products/${a.product}/balances`).expect(200);
      expect(balances.body.find((row: { warehouseId: number }) => row.warehouseId === a.warehouse).quantity).toBe(10);
      const suggestions = await agents[0].get("/api/inventory/reorder-suggestions").expect(200);
      const suggestion = suggestions.body.find((row: { product_id: number }) => row.product_id === a.product);
      expect(suggestion.on_hand).toBe(10);
      expect(suggestion.suggested_qty).toBe(20);
      const summary = await agents[0].get("/api/inventory/warehouse-summary").expect(200);
      const warehouse = summary.body.find((row: { warehouse_id: number }) => row.warehouse_id === a.warehouse);
      expect(warehouse.total_qty).toBe(10);
      expect(warehouse.total_value).toBe(0);
      await expect(db.transaction(async (tx) => {
        await recordStockMove(tx, {
          companyId: a.company, productId: a.product, toWarehouseId: a.warehouse,
          quantity: 1, unitCost: 0, kind: "receipt",
        });
        const [product] = await tx.select().from(productsTable).where(eq(productsTable.id, a.product));
        expect(Number(product.stock)).toBe(11);
        throw new Error("Rollback stock-cache probe");
      })).rejects.toThrow("Rollback stock-cache probe");
      const transfers = await agents[0].get("/api/inventory/transfers").expect(200);
      expect(transfers.body.some((row: { id: number }) => row.id === mixedMove.id)).toBe(false);
      await agents[0].post(`/api/inventory/transfers/${mixedMove.id}/receive`).send({}).expect(404);
      expect((await db.select().from(stockMovesTable).where(eq(stockMovesTable.id, mixedMove.id)))[0].state).toBe("in_transit");
      expect((await db.select().from(stockQuantsTable).where(eq(stockQuantsTable.id, poisonedQuants[1].id)))[0].quantity).toBe("90.0000");
    } finally {
      await db.delete(stockMovesTable).where(eq(stockMovesTable.id, mixedMove.id));
      await db.delete(stockQuantsTable).where(inArray(stockQuantsTable.id, poisonedQuants.map((row) => row.id)));
    }
  });

  it("scopes summaries, reports, supplier ledgers and suggestions", async () => {
    const [a, b] = fixtures;
    const summary = await agents[0].get("/api/inventory/warehouse-summary").expect(200);
    expect(summary.body.some((r: { warehouse_id: number }) => r.warehouse_id === b.warehouse)).toBe(false);
    const suggestions = await agents[0].get("/api/inventory/reorder-suggestions").expect(200);
    expect(suggestions.body.map((r: { product_id: number }) => r.product_id)).toEqual([a.product]);
    const supplierMatches = await agents[0].get("/api/procurement/po-suggestions").query({ supplierName: `${tag}-1` }).expect(200);
    expect(supplierMatches.body).toEqual([]);
    for (const path of [
      "/manufacturing/schedule", "/manufacturing/reports/variance", "/manufacturing/reports/summary",
      "/procurement/ap-aging", "/procurement/reports/top-suppliers", "/procurement/reports/open-pos-by-supplier",
      "/procurement/reports/payment-forecast", "/procurement/reports/grn-vs-invoice-gap", "/procurement/stats",
    ]) {
      const result = await agents[0].get(`/api${path}`).expect(200);
      expect(JSON.stringify(result.body)).not.toContain(`${tag}-1`);
    }
    const ledger = await agents[0].get("/api/procurement/supplier-ledger").query({ supplierId: a.supplier }).expect(200);
    expect(ledger.body.supplier.id).toBe(a.supplier);
  });

  it("keeps legitimate same-company stock, manufacturing and procurement flows working", async () => {
    const a = fixtures[0];
    await agents[0].get(`/api/manufacturing/boms/${a.bom}/cost`).expect(200);
    await agents[0].patch(`/api/manufacturing/work-orders/${a.wo}`).send({ notes: "authorized" }).expect(200);
    await agents[0].post(`/api/manufacturing/work-orders/${a.wo}/confirm`).send({}).expect(200);
    await agents[0].post(`/api/manufacturing/work-orders/${a.wo}/start`).send({}).expect(200);
    await agents[0].get(`/api/manufacturing/work-orders/${a.wo}`).expect(200);
    await agents[0].post(`/api/manufacturing/quality-checks/${a.qc}/result`).send({ result: "pass" }).expect(200);
    await agents[0].post(`/api/manufacturing/work-orders/${a.wo}/consume`).send({}).expect(200);
    await agents[0].post(`/api/manufacturing/work-orders/${a.wo}/produce`).send({ quantity: 1 }).expect(200);
    await agents[0].post(`/api/manufacturing/work-orders/${a.wo}/complete`).send({}).expect(200);
    const point=await agents[0].post(`/api/inventory/stock-takes/${a.take}/checkpoint`).send({productId:a.product}).expect(200);
    expect(point.body.lineId).toBe(a.takeLine);
    await agents[0].patch(`/api/inventory/stock-takes/${a.take}/lines/${a.takeLine}`).send({
      countedQty: 9, expectedRevision:point.body.expectedRevision,checkpointId:point.body.checkpointId,
    }).expect(200);
    const [reviewerUser]=await db.insert(usersTable).values({name:`${tag}-reviewer`,email:`${tag}-reviewer@example.invalid`,
      passwordHash:await bcrypt.hash("SupplyTest123!",4),role:"owner",isActive:true,has2fa:false}).returning();
    independentReviewers.push(reviewerUser.id);
    await db.insert(userCompaniesTable).values({userId:reviewerUser.id,companyId:a.company,role:"owner",isDefault:true});
    const reviewer=request.agent(app);
    await reviewer.post("/api/auth/login").send({email:reviewerUser.email,password:"SupplyTest123!"}).expect(200);
    await reviewer.post(`/api/inventory/stock-takes/${a.take}/complete`).send({}).expect(200);
    await agents[0].post("/api/inventory/moves").send({ productId: a.product, warehouseId: a.warehouse, quantity: 1, kind: "receipt", unitCost: 0 }).expect(201);
    await agents[0].get(`/api/procurement/purchase-orders/${a.po}/pdf`).expect(200);
    await agents[0].post("/api/procurement/goods-receipts").send({ poId: a.po, warehouseId: a.warehouse, lines: [{ poLineId: a.poLine, quantity: 1 }] }).expect(201);
    const created = await agents[0].post("/api/manufacturing/work-orders").send({ bomId: a.bom, quantity: 1 }).expect(201);
    expect(created.body.warehouseId).toBe(a.warehouse);
    const payment = await agents[0].post("/api/procurement/payment-runs").send({ lines: [{ supplierId: a.supplier, invoiceId: a.invoice, amount: 10 }] }).expect(201);
    expect(payment.body.companyId).toBe(a.company);
  });

  it("enforces warehouse/product consistency inside the shared stock engine", async () => {
    const [a, b] = fixtures;
    await expect(db.transaction((tx) => recordStockMove(tx, {
      productId: a.product, toWarehouseId: b.warehouse, quantity: 1, unitCost: 0, kind: "receipt",
    }))).rejects.toThrow("Stock resource not found");
    await expect(db.transaction((tx) => recordStockMove(tx, {
      companyId: a.company, productId: b.product, toWarehouseId: b.warehouse, quantity: 1, unitCost: 0, kind: "receipt",
    }))).rejects.toThrow("Stock resource not found");
  });
});
