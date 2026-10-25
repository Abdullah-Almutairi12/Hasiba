// Synthetic data only. Call exclusively inside the disposable test database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import bcrypt from "bcryptjs";
import { db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable, warehousesTable,
  categoriesTable, productsTable, fiscalYearsTable, fiscalPeriodsTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { recordStockMove } from "../lib/stock-engine";
import { ensureAdministrativePerson } from "../lib/administration-enrollment";
import { updateTeamPerson, teamPeople } from "../lib/team-store";

let address = 20;
export const testActor = () => request.agent(app).set("X-Forwarded-For", `198.19.0.${++address}`);
export function accepted(r: request.Response, status = 200): any {
  assert.equal(r.status, status, JSON.stringify(r.body)); return r.body;
}
export const personInput = (p: any) => ({
  creationKey: p.creationKey, name: p.name, email: p.email, loginKinds: p.loginKinds,
  deniedActions: p.deniedActions, grants: p.grants.map(({ id, ...g }: any) => g),
});
export async function posTemplateFixture() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);
  assert.equal(new URL(process.env.TEST_DATABASE_URL!).hostname, "127.0.0.1");
  await assertApplicationReady();
  const tag = randomUUID(), password = `Isolated POS template ${randomUUID()}!`;
  const hash = await bcrypt.hash(password, 4);
  const companies = await db.insert(companiesTable).values([
    { name: "منشأة اختبار قوالب البيع", vatRegistrationStatus: "not_registered" },
    { name: "منشأة اختبار العضوية الأخرى", vatRegistrationStatus: "not_registered" },
  ]).returning();
  const [ownerUser] = await db.insert(usersTable).values({
    name: "مالك تجربة القوالب", email: `pos-owner-${tag}@example.invalid`, passwordHash: hash, role: "owner",
  }).returning();
  await db.insert(userCompaniesTable).values(companies.map((c, i) => ({
    companyId: c.id, userId: ownerUser.id, role: "owner", isDefault: i === 0,
  })));
  const owner = testActor();
  accepted(await owner.post("/api/auth/login").send({ email: ownerUser.email, password }));
  const branches = await db.insert(branchesTable).values([
    { companyId: companies[0].id, name: `POS-${tag}`, nameAr: "جدة — نقاط البيع", city: "جدة" },
    { companyId: companies[0].id, name: `INV-${tag}`, nameAr: "الرياض — المخزون", city: "الرياض" },
    { companyId: companies[1].id, name: `OTHER-${tag}`, nameAr: "فرع المنشأة الأخرى", city: "الدمام" },
  ]).returning();
  const warehouses = await db.insert(warehousesTable).values(branches.map(b => ({
    companyId: b.companyId, branchId: b.id, name: `WH-${b.id}`, nameAr: `مستودع ${b.nameAr}`, isDefault: true,
  }))).returning();
  const [extraWarehouse] = await db.insert(warehousesTable).values({
    companyId: companies[0].id, branchId: branches[0].id, name: `extra-${tag}`, nameAr: "مستودع بيع غير ممنوح", isDefault: false,
  }).returning();
  const [category] = await db.insert(categoriesTable).values({ name: tag, nameAr: "منتجات تجربة معزولة" }).returning();
  const products = await db.insert(productsTable).values(companies.map((c, i) => ({
    companyId: c.id, categoryId: category.id, name: `product-${i}-${tag}`,
    nameAr: i ? "منتج المنشأة الأخرى فقط" : "منتج قالب البيع", sku: `${i}-${tag}`,
    price: "10", costPrice: "3", costingMethod: "fifo",
  }))).returning();
  const year = new Date().getUTCFullYear();
  for (let i = 0; i < companies.length; i++) {
    const [fy] = await db.insert(fiscalYearsTable).values({ companyId: companies[i].id, name: tag,
      startDate: `${year}-01-01`, endDate: `${year}-12-31` }).returning();
    await db.insert(fiscalPeriodsTable).values({ fiscalYearId: fy.id, name: tag,
      startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open" });
  }
  for (let i = 0; i < warehouses.length; i++) {
    const product = products[i === 2 ? 1 : 0];
    await db.transaction(tx => recordStockMove(tx, { companyId: product.companyId!, productId: product.id,
      quantity: 20, unitCost: 3, kind: "receipt", toWarehouseId: warehouses[i].id,
      sourceType: "pos_template_fixture", sourceRef: `${tag}-${i}`, createdBy: ownerUser.id }));
  }
  const template = accepted(await owner.post("/api/team/templates").send({
    name: "قالب البيع المشترك", resource: "pos", actions: ["pos.read", "pos.sell", "pos.shift.open"],
  }), 201);
  const startsAt = new Date(Date.now() - 3600_000).toISOString();
  const endsAt = new Date(Date.now() + 86400_000).toISOString();
  const people: any[] = [], actors: request.Agent[] = [];
  for (let i = 0; i < 3; i++) {
    let person = accepted(await owner.post("/api/team/people").send({
      creationKey: randomUUID(), name: ["كاشير ألف", "كاشير باء", "كاشير جيم"][i],
      email: `pos-${i}-${tag}@example.invalid`, loginKinds: ["platform", "pos"],
      deniedActions: i === 1 ? ["pos.payment.record"] : [],
      grants: [
        { resource: "pos", branchId: branches[0].id, warehouseIds: [warehouses[0].id],
          actions: template.actions, amountLimit: "10", startsAt, endsAt,
          templateId: template.id, templateRevision: 1, templateMode: i === 2 ? "override" : "inherit" },
        { resource: "inventory", branchId: branches[1].id, warehouseIds: [warehouses[1].id],
          actions: ["inventory.read"], amountLimit: null, startsAt, endsAt },
      ],
    }), 201);
    const invite = accepted(await owner.post(`/api/team/people/${person.personId}/invite`).send({ expectedRevision: person.revision }), 201);
    accepted(await testActor().post("/api/auth/team-activation/accept").send({ token: invite.activationToken, password }));
    person = accepted(await owner.get("/api/team/people")).find((p: any) => p.personId === person.personId);
    person.grants.sort((a: any, b: any) => Number(b.resource === "pos") - Number(a.resource === "pos"));
    const actor = testActor();
    accepted(await actor.post("/api/auth/login").send({ email: person.email, password }));
    people.push(person); actors.push(actor);
  }
  // Same global identity, a different scoped inventory-only membership.
  await db.insert(userCompaniesTable).values({ userId: people[0].userId, companyId: companies[1].id, role: "scoped", isDefault: false });
  await db.transaction(tx => ensureAdministrativePerson(tx, companies[1].id, people[0].userId));
  const otherPerson = (await teamPeople(companies[1].id)).find(p => p.userId === people[0].userId)!;
  await updateTeamPerson(companies[1].id, ownerUser.id, otherPerson.personId, otherPerson.revision, {
    ...personInput(otherPerson), loginKinds: ["platform"], grants: [{
      resource: "inventory", branchId: branches[2].id, warehouseIds: [warehouses[2].id],
      actions: ["inventory.read", "inventory.cost.read"], amountLimit: null, startsAt, endsAt,
    }],
  }, false);
  return { owner, ownerUser, password, companies, branches, warehouses, extraWarehouse, products, template, people, actors };
}
export type PosTemplateFixture = Awaited<ReturnType<typeof posTemplateFixture>>;
export const fixtureRows = async (query: string, params: unknown[] = []) => (await pool.query(query, params)).rows;
