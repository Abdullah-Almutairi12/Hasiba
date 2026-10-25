import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { pool } from "@workspace/db";
import { posTemplateFixture, personInput, accepted as ok, fixtureRows as rows, testActor } from "../test/pos-template-fixture";

const permissions = ["procurement.read", "procurement.invoices.read", "procurement.invoices.compare"];
async function fixture() {
  const f = await posTemplateFixture();
  const t = ok(await f.owner.post("/api/team/templates").send({
    name: "قراءة ومقارنة فواتير دون التزامات", resource: "procurement", actions: permissions,
  }), 201);
  let person = ok(await f.owner.put(`/api/team/people/${f.people[0].personId}/access`).send({
    expectedRevision: f.people[0].revision, suspended: false,
    person: { ...personInput(f.people[0]), loginKinds: ["platform"], deniedActions: [],
      grants: [{ resource: "procurement", branchId: f.branches[0].id, warehouseIds: [f.warehouses[0].id],
        actions: permissions, amountLimit: null, startsAt: null, endsAt: null,
        templateId: t.id, templateRevision: 1, templateMode: "inherit" }] },
  }));
  const supplier = ok(await f.owner.post("/api/suppliers").send({ name: `مورد المقارنة ${randomUUID()}` }), 201);
  const po = ok(await f.owner.post("/api/procurement/purchase-orders").send({
    supplierId: supplier.id, warehouseId: f.warehouses[0].id,
    lines: [{ productId: f.products[0].id, description: "كراتين مقارنة", quantity: 100, unitPrice: 7.25, taxRate: 0 }],
  }), 201);
  const detail = ok(await f.owner.get(`/api/procurement/purchase-orders/${po.id}`));
  const invoice = (await rows(`INSERT INTO invoices(company_id,supplier_id,invoice_number,supplier_name,amount,po_id,file_url)
    VALUES($1,$2,$3,'مورد المقارنة',725,$4,$5) RETURNING *`,
    [f.companies[0].id, supplier.id, `MATCH-${randomUUID()}`, po.id,
      `/api/storage/objects/invoices/2026-10-26/${randomUUID()}.png`]))[0];
  const request = (method: "get" | "post", path: string) => f.actors[0][method](`/api${path}`)
    .set("X-Workspace-Responsibility", String(person.grants[0].id));
  const change = async (patch: any) => {
    person = ok(await f.owner.put(`/api/team/people/${person.personId}/access`).send({
      expectedRevision: person.revision, suspended: false, person: { ...personInput(person), ...patch },
    }));
  };
  return { ...f, person, supplier, po: detail, invoice, request, change };
}

describe("supplier invoice read and advisory comparison boundaries", () => {
  it("preserves the original unmanaged inventory read permission without granting it to scoped receivers", async () => {
    const f = await fixture();
    const email = `legacy-invoice-reader-${randomUUID()}@example.invalid`;
    const [user] = await rows(`INSERT INTO users(name,email,password_hash,role,is_active)
      VALUES('قارئ قديم',$1,$2,'inventory',true) RETURNING id`, [email, f.ownerUser.passwordHash]);
    await pool.query(`INSERT INTO user_companies(user_id,company_id,role,is_default) VALUES($1,$2,'inventory',true)`,
      [user.id, f.companies[0].id]);
    const actor = testActor();
    ok(await actor.post("/api/auth/login").send({ email, password: f.password }));
    ok(await actor.get(`/api/invoices/${f.invoice.id}`));
  });
  it("exposes only evidenced company/branch/warehouse sources and denies an unbound legacy invoice", async () => {
    const f = await fixture();
    expect(ok(await f.request("get", "/invoices")).some((i: any) => i.id === f.invoice.id)).toBe(true);
    ok(await f.request("get", `/invoices/${f.invoice.id}`));
    const [other] = await rows(`INSERT INTO invoices(company_id,invoice_number,supplier_name,amount)
      VALUES($1,$2,'غير متاح',10) RETURNING id`, [f.companies[1].id, randomUUID()]);
    expect((await f.request("get", `/invoices/${other.id}`)).status).toBe(404);
    const [unbound] = await rows(`INSERT INTO invoices(company_id,invoice_number,supplier_name,amount)
      VALUES($1,$2,'بلا مصدر فرعي',10) RETURNING id`, [f.companies[0].id, randomUUID()]);
    expect((await f.request("get", `/invoices/${unbound.id}`)).status).toBe(404);
    await pool.query(`UPDATE purchase_orders SET warehouse_id=$1 WHERE id=$2`, [f.warehouses[1].id, f.po.id]);
    expect((await f.request("get", `/invoices/${f.invoice.id}`)).status).toBe(404);
    expect(ok(await f.request("get", "/invoices")).some((i: any) => i.id === f.invoice.id)).toBe(false);
  });

  it("does not imply printing, exporting, writing, or finance from a read/review grant", async () => {
    const f = await fixture();
    for (const suffix of ["/pdf", "/pdf?download=1"]) {
      expect((await f.request("get", `/invoices/${f.invoice.id}${suffix}`)).status).toBe(403);
    }
    expect((await f.request("post", "/invoices/from-scan").send({})).status).toBe(403);
    expect((await f.request("post", "/invoices").send({ invoiceNumber: randomUUID(), supplierName: "أ", amount: 1 })).status).toBe(403);
    expect((await f.request("get", "/procurement/open-invoices")).status).toBe(403);
  });

  it("does not expose invoice prices to a quantities-only receiver", async () => {
    const f = await fixture();
    await f.change({ grants: [{ resource: "procurement", branchId: f.branches[0].id,
      warehouseIds: [f.warehouses[0].id], actions: ["procurement.read", "procurement.receipts.read"],
      amountLimit: null, startsAt: null, endsAt: null }] });
    for (const path of ["/invoices", "/invoices/stats", `/invoices/${f.invoice.id}`, `/invoices/${f.invoice.id}/pdf`]) {
      expect((await f.request("get", path)).status).toBe(403);
    }
    expect((await f.request("post", "/invoices/match-preview").send({ poId: f.po.id, items: [] })).status).toBe(403);
  });

  it("rechecks monetary limits and an upper denial in the same open session", async () => {
    const f = await fixture();
    const grant = { resource: "procurement", branchId: f.branches[0].id,
      warehouseIds: [f.warehouses[0].id], actions: permissions, amountLimit: "700", startsAt: null, endsAt: null };
    await f.change({ grants: [grant] });
    expect((await f.request("get", `/invoices/${f.invoice.id}`)).status).toBe(404);
    await f.change({ grants: [{ ...grant, amountLimit: null }] });
    ok(await f.request("get", `/invoices/${f.invoice.id}`));
    await f.change({ deniedActions: ["procurement.invoices.read"] });
    expect((await f.request("get", `/invoices/${f.invoice.id}`)).status).toBe(403);
  });

  it("rejects unauthorized or unattached invoice images before accessing object storage", async () => {
    const f = await fixture();
    await pool.query("UPDATE invoices SET company_id=$1 WHERE id=$2", [f.companies[1].id, f.invoice.id]);
    expect((await f.request("get", f.invoice.file_url.replace(/^\/api/, ""))).status).toBe(404);
    expect((await f.request("get", `/storage/objects/invoices/2026-10-26/${randomUUID()}.png`)).status).toBe(404);
  });

  it("shows 100 ordered / 80 received / 100 current as a 20-unit difference without financial writes", async () => {
    const f = await fixture();
    await pool.query("UPDATE purchase_order_lines SET received_qty=80,billed_qty=0 WHERE id=$1", [f.po.lines[0].id]);
    const before = await rows("SELECT (SELECT count(*) FROM invoices)::int AS invoices,(SELECT count(*) FROM journal_entries)::int AS journals,(SELECT count(*) FROM stock_moves)::int AS moves");
    const report = ok(await f.request("post", "/invoices/match-preview").send({
      poId: f.po.id, items: [{ poLineId: f.po.lines[0].id, quantity: 100, unitPrice: 7.25 }],
    }));
    expect(report).toMatchObject({ advisoryOnly: true, requiresReview: true, currentSubtotal: "725.00", source: { canOpenOrder: false } });
    expect(Number(report.lines[0].ordered)).toBe(100);
    expect(Number(report.lines[0].received)).toBe(80);
    expect(Number(report.lines[0].excess)).toBe(20);
    expect(report.lines[0].messages[0]).toContain("20");
    const after = await rows("SELECT (SELECT count(*) FROM invoices)::int AS invoices,(SELECT count(*) FROM journal_entries)::int AS journals,(SELECT count(*) FROM stock_moves)::int AS moves");
    expect(after).toEqual(before);
  });

  it("aggregates repeated request lines, respects already billed quantity, and rejects foreign source lines", async () => {
    const f = await fixture();
    await pool.query("UPDATE purchase_order_lines SET received_qty=80,billed_qty=60 WHERE id=$1", [f.po.lines[0].id]);
    const report = ok(await f.request("post", "/invoices/match-preview").send({
      poId: f.po.id, items: [{ poLineId: f.po.lines[0].id, quantity: 15, unitPrice: 7.25 },
        { poLineId: f.po.lines[0].id, quantity: 10, unitPrice: 7.25 }],
    }));
    expect(report.lines).toHaveLength(1);
    expect(Number(report.lines[0].billed)).toBe(60);
    expect(Number(report.lines[0].excess)).toBe(5);
    expect((await f.request("post", "/invoices/match-preview").send({
      poId: f.po.id, items: [{ poLineId: 2147483000, quantity: 1, unitPrice: 7.25 }],
    })).status).toBe(400);
  });
});
