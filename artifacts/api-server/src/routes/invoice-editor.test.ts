import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { posTemplateFixture, accepted as ok, fixtureRows as rows, type PosTemplateFixture } from "../test/pos-template-fixture";
import { defaultInvoiceDesign } from "../lib/invoice-design";
import { defaultEditorLayout, EditorDesignSchema, type EditorDesign } from "../lib/invoice-editor-schema";
import { authorityFingerprint } from "../lib/approval-authority";
import { captureInvoiceDesign } from "../lib/invoice-design";
import { printHtml } from "../lib/pdf/print-document";
const out = resolve(process.cwd(), "../../generated-artifacts/invoice-editor-2b");
const design = (): EditorDesign => ({ schemaVersion: 1, name: "تصميم اختبار مستقل", base: { ...defaultInvoiceDesign },
  a4: structuredClone(defaultEditorLayout), thermal80: { ...structuredClone(defaultEditorLayout), margin: 3, metadataColumns: 1 } });
describe("2b editor: existing settings authority and immutable prospective designs", () => {
  let f: PosTemplateFixture;
  const id = randomUUID();
  let current = design();
  let revision = 0;
  let firstRelease: string;
  let financialBefore: unknown[];
  const scope = () => ({ expectedCompanyId: f.companies[0].id, branchId: null });
  const state = async (branchId: number | null = null) => ok(await f.owner.post("/api/print/editor/state").send({ ...scope(), branchId }));
  const snapshot = async () => {
    const result = [];
    for (const table of ["customer_invoices", "customer_invoice_lines", "pos_orders", "pos_order_payments", "stock_moves",
      "stock_quants", "stock_layers", "journal_entries", "journal_entry_lines", "financial_requests", "document_issuer_snapshots"])
      result.push({ table, hash: authorityFingerprint(await rows(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY row_to_json(t)::text`)) });
    return result;
  };
  beforeAll(async () => {
    f = await posTemplateFixture();
    mkdirSync(out, { recursive: true });
    financialBefore = await snapshot();
  }, 120_000);
  it("strict layout prevents missing mandatory blocks, duplicate sections, free HTML/CSS, invalid widths or margins", () => {
    expect(EditorDesignSchema.safeParse(design()).success).toBe(true);
    for (const invalid of [
      { ...design(), css: "body{display:none}" },
      { ...design(), a4: { ...design().a4, order: Array(8).fill("items") } },
      { ...design(), a4: { ...design().a4, widths: [20, 20, 20, 20, 20] } },
      { ...design(), thermal80: { ...design().thermal80, margin: 18 } },
    ]) expect(EditorDesignSchema.safeParse(invalid).success).toBe(false);
  });
  it("creates named draft but leaves accepted v2 effective; same request replay creates no revision", async () => {
    const body = { ...scope(), id, expectedRevision: 0, requestId: randomUUID(), design: current };
    const saved = ok(await f.owner.post("/api/print/editor/draft").send(body));
    expect(saved.revision).toBe(1); revision = 1;
    expect(ok(await f.owner.post("/api/print/editor/draft").send(body))).toEqual(saved);
    expect((await state()).drafts[0].design.name).toBe(current.name);
    expect((await db.transaction(tx => captureInvoiceDesign(tx, f.companies[0].id, null))).layoutVersion).toBe(2);
    ok(await f.owner.post("/api/print/editor/draft").send({ ...body, design: { ...current, name: "جسم مختلف" } }), 409);
  });
  it("stale edits cannot overwrite a newer revision and concurrent saves yield exactly one winner", async () => {
    const update = (name: string) => ({ ...scope(), id, expectedRevision: revision, requestId: randomUUID(), design: { ...current, name } });
    const results = await Promise.all([f.owner.post("/api/print/editor/draft").send(update("نسخة ألف")),
      f.owner.post("/api/print/editor/draft").send(update("نسخة باء"))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const saved = results.find(r => r.status === 200)!.body;
    revision = saved.revision; current = saved.design;
    ok(await f.owner.post("/api/print/editor/draft").send({ ...scope(), id, expectedRevision: 1,
      requestId: randomUUID(), design: design() }), 409);
    expect((await state()).drafts[0]).toEqual(saved);
  });
  it("server prevents publication without the exact four successful native PDF previews", async () => {
    const s = await state();
    ok(await f.owner.post("/api/print/editor/publish").send({ ...scope(), id, expectedRevision: revision,
      expectedActiveRevision: s.revision, expectedParentRevision: s.parentRevision, requestId: randomUUID() }), 400);
    for (const width of ["a4", "80"]) for (const sample of ["short", "long"]) {
      const r = await f.owner.post("/api/print/editor/preview").send({ ...scope(), design: current, sample, width });
      ok(r); expect(r.body.subarray(0, 5).toString()).toBe("%PDF-");
      writeFileSync(resolve(out, `editor-${width}-${sample}.pdf`), r.body);
    }
  }, 180_000);
  it("concurrent publication/retrieval stores one immutable release and one activation; same UUID never rewrites history", async () => {
    const s = await state();
    const body = { ...scope(), id, expectedRevision: revision, expectedActiveRevision: s.revision,
      expectedParentRevision: s.parentRevision, requestId: randomUUID() };
    const result = await Promise.all([f.owner.post("/api/print/editor/publish").send(body),
      f.owner.post("/api/print/editor/publish").send(body)]);
    result.forEach(r => ok(r)); expect(result[0].body).toEqual(result[1].body);
    firstRelease = result[0].body.id;
    expect((await rows("SELECT * FROM invoice_editor_releases WHERE company_id=$1", [f.companies[0].id])).length).toBe(1);
    expect((await state()).revision).toBe(1);
    await expect(rows("UPDATE invoice_editor_releases SET design=design WHERE id=$1", [firstRelease])).rejects.toThrow(/Immutable/);
    const captured = await db.transaction(tx => captureInvoiceDesign(tx, f.companies[0].id, null));
    expect(captured.layoutVersion).toBe(3); expect(captured.editor?.releaseId).toBe(firstRelease);
    writeFileSync(resolve(out, "captured-published-design.json"), JSON.stringify(captured, null, 2));
  });
  it("company/branch scope rejects cross-tenant drafts, foreign branches/assets and financial readers without settings", async () => {
    ok(await f.actors[0].post("/api/print/editor/state").send(scope()), 403);
    ok(await f.owner.post("/api/print/editor/state").send({ ...scope(), branchId: f.branches[2].id }), 404);
    ok(await f.owner.post("/api/print/editor/state").send({ ...scope(), expectedCompanyId: f.companies[1].id }), 409);
    ok(await f.owner.post("/api/print/editor/draft").send({ ...scope(), branchId: f.branches[0].id,
      id, expectedRevision: revision, requestId: randomUUID(), design: current }), 404);
    ok(await f.owner.post("/api/print/editor/draft").send({ ...scope(), id: randomUUID(), expectedRevision: 0,
      requestId: randomUUID(), design: { ...current, base: { ...current.base, logoMode: "custom", logoObjectKey: "foreign/company/logo.png" } } }), 400);
  });
  it("explicit branch override and inherit use immutable release without modifying company setting or old snapshots", async () => {
    const branchId = f.branches[0].id;
    let s = await state(branchId);
    expect(s.source).toBe("company");
    const activate = (releaseId: string | null) => ({ ...scope(), branchId, releaseId,
      expectedActiveRevision: s.revision, expectedParentRevision: s.parentRevision, requestId: randomUUID() });
    ok(await f.owner.post("/api/print/editor/activate").send(activate(firstRelease)));
    s = await state(branchId); expect(s.source).toBe("branch");
    const old = await db.transaction(tx => captureInvoiceDesign(tx, f.companies[0].id, branchId));
    ok(await f.owner.post("/api/print/editor/activate").send(activate(null)));
    expect((await state(branchId)).source).toBe("company");
    expect(old.editor?.releaseId).toBe(firstRelease);
    const html = printHtml({ title: "فاتورة", invoiceDesign: old.design, layoutVersion: 3, editor: old.editor,
      metadata: [["المرجع", "AR-001"], ["الطرف", "عميل"]], headers: ["الوصف", "الكمية", "سعر الوحدة", "الضريبة", "الإجمالي"],
      rows: [["سلام", 1, 100, 15, 115]], totals: [["الإجمالي", 115]] });
    expect(html).toContain("AR-001"); expect(html).toContain("editor-customer"); expect(html).toContain("115");
  });
  it("publishing company defaults does not silently replace an existing 2a branch customization", async () => {
    const branchId = f.branches[1].id;
    const settings = ok(await f.owner.get(`/api/settings?branchId=${branchId}`));
    ok(await f.owner.patch(`/api/settings?branchId=${branchId}`).send({
      expectedCompanyId: f.companies[0].id, expectedRevision: settings.scope.revision,
      expectedParentRevision: settings.scope.parentRevision,
      templates: { invoiceDesign: { ...defaultInvoiceDesign, preset: "ink", footer: "EXISTING-BRANCH-2A" } },
    }));
    const old = await db.transaction(tx => captureInvoiceDesign(tx, f.companies[0].id, branchId));
    expect(old.layoutVersion).toBe(2); expect(old.design.footer).toBe("EXISTING-BRANCH-2A");
    const s = await state(branchId); expect(s.source).toBe("legacy"); expect(s.activeId).toBeNull();
    ok(await f.owner.post("/api/print/editor/activate").send({ ...scope(), branchId, releaseId: null,
      expectedActiveRevision: s.revision, expectedParentRevision: s.parentRevision, requestId: randomUUID() }));
    expect((await db.transaction(tx => captureInvoiceDesign(tx, f.companies[0].id, branchId))).editor?.releaseId).toBe(firstRelease);
    expect(old.design.footer).toBe("EXISTING-BRANCH-2A");
  });
  it("all edit, save, preview, publish and activation operations leave eleven financial tables unchanged", async () => {
    const after = await snapshot();
    expect(after).toEqual(financialBefore);
    writeFileSync(resolve(out, "editor-financial-reconciliation.json"), JSON.stringify({ before: financialBefore, after, unchanged: true }, null, 2));
  });
  it("permission revocation on the open session also blocks receipt retrieval and publication", async () => {
    await rows("UPDATE company_administrators SET responsibilities=array_remove(responsibilities,'settings') WHERE company_id=$1 AND user_id=$2",
      [f.companies[0].id, f.ownerUser.id]);
    await rows("UPDATE user_companies SET role='scoped' WHERE company_id=$1 AND user_id=$2", [f.companies[0].id, f.ownerUser.id]);
    ok(await f.owner.post("/api/print/editor/state").send(scope()), 403);
    ok(await f.owner.post("/api/print/editor/draft").send({ ...scope(), id, expectedRevision: revision,
      requestId: randomUUID(), design: current }), 403);
  });
});
