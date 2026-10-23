import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, companiesTable, usersTable, userCompaniesTable, branchesTable,
  customersTable, customerInvoicesTable, posSessionsTable, posOrdersTable,
  paymentGatewaysTable, paymentIntentsTable,
  externalCredentialsTable, marketplaceConnectorsTable, marketplaceOrderImportsTable,
  marketplaceSyncLogsTable, aiModelsTable, warehousesTable, integrationCallsTable,
  outboundMessagesTable, shippingCarriersTable, shipmentsTable, whatsappTemplatesTable,
  zatcaCertificatesTable, zatcaInvoicesTable, productsTable, categoriesTable, marketplaceProductMappingsTable,
} from "@workspace/db";
import app from "../app";
import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
import { upsertCredential, getCredential } from "../lib/integrations/credentials";
import { createCheckout, refundIntent } from "../lib/integrations/payments";
import { modelKey, trainCustomerChurn, trainFraudDetection, trainProductRecommendations, trainSalesForecast } from "../lib/ai-models";
import { encryptJson } from "../lib/integrations/crypto";
import { attachCsid, attachPcsid, retrieveCsid, retrievePcsid } from "../lib/integrations/zatca-phase2";
import { resolveProductId } from "../lib/integrations/marketplaces";

const tag = `boundaries-${Date.now()}`;
const password = "Synthetic123!";
type Agent = ReturnType<typeof request.agent>;
const userIds: number[] = [];
let a: number, b: number, branchA: number, branchB: number;
let customerA: number, customerB: number, invoiceA: number, invoiceB: number;
let gatewayA: number, gatewayB: number, intentA: number, intentB: number;
let connectorA: number, connectorB: number, logB: number, credentialB: number;
let sessionA: number, sessionB: number, managerId: number, foreignUserId: number;
let sharedId: number, localUserId: number;
let certificateA: number, certificateB: number, legacyCertificate: number, shipmentB: number, carrierB: number;
let templateB: number, categoryId: number, productA: number, productB: number;
const legacyRows: { message?: number; template?: number; call?: number } = {};
let owner: Agent, manager: Agent, shared: Agent, inventory: Agent, sales: Agent, accountant: Agent;
const fetchMock = vi.fn();

async function makeUser(role: string, companyId: number, membershipRole = role) {
  const [user] = await db.insert(usersTable).values({
    name: `${role}-${userIds.length}-${tag}`, email: `${role}-${userIds.length}-${tag}@test.local`,
    passwordHash: await bcrypt.hash(password, 4), role, isActive: true,
  }).returning();
  userIds.push(user.id);
  await db.insert(userCompaniesTable).values({ userId: user.id, companyId, role: membershipRole, isDefault: true });
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({ email: user.email, password });
  expect(response.status).toBe(200);
  expect(response.body.role).toBe(membershipRole);
  return { user, agent };
}

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockRejectedValue(new Error("External calls forbidden in boundary tests"));
  const companies = await db.insert(companiesTable).values([{ name: `A-${tag}` }, { name: `B-${tag}` }]).returning();
  [a, b] = companies.map((c) => c.id);
  const branches = await db.insert(branchesTable).values([
    { companyId: a, name: `A-${tag}`, nameAr: "أ", city: "Riyadh" },
    { companyId: b, name: `B-${tag}`, nameAr: "ب", city: "Jeddah" },
  ]).returning();
  [branchA, branchB] = branches.map((r) => r.id);
  for (const branchId of [branchA, branchB, null]) {
    const [message] = await db.insert(outboundMessagesTable).values({
      branchId, channel: "sms", provider: "mobily", toNumber: "+966500000000", body: `private-message-${branchId}-${tag}`,
    }).returning();
    const [template] = await db.insert(whatsappTemplatesTable).values({
      branchId, name: `template-${branchId}-${tag}`, bodyTemplate: "private-template",
    }).returning();
    const [call] = await db.insert(integrationCallsTable).values({
      branchId, provider: "mobily", endpoint: "/private", method: "POST", requestSummary: { private: tag },
    }).returning();
    const [certificate] = await db.insert(zatcaCertificatesTable).values({
      branchId, csrPem: `private-csr-${branchId}-${tag}`,
    }).returning();
    if (branchId === branchA) certificateA = certificate.id;
    else if (branchId === branchB) { certificateB = certificate.id; templateB = template.id; }
    else {
      legacyCertificate = certificate.id;
      Object.assign(legacyRows, { message: message.id, template: template.id, call: call.id });
    }
  }
  const [carrier] = await db.insert(shippingCarriersTable).values({
    branchId: branchB, provider: "smsa", displayName: `B-${tag}`,
  }).returning();
  carrierB = carrier.id;
  const [shipment] = await db.insert(shipmentsTable).values({
    carrierId: carrierB, awbNumber: tag, toAddress: { name: "private B recipient" },
  }).returning();
  shipmentB = shipment.id;
  const [category] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  categoryId = category.id;
  const products = await db.insert(productsTable).values([
    { companyId: a, name: `A-${tag}`, nameAr: "أ", sku: `A-${tag}`, price: "10", costPrice: "5", categoryId },
    { companyId: b, name: `B-${tag}`, nameAr: "ب", sku: `B-${tag}`, price: "10", costPrice: "5", categoryId },
  ]).returning();
  [productA, productB] = products.map((p) => p.id);
  owner = (await makeUser("owner", a)).agent;
  const m = await makeUser("manager", a);
  manager = m.agent; managerId = m.user.id;
  const s = await makeUser("owner", a, "sales"); // Global owner must NOT win at login.
  shared = s.agent; sharedId = s.user.id;
  await db.insert(userCompaniesTable).values([
    { userId: managerId, companyId: b, role: "sales" },
    { userId: sharedId, companyId: b, role: "owner" },
  ]);
  inventory = (await makeUser("inventory", a)).agent;
  sales = (await makeUser("sales", a)).agent;
  accountant = (await makeUser("accountant", a)).agent;
  foreignUserId = (await makeUser("sales", b)).user.id;
  localUserId = (await makeUser("cashier", a)).user.id;
  const customers = await db.insert(customersTable).values([
    { companyId: a, name: `PRIVATE-A-${tag}` }, { companyId: b, name: `PRIVATE-B-${tag}` },
  ]).returning();
  [customerA, customerB] = customers.map((r) => r.id);
  const invoices = await db.insert(customerInvoicesTable).values([
    { companyId: a, reference: `A-${tag}`, customerId: customerA, customerName: "A", invoiceDate: "2026-10-01", total: "100" },
    { companyId: b, reference: `B-${tag}`, customerId: customerB, customerName: "B", invoiceDate: "2026-10-01", total: "200" },
  ]).returning();
  [invoiceA, invoiceB] = invoices.map((r) => r.id);
  await db.insert(zatcaInvoicesTable).values([
    { invoiceId: invoiceA, branchId: branchA, uuid: `A-${tag}`, xmlPayload: "<private-A/>" },
    { invoiceId: invoiceB, branchId: branchB, uuid: `B-${tag}`, xmlPayload: "<private-B/>" },
  ]);
  const gateways = await db.insert(paymentGatewaysTable).values([
    { branchId: branchA, provider: "moyasar", displayName: `A-${tag}` },
    { branchId: branchB, provider: "moyasar", displayName: `B-${tag}` },
  ]).returning();
  [gatewayA, gatewayB] = gateways.map((r) => r.id);
  const intents = await db.insert(paymentIntentsTable).values([
    { gatewayId: gatewayA, invoiceId: invoiceA, amount: "100", status: "captured", providerRef: `A-${tag}` },
    { gatewayId: gatewayB, invoiceId: invoiceB, amount: "200", status: "captured", providerRef: `B-${tag}` },
  ]).returning();
  [intentA, intentB] = intents.map((r) => r.id);
  await upsertCredential({ companyId: b, branchId: branchB, provider: "moyasar", environment: "sandbox", secret: { key: "synthetic-original" } })
    .then((r) => { credentialB = r.id; });
  const connectors = await db.insert(marketplaceConnectorsTable).values([
    { branchId: branchA, platform: "salla", displayName: `A-${tag}` },
    { branchId: branchB, platform: "salla", displayName: `B-${tag}` },
  ]).returning();
  [connectorA, connectorB] = connectors.map((r) => r.id);
  // Simulate a corrupt legacy mapping to prove it cannot resolve a foreign product.
  await db.insert(marketplaceProductMappingsTable).values({
    connectorId: connectorA, productId: productB, externalProductId: "foreign-mapping",
    externalVariantId: "foreign-variant",
  });
  await db.insert(marketplaceOrderImportsTable).values({
    connectorId: connectorB, externalOrderId: tag, rawPayload: { customer: `PRIVATE-B-${tag}` },
  });
  const [log] = await db.insert(marketplaceSyncLogsTable).values({
    connectorId: connectorB, direction: "inbound", operation: "sync_orders", success: false,
  }).returning();
  logB = log.id;
  const sessions = await db.insert(posSessionsTable).values([
    { sessionNumber: `A-${tag}`, branchId: branchA, cashierName: "A" },
    { sessionNumber: `B-${tag}`, branchId: branchB, cashierName: "B" },
  ]).returning();
  [sessionA, sessionB] = sessions.map((r) => r.id);
  // Zero totals satisfy payment-balance triggers without manufacturing payments.
  await db.insert(posOrdersTable).values(Array.from({ length: 24 }, (_, i) => ({
    companyId: i < 12 ? a : b, sessionId: i < 12 ? sessionA : sessionB,
    customerId: i < 12 ? customerA : customerB, orderNumber: `${tag}-${i}`,
    items: [], subtotal: "0", total: "0",
  })));
  // Only metadata is ever cloned from legacy definitions.
  for (const key of ["sales_forecast", "customer_churn", "fraud_detection", "product_recommendations", "ai_assistant"]) {
    await db.insert(aiModelsTable).values({ key, name: key, parameters: { legacyForeignSecret: tag } }).onConflictDoNothing();
  }
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (!a || !b) return;
  await db.delete(aiModelsTable).where(sql`${aiModelsTable.key} like ${`company:${a}:%`} or ${aiModelsTable.key} like ${`company:${b}:%`}`);
  await db.delete(paymentIntentsTable).where(inArray(paymentIntentsTable.gatewayId, [gatewayA, gatewayB]));
  await db.delete(marketplaceConnectorsTable).where(inArray(marketplaceConnectorsTable.branchId, [branchA, branchB]));
  await db.delete(customerInvoicesTable).where(inArray(customerInvoicesTable.companyId, [a, b]));
  await db.delete(posOrdersTable).where(inArray(posOrdersTable.companyId, [a, b]));
  await db.delete(posSessionsTable).where(inArray(posSessionsTable.branchId, [branchA, branchB]));
  await db.delete(customersTable).where(inArray(customersTable.companyId, [a, b]));
  await db.delete(productsTable).where(inArray(productsTable.companyId, [a, b]));
  await db.delete(categoriesTable).where(eq(categoriesTable.id, categoryId));
  await db.delete(outboundMessagesTable).where(inArray(outboundMessagesTable.branchId, [branchA, branchB]));
  await db.delete(outboundMessagesTable).where(eq(outboundMessagesTable.id, legacyRows.message!));
  await db.delete(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, legacyRows.template!));
  await db.delete(integrationCallsTable).where(eq(integrationCallsTable.id, legacyRows.call!));
  await db.delete(zatcaCertificatesTable).where(eq(zatcaCertificatesTable.id, legacyCertificate));
  await db.delete(shipmentsTable).where(eq(shipmentsTable.id, shipmentB));
  await db.delete(integrationCallsTable).where(inArray(integrationCallsTable.branchId, [branchA, branchB]));
  await db.delete(warehousesTable).where(inArray(warehousesTable.companyId, [a, b]));
  await db.delete(branchesTable).where(inArray(branchesTable.id, [branchA, branchB]));
  await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.companyId, [a, b]));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await cleanupCompanyDefaults([a, b]);
  await db.delete(companiesTable).where(inArray(companiesTable.id, [a, b]));
});

describe("Company role boundaries", () => {
  it("switching replaces privileges and /auth/me reports the membership role", async () => {
    expect((await manager.get("/api/users")).status).toBe(200);
    const switched = await manager.post("/api/auth/switch-company").send({ companyId: b });
    expect(switched.status).toBe(200);
    expect(switched.body.role).toBe("sales");
    expect((await manager.get("/api/auth/me")).body.role).toBe("sales");
    expect((await manager.get("/api/users")).status).toBe(403);
    expect((await manager.post("/api/integrations/credentials").send({ provider: "tap", branchId: branchB, secret: {} })).status).toBe(403);
    await manager.post("/api/auth/switch-company").send({ companyId: a }).expect(200);
  });

  it("rejects the published bootstrap password without modifying an identity and permits rotation", async () => {
    const [before] = await db.select().from(usersTable).where(eq(usersTable.id, sharedId));
    const published = ["admin", "123"].join("");
    const candidate = request.agent(app);
    await candidate.post("/api/auth/login").send({ email: before.email, password: published }).expect(401);
    await candidate.get("/api/auth/me").expect(401);
    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, sharedId));
    expect(after).toEqual(before);
    await candidate.post("/api/auth/login").send({ email: before.email, password }).expect(200);
    await request(app).post("/api/auth/signup").send({
      name: "Blocked synthetic bootstrap", email: `blocked-${tag}@test.local`, password: published,
    }).expect(400);
    const blocked = await db.select().from(usersTable).where(eq(usersTable.email, `blocked-${tag}@test.local`));
    expect(blocked).toHaveLength(0);
    await owner.post("/api/users").send({
      name: "Blocked synthetic staff", email: `blocked-staff-${tag}@test.local`,
      password: published, role: "sales",
    }).expect(400);
    const [localBefore] = await db.select().from(usersTable).where(eq(usersTable.id, localUserId));
    await owner.patch(`/api/users/${localUserId}`).send({ password: published }).expect(400);
    const [localAfter] = await db.select().from(usersTable).where(eq(usersTable.id, localUserId));
    expect(localAfter).toEqual(localBefore);
  });

  it("login ignores the global role; demotion and membership revocation affect existing sessions", async () => {
    expect((await shared.get("/api/users")).status).toBe(403);
    await db.update(userCompaniesTable).set({ role: "cashier" }).where(and(
      eq(userCompaniesTable.userId, managerId), eq(userCompaniesTable.companyId, a),
    ));
    expect((await manager.get("/api/users")).status).toBe(403);
    await db.delete(userCompaniesTable).where(and(eq(userCompaniesTable.userId, managerId), eq(userCompaniesTable.companyId, a)));
    expect((await manager.get("/api/products")).status).toBe(403);
    await db.insert(userCompaniesTable).values({ userId: managerId, companyId: a, role: "manager", isDefault: true });
  });
});

describe("User administration", () => {
  it("lists only current-company members using membership roles", async () => {
    const response = await manager.get("/api/users").expect(200);
    expect(response.body.map((r: { id: number }) => r.id)).not.toContain(foreignUserId);
    expect(response.body.find((r: { id: number }) => r.id === sharedId).role).toBe("sales");
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("rejects foreign password, role and activation changes and foreign deletion", async () => {
    const [before] = await db.select().from(usersTable).where(eq(usersTable.id, foreignUserId));
    for (const patch of [{ password: "Attacker123!" }, { role: "manager" }, { isActive: false }]) {
      await manager.patch(`/api/users/${foreignUserId}`).send(patch).expect(404);
    }
    await owner.delete(`/api/users/${foreignUserId}`).expect(404);
    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, foreignUserId));
    expect(after).toEqual(before);
  });

  it("allows local role edits but cannot reset a shared identity or elevate to owner", async () => {
    await manager.patch(`/api/users/${managerId}`).send({ password: "Attacker123!", isActive: false }).expect(403);
    await manager.patch(`/api/users/${localUserId}`).send({ role: "owner" }).expect(403);
    const response = await manager.patch(`/api/users/${localUserId}`).send({ role: "sales" }).expect(200);
    expect(response.body.role).toBe("sales");
    const [membership] = await db.select().from(userCompaniesTable).where(and(
      eq(userCompaniesTable.userId, localUserId), eq(userCompaniesTable.companyId, a),
    ));
    expect(membership.role).toBe("sales");
  });

  it("creates a membership atomically and rejects another company's branch", async () => {
    await manager.post("/api/users").send({
      name: "Local employee", email: `new-${tag}@test.local`, password, role: "sales", branchId: branchB,
    }).expect(404);
    const created = await manager.post("/api/users").send({
      name: "Local employee", email: `new-${tag}@test.local`, password, role: "sales", branchId: branchA,
    }).expect(201);
    userIds.push(created.body.id);
    const [membership] = await db.select().from(userCompaniesTable).where(eq(userCompaniesTable.userId, created.body.id));
    expect(membership.companyId).toBe(a);
    await owner.delete(`/api/users/${created.body.id}`).expect(200);
    expect(await db.select().from(userCompaniesTable).where(eq(userCompaniesTable.userId, created.body.id))).toEqual([]);
  });
});

describe("Branch-owned integrations and marketplaces", () => {
  it("cannot overwrite foreign credentials or create gateways/carriers/connectors on a foreign branch", async () => {
    const [before] = await db.select().from(externalCredentialsTable).where(eq(externalCredentialsTable.id, credentialB));
    await manager.post("/api/integrations/credentials").send({
      provider: "moyasar", branchId: branchB, secret: { key: "attacker" },
    }).expect(404);
    await manager.post("/api/integrations/payment-gateways").send({ provider: "tap", displayName: "Attack", branchId: branchB }).expect(404);
    await manager.post("/api/integrations/shipping-carriers").send({ provider: "smsa", displayName: "Attack", branchId: branchB }).expect(404);
    await manager.post("/api/integrations/marketplaces").send({ platform: "salla", displayName: "Attack", branchId: branchB }).expect(404);
    await manager.delete(`/api/integrations/credentials/${credentialB}`).expect(404);
    const [after] = await db.select().from(externalCredentialsTable).where(eq(externalCredentialsTable.id, credentialB));
    expect(after).toEqual(before);
  });

  it("assigns omitted branch IDs to this company's branch and never reuses global secrets", async () => {
    const response = await manager.post("/api/integrations/credentials").send({
      provider: "tap", secret: { key: "synthetic-local" },
    }).expect(201);
    const [row] = await db.select().from(externalCredentialsTable).where(eq(externalCredentialsTable.id, response.body.id));
    expect(row.branchId).toBe(branchA);
    const [legacy] = await db.insert(externalCredentialsTable).values({
      provider: "mobily", secretCiphertext: encryptJson({ key: "legacy-global" }),
    }).returning();
    try {
      expect(await getCredential("mobily", { branchId: branchA })).toBeNull();
    } finally {
      await db.delete(externalCredentialsTable).where(eq(externalCredentialsTable.id, legacy.id));
    }
  });

  it("filters connector lists and refuses every foreign connector action before any network call", async () => {
    const list = await inventory.get("/api/integrations/marketplaces").expect(200);
    expect(list.body.map((r: { id: number }) => r.id)).toContain(connectorA);
    expect(list.body.map((r: { id: number }) => r.id)).not.toContain(connectorB);
    const calls = fetchMock.mock.calls.length;
    for (const suffix of ["orders", "logs", "mappings"]) {
      await inventory.get(`/api/integrations/marketplaces/${connectorB}/${suffix}`).expect(404);
      await inventory.get(`/api/integrations/marketplaces/${connectorA}/${suffix}`).expect(200);
    }
    for (const action of ["sync-orders", "push-inventory", "push-catalogue"]) {
      await inventory.post(`/api/integrations/marketplaces/${connectorB}/${action}`).send({}).expect(404);
    }
    await inventory.post(`/api/integrations/marketplaces/logs/${logB}/retry`).send({}).expect(404);
    await manager.patch(`/api/integrations/marketplaces/${connectorB}`).send({ isEnabled: false }).expect(404);
    await manager.delete(`/api/integrations/marketplaces/${connectorB}`).expect(404);
    // Express accepts these spellings too; ownership must not be bypassed.
    await inventory.get(`/api/INTEGRATIONS/MARKETPLACES/${connectorB}/orders/`).expect(404);
    await inventory.get(`/api/integrations/marketplaces/0x${connectorB.toString(16)}/orders`).expect(404);
    await inventory.post(`/api/INTEGRATIONS/MARKETPLACES/LOGS/${logB}/RETRY/`).send({}).expect(404);
    expect(fetchMock.mock.calls.length).toBe(calls);
    await inventory.post(`/api/integrations/marketplaces/${connectorA}/push-inventory`).send({}).expect(200);
  });
});

describe("Payments", () => {
  it("POS owners and managers can read only their company's gateways and intents", async () => {
    for (const actor of [owner, manager]) {
      const gateways = await actor.get("/api/pos/payment-gateways").expect(200);
      expect(gateways.body.map((r: { id: number }) => r.id)).toEqual([gatewayA]);
      const own = await actor.get(`/api/pos/payment/intent/${intentA}`).expect(200);
      expect(own.body.id).toBe(intentA);
      await actor.get(`/api/pos/payment/intent/${intentB}`).expect(404);
      await actor.post("/api/pos/payment/checkout").send({
        gatewayId: gatewayB, amount: 100, callbackUrl: "https://example.test/return",
      }).expect(404);
    }
    const [legacyGateway] = await db.insert(paymentGatewaysTable).values({
      provider: "tap", displayName: "Unowned legacy gateway",
    }).returning();
    const [legacyIntent] = await db.insert(paymentIntentsTable).values({
      gatewayId: legacyGateway.id, amount: "100", status: "captured",
    }).returning();
    try {
      for (const actor of [owner, manager]) {
        const list = await actor.get("/api/pos/payment-gateways").expect(200);
        expect(list.body.map((r: { id: number }) => r.id)).not.toContain(legacyGateway.id);
        await actor.get(`/api/pos/payment/intent/${legacyIntent.id}`).expect(404);
      }
    } finally {
      await db.delete(paymentIntentsTable).where(eq(paymentIntentsTable.id, legacyIntent.id));
      await db.delete(paymentGatewaysTable).where(eq(paymentGatewaysTable.id, legacyGateway.id));
    }
  });

  it("preserves narrower POS branch restrictions for non-administrators", async () => {
    await db.update(usersTable).set({ branchId: branchA }).where(eq(usersTable.id, sharedId));
    expect((await shared.get("/api/pos/payment-gateways").expect(200)).body.map((r: { id: number }) => r.id)).toEqual([gatewayA]);
    await shared.get(`/api/pos/payment/intent/${intentA}`).expect(200);
    await db.update(usersTable).set({ branchId: branchB }).where(eq(usersTable.id, sharedId));
    expect((await shared.get("/api/pos/payment-gateways").expect(200)).body).toEqual([]);
    await shared.get(`/api/pos/payment/intent/${intentA}`).expect(404);
    await shared.get(`/api/pos/payment/intent/${intentB}`).expect(404);
    await db.update(usersTable).set({ branchId: null }).where(eq(usersTable.id, sharedId));
  });

  it("does not expose foreign payment intents or gateway configuration", async () => {
    const intents = await manager.get("/api/integrations/payments/intents").expect(200);
    expect(intents.body.map((r: { id: number }) => r.id)).toContain(intentA);
    expect(intents.body.map((r: { id: number }) => r.id)).not.toContain(intentB);
    const gateways = await manager.get("/api/integrations/payment-gateways").expect(200);
    expect(gateways.body.map((r: { id: number }) => r.id)).toEqual([gatewayA]);
  });

  it("rejects foreign invoices, gateways and customers before creating a checkout", async () => {
    const calls = fetchMock.mock.calls.length;
    await sales.post(`/api/sales/invoices/${invoiceB}/pay-link`).send({ callbackUrl: "https://example.test/return" }).expect(404);
    await sales.post(`/api/sales/invoices/${invoiceA}/pay-link`).send({ gatewayId: gatewayB, callbackUrl: "https://example.test/return" }).expect(404);
    await manager.post("/api/integrations/payments/checkout").send({
      gatewayId: gatewayA, invoiceId: invoiceB, amount: 100, description: "Attack", callbackUrl: "https://example.test/return",
    }).expect(404);
    await expect(createCheckout({
      gatewayId: gatewayA, customerId: customerB, amount: 100, description: "Attack", callbackUrl: "https://example.test/return",
    }, a)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("refuses foreign refunds in both the route and service without changing the intent", async () => {
    const calls = fetchMock.mock.calls.length;
    await accountant.post("/api/integrations/payments/refund").send({ intentId: intentB }).expect(404);
    await expect(refundIntent({ intentId: intentB }, a)).rejects.toMatchObject({ status: 404 });
    const [intent] = await db.select().from(paymentIntentsTable).where(eq(paymentIntentsTable.id, intentB));
    expect(intent.status).toBe("captured");
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("still permits same-company invoice checkout and refunds using a stubbed provider", async () => {
    await upsertCredential({
      companyId: a, branchId: branchA, provider: "moyasar", environment: "sandbox",
      secret: { secretApiKey: "synthetic-not-a-real-provider-key" },
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id: `checkout-${tag}`, url: "https://example.test/checkout", status: "pending",
    }), { status: 200 }));
    const response = await sales.post(`/api/sales/invoices/${invoiceA}/pay-link`)
      .send({ callbackUrl: "https://example.test/return" }).expect(201);
    expect(response.body.checkoutUrl).toBe("https://example.test/checkout");
    const [intent] = await db.select().from(paymentIntentsTable).where(eq(paymentIntentsTable.id, response.body.intentId));
    expect(intent.gatewayId).toBe(gatewayA);
    expect(intent.invoiceId).toBe(invoiceA);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: `refund-${tag}` }), { status: 200 }));
    await accountant.post("/api/integrations/payments/refund").send({ intentId: intentA }).expect(200);
    const [updated] = await db.select().from(paymentIntentsTable).where(eq(paymentIntentsTable.id, intentA));
    expect(updated.status).toBe("refunded");
  });
});

describe("AI analytics", () => {
  it("trains only this company's data and stores separate parameters", async () => {
    const churn = await trainCustomerChurn(a);
    expect(churn.params.totalCustomers).toBe(0); // All synthetic orders are in the holdout window.
    const fraudA = await trainFraudDetection(a);
    const fraudB = await trainFraudDetection(b);
    expect(fraudA.size).toBe(12);
    expect(fraudB.size).toBe(12);
    expect(Object.keys(fraudA.params.cashierProfiles)).toEqual(["A"]);
    expect(Object.keys(fraudB.params.cashierProfiles)).toEqual(["B"]);
    await trainSalesForecast(a);
    await trainProductRecommendations(a);
    const models = await owner.get("/api/ai/models").expect(200);
    expect(models.body.every((m: { key: string }) => !m.key.startsWith("company:"))).toBe(true);
    const [rowA] = await db.select().from(aiModelsTable).where(eq(aiModelsTable.key, modelKey(a, "fraud_detection")));
    const [rowB] = await db.select().from(aiModelsTable).where(eq(aiModelsTable.key, modelKey(b, "fraud_detection")));
    expect(rowA.parameters).not.toEqual(rowB.parameters);
    expect(JSON.stringify(rowA.parameters)).not.toContain("legacyForeignSecret");
  });

  it("customer and anomaly predictions never include another company's data", async () => {
    const response = await accountant.get("/api/ai/predict/at-risk-customers").expect(200);
    expect(response.body.customers.map((c: { customerId: number }) => c.customerId)).toEqual([customerA]);
    expect(JSON.stringify(response.body)).not.toContain(`PRIVATE-B-${tag}`);
    // Make every recent order anomalous without using foreign model parameters.
    await db.update(aiModelsTable).set({ parameters: {
      totalOrders: 1, hourCounts: {}, cashierProfiles: {}, madOrderValue: 1, medianOrderValue: 0,
      meanItemsPerOrder: 0, stdItemsPerOrder: 1,
    } }).where(eq(aiModelsTable.key, modelKey(a, "fraud_detection")));
    const anomalies = await accountant.get("/api/ai/predict/fraud-anomalies").expect(200);
    const foreignOrders = await db.select({ id: posOrdersTable.id }).from(posOrdersTable).where(eq(posOrdersTable.companyId, b));
    expect(anomalies.body.anomalies).toHaveLength(12);
    expect(anomalies.body.anomalies.every((r: { orderId: number }) => !foreignOrders.some((o) => o.id === r.orderId))).toBe(true);
  });
});

describe("Remaining integration boundaries", () => {
  it("filters messages, shipments, call summaries, templates and tax records by company", async () => {
    for (const path of ["messages", "shipments", "calls", "whatsapp-templates", "zatca/certificates", "zatca/invoices"]) {
      const response = await manager.get(`/api/integrations/${path}`).expect(200);
      expect(Array.isArray(response.body)).toBe(true);
      for (const row of response.body) {
        if ("branchId" in row) expect(row.branchId).toBe(branchA);
      }
      expect(JSON.stringify(response.body)).not.toContain("private B recipient");
      expect(JSON.stringify(response.body)).not.toContain("<private-B/>");
      expect(JSON.stringify(response.body)).not.toContain(`private-message-${branchB}-${tag}`);
      if (path === "zatca/certificates") {
        expect(response.body.map((r: { id: number }) => r.id)).toContain(certificateA);
        expect(response.body.map((r: { id: number }) => r.id)).not.toContain(legacyCertificate);
      }
    }
  });

  it("refuses foreign and branchless ZATCA certificates before mutation or retrieval", async () => {
    const calls = fetchMock.mock.calls.length;
    const [before] = await db.select().from(zatcaCertificatesTable).where(eq(zatcaCertificatesTable.id, certificateB));
    for (const certificateId of [certificateB, legacyCertificate]) {
      await owner.post("/api/integrations/zatca/csid").send({
        certificateId, csid: "attack", certificatePem: "invalid-certificate-with-enough-length",
      }).expect(404);
      await owner.post("/api/integrations/zatca/pcsid").send({ certificateId, pcsid: "attack" }).expect(404);
      await owner.post("/api/integrations/zatca/csid/retrieve").send({ certificateId, otp: "123456" }).expect(404);
      await owner.post("/api/integrations/zatca/pcsid/retrieve").send({ certificateId }).expect(404);
      await expect(attachCsid({ certificateId, csid: "attack", certificatePem: "attack" }, a)).rejects.toMatchObject({ status: 404 });
      await expect(attachPcsid({ certificateId, pcsid: "attack" }, a)).rejects.toMatchObject({ status: 404 });
      await expect(retrieveCsid({ certificateId, otp: "123456" }, a)).rejects.toMatchObject({ status: 404 });
      await expect(retrievePcsid({ certificateId }, a)).rejects.toMatchObject({ status: 404 });
    }
    expect(fetchMock.mock.calls.length).toBe(calls);
    const [after] = await db.select().from(zatcaCertificatesTable).where(eq(zatcaCertificatesTable.id, certificateB));
    expect(after).toEqual(before);
    await owner.post("/api/integrations/zatca/pcsid").send({ certificateId: certificateA, pcsid: "synthetic-local" }).expect(200);
  });

  it("rejects foreign message/template, shipment and tax creation/action paths", async () => {
    const calls = fetchMock.mock.calls.length;
    await manager.get(`/api/integrations/shipments/${shipmentB}/tracking`).expect(404);
    await manager.patch(`/api/integrations/whatsapp-templates/${templateB}`).send({ bodyTemplate: "attack" }).expect(404);
    await manager.delete(`/api/integrations/whatsapp-templates/${templateB}`).expect(404);
    for (const path of ["messages", "whatsapp-templates", "whatsapp-templates/sync", "zatca/csr"]) {
      await owner.post(`/api/integrations/${path}`).send({ branchId: branchB }).expect(404);
    }
    await sales.post("/api/integrations/shipments").send({
      carrierId: carrierB, weightKg: 1, toAddress: { name: "Recipient", phone: "+966500000000", line1: "123 road", city: "Riyadh" },
    }).expect(404);
    await owner.post("/api/integrations/zatca/submit").send({ invoiceId: invoiceB }).expect(404);
    await owner.post("/api/integrations/zatca/submit").send({ invoiceId: invoiceA, branchId: branchB }).expect(404);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("marketplace SKU and mapping resolution cannot select another company's product", async () => {
    expect(await resolveProductId(connectorA, "new", null, `B-${tag}`)).toBeNull();
    expect(await resolveProductId(connectorA, "foreign-mapping", null, null)).toBeNull();
    expect(await resolveProductId(connectorA, "foreign-mapping", "foreign-variant", null)).toBeNull();
    expect(await resolveProductId(connectorA, "new", null, `A-${tag}`)).toBe(productA);
  });
});
