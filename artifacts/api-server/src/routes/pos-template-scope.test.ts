import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { accepted as ok, posTemplateFixture, personInput, fixtureRows as rows, type PosTemplateFixture } from "../test/pos-template-fixture";

const selected = (a: any, method: "get" | "post", path: string, id: number) =>
  a[method](`/api${path}`).set("X-Workspace-Responsibility", String(id));
const post = (f: PosTemplateFixture, path: string, body: object, key = randomUUID(), grant = f.people[0].grants[0]) =>
  selected(f.actors[0], "post", path, grant.id).set("Idempotency-Key", key).send(body);
const bodyFor = (f: PosTemplateFixture, sessionId: number, quantity = 1) => ({
  sessionId, paymentMethod: "cash", items: [{ productId: f.products[0].id, quantity, unitPrice: 0.01 }],
});
const open = async (f: PosTemplateFixture) => ok(await post(f, "/pos/sessions", {
  branchId: f.branches[0].id, openingCash: 0, cashierName: "كاشير ألف",
}), 201);
const evidence = (f: PosTemplateFixture) => rows(`SELECT
  (SELECT count(*)::int FROM pos_orders o JOIN pos_sessions s ON s.id=o.session_id JOIN branches b ON b.id=s.branch_id WHERE b.company_id=$1) orders,
  (SELECT count(*)::int FROM customer_invoices WHERE company_id=$1) invoices,
  (SELECT count(*)::int FROM journal_entries WHERE company_id=$1) journals,
  (SELECT count(*)::int FROM stock_moves WHERE product_id=$2) moves,
  (SELECT quantity::text FROM stock_quants WHERE product_id=$2 AND warehouse_id=$3) quantity`,
  [f.companies[0].id, f.products[0].id, f.warehouses[0].id]);
async function refresh(f: PosTemplateFixture) {
  const people = ok(await f.owner.get("/api/team/people"));
  f.people = f.people.map(p => {
    const next = people.find((x: any) => x.personId === p.personId);
    next.grants.sort((a: any, b: any) => Number(b.resource === "pos") - Number(a.resource === "pos"));
    return next;
  });
}
describe("positive POS shared templates with independent live scope", () => {
  it("does not open the legacy sales invoice directory to scoped POS or inventory responsibilities",async()=>{
    const f=await posTemplateFixture(),session=await open(f);
    ok(await post(f,"/pos/orders",bodyFor(f,session.id)),201);
    expect(ok(await f.owner.get("/api/sales/invoices"))).toHaveLength(1);
    expect((await selected(f.actors[0],"get","/sales/invoices",f.people[0].grants[0].id)).status).toBe(403);
    expect((await selected(f.actors[0],"get","/sales/invoices",f.people[0].grants[1].id)).status).toBe(403);
    await rows("UPDATE responsibility_grants SET ends_at=now()-interval '1 second',starts_at=now()-interval '1 hour' WHERE id=$1",[f.people[0].grants[0].id]);
    expect((await selected(f.actors[0],"get","/sales/invoices",f.people[0].grants[0].id)).status).toBe(403);
  });
  it("sells below and exactly at the server-calculated limit, rejects forged over-limit, other branch/warehouse and inactive periods atomically", async () => {
    const f = await posTemplateFixture(), session = await open(f);
    const below = ok(await post(f, "/pos/orders", bodyFor(f, session.id, 0.9)), 201);
    expect(Number(below.total)).toBe(9);
    const exact = ok(await post(f, "/pos/orders", bodyFor(f, session.id)), 201);
    expect(Number(exact.total)).toBe(10);
    const before = await evidence(f);
    expect(before[0].quantity).toBe("18.1000");
    ok(await post(f, "/pos/orders", bodyFor(f, session.id, 2)), 403);
    expect(await evidence(f)).toEqual(before);
    const inventory = f.people[0].grants[1];
    ok(await post(f, "/pos/orders", bodyFor(f, session.id), randomUUID(), inventory), 403);
    const otherSession = ok(await f.owner.post("/api/pos/sessions").send({
      branchId: f.branches[1].id, openingCash: 0, cashierName: "فرع غير ممنوح للبيع",
    }), 201);
    ok(await post(f, "/pos/orders", bodyFor(f, otherSession.id)), 403);
    // This user's sale responsibility does NOT include a different warehouse in the same branch.
    await rows("UPDATE warehouses SET is_default=(id=$1) WHERE branch_id=$2", [f.extraWarehouse.id, f.branches[0].id]);
    ok(await post(f, "/pos/orders", bodyFor(f, session.id)), 403);
    await rows("UPDATE warehouses SET is_default=(id=$1) WHERE branch_id=$2", [f.warehouses[0].id, f.branches[0].id]);
    for (const state of ["future", "expired"]) {
      await rows(`UPDATE responsibility_grants SET starts_at=clock_timestamp()+$1::interval,
        ends_at=clock_timestamp()+$2::interval WHERE id=$3`,
        [state === "future" ? "1 hour" : "-2 hours", state === "future" ? "2 hours" : "-1 hour", f.people[0].grants[0].id]);
      ok(await post(f, "/pos/orders", bodyFor(f, session.id)), 403);
    }
    expect(await evidence(f)).toEqual(before);
    expect((await rows(`SELECT count(*)::int n FROM journal_entries j WHERE company_id=$1 AND
      (SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_entry_lines l WHERE l.entry_id=j.id)<>0`, [f.companies[0].id]))[0].n).toBe(0);
  });
  it("previews and applies a POS template to two inheritors only, preserves denial/amount/time/independent inventory and explicitly returns an exception to inheritance", async () => {
    const f = await posTemplateFixture();
    const edit = { expectedRevision: 1, name: "قالب بيع وتحـصيل موثق", actions: [...f.template.actions, "pos.payment.record"] };
    const impact = ok(await f.owner.post(`/api/team/templates/${f.template.id}/preview`).send(edit));
    expect(impact.effects).toHaveLength(3);
    expect(impact.effects[0].effectiveAfter).toContain("pos.payment.record");
    expect(impact.effects[1].effectiveAfter).not.toContain("pos.payment.record");
    expect(impact.effects[2].mode).toBe("override");
    expect(impact.effects[2].afterActions).toEqual(f.template.actions);
    ok(await f.owner.put(`/api/team/templates/${f.template.id}`).send({ ...edit, digest: impact.digest }));
    const originals = f.people;
    await refresh(f);
    for (let i = 0; i < 3; i++) {
      const g = f.people[i].grants[0], old = originals[i].grants[0];
      expect(g.templateRevision).toBe(i === 2 ? 1 : 2);
      for (const field of ["branchId", "warehouseIds", "amountLimit", "startsAt", "endsAt"]) expect(g[field]).toEqual(old[field]);
      expect(f.people[i].grants[1]).toEqual(originals[i].grants[1]);
    }
    const third = f.people[2], input = personInput(third);
    input.grants[0] = { ...input.grants[0], templateMode: "inherit", templateRevision: 2, actions: edit.actions };
    ok(await f.owner.put(`/api/team/people/${third.personId}/access`).send({ person: input, expectedRevision: third.revision, suspended: false }));
    await refresh(f);
    expect(f.people[2].grants[0].templateMode).toBe("inherit");
    const second = ok(await f.actors[1].get("/api/workspace/access")).grants.find((g: any) => g.resource === "pos");
    expect(second.actions).not.toContain("pos.payment.record");
    const before = await evidence(f), session = await open(f);
    ok(await selected(f.actors[1], "post", "/pos/orders", second.id).send({ ...bodyFor(f, session.id), paymentMethod: "card" }), 403);
    expect(await evidence(f)).toEqual(before);
    const invoice = ok(await post(f, "/pos/orders", bodyFor(f, session.id)), 201);
    expect(Number(invoice.total)).toBe(10);
  });
  it("revokes execution in an open session and a delayed checkout while retaining source-authorized committed recovery without duplicates", async () => {
    const f = await posTemplateFixture(), session = await open(f), key = randomUUID(), body = bodyFor(f, session.id);
    const sale = ok(await post(f, "/pos/orders", body, key), 201), before = await evidence(f);
    // Authority writer wins while a request is already waiting at the shared fence.
    const writer = await pool.connect();
    let pending: Promise<any> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT pg_advisory_xact_lock(174223,35)");
      const pid = (await writer.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      await writer.query("UPDATE responsibility_grants SET actions=ARRAY['pos.read'] WHERE id=$1", [f.people[0].grants[0].id]);
      pending = post(f, "/pos/orders", body).then((r: any) => r);
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const [waiter] = await rows("SELECT count(*)::int n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [pid]);
        if (waiter.n) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await writer.query("COMMIT");
      expect(blocked).toBe(true);
      ok(await pending, 403);
    } finally { await writer.query("ROLLBACK"); writer.release(); }
    ok(await post(f, "/pos/orders", body), 403);
    const replay = await post(f, "/pos/orders", body, key);
    expect(ok(replay, 201).id).toBe(sale.id);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(await evidence(f)).toEqual(before);
    ok(await post(f, "/pos/orders", { ...body, items: [{ productId: f.products[0].id, quantity: 2 }] }, key), 409);
    // A valid current responsibility, but for a different source warehouse, may not recover this result.
    await rows("UPDATE responsibility_grants SET warehouse_ids=ARRAY[$1]::integer[] WHERE id=$2", [f.extraWarehouse.id, f.people[0].grants[0].id]);
    ok(await post(f, "/pos/orders", body, key), 403);
    expect(await evidence(f)).toEqual(before);
  });
  it("applies live sell revocation through the shared template API and recovers a committed result only under the replacement readable grant", async () => {
    const f = await posTemplateFixture(), session = await open(f), key = randomUUID(), body = bodyFor(f, session.id);
    const sale = ok(await post(f, "/pos/orders", body, key), 201), before = await evidence(f);
    const oldGrant = f.people[0].grants[0];
    const edit = { expectedRevision: 1, name: "سحب تنفيذ البيع دون محو أدلته", actions: ["pos.read", "pos.shift.open"] };
    const preview = ok(await f.owner.post(`/api/team/templates/${f.template.id}/preview`).send(edit));
    ok(await f.owner.put(`/api/team/templates/${f.template.id}`).send({ ...edit, digest: preview.digest }));
    await refresh(f);
    expect(f.people[0].grants[0].id).not.toBe(oldGrant.id);
    ok(await post(f, "/pos/orders", body, key, oldGrant), 403);
    ok(await post(f, "/pos/orders", body), 403);
    expect(ok(await post(f, "/pos/orders", body, key), 201).id).toBe(sale.id);
    expect(await evidence(f)).toEqual(before);
    const person = f.people[0], input = personInput(person);
    input.deniedActions = ["pos.read"];
    ok(await f.owner.put(`/api/team/people/${person.personId}/access`).send({
      person: input, expectedRevision: person.revision, suspended: false,
    }));
    await refresh(f);
    ok(await post(f, "/pos/orders", body, key), 403);
    expect(await evidence(f)).toEqual(before);
  });
  it("switches the same identity between two scoped companies and rejects the old selected responsibility, product and receipt on each switch", async () => {
    const f = await posTemplateFixture(), session = await open(f);
    const sale = ok(await post(f, "/pos/orders", bodyFor(f, session.id)), 201);
    const original = ok(await f.actors[0].get("/api/workspace/access")).grants;
    ok(await f.actors[0].post("/api/auth/switch-company").send({ companyId: f.companies[1].id }));
    const access = ok(await f.actors[0].get("/api/workspace/access"));
    expect(access.grants).toHaveLength(1);
    expect(access.grants[0].resource).toBe("inventory");
    expect(access.grants[0].actions).toContain("inventory.cost.read");
    const inventory = ok(await selected(f.actors[0], "get", "/workspace/inventory", access.grants[0].id));
    expect(JSON.stringify(inventory)).toContain("منتج المنشأة الأخرى فقط");
    expect(JSON.stringify(inventory)).not.toContain("منتج قالب البيع");
    ok(await selected(f.actors[0], "get", "/products", original[0].id), 403);
    ok(await selected(f.actors[0], "get", `/pos/orders/${sale.id}`, original[0].id), 403);
    ok(await f.actors[0].post("/api/auth/switch-company").send({ companyId: f.companies[0].id }));
    ok(await selected(f.actors[0], "get", "/workspace/inventory", access.grants[0].id), 403);
    expect(ok(await selected(f.actors[0], "get", "/products", original[0].id)).some((p: any) => p.id === f.products[0].id)).toBe(true);
  });
});
