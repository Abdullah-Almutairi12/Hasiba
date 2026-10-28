import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { IdentityTx } from "./document-identity";
import { authorityFingerprint } from "./approval-authority";
import { FinancialRequestError } from "./financial-transaction";
import { validateDesignAssets } from "./invoice-design";
import { EditorDesignSchema, type EditorDesign } from "./invoice-editor-schema";

export interface EditorScope { expectedCompanyId: number; branchId: number | null }
export interface EditorActivation extends EditorScope {
  requestId: string; expectedActiveRevision: number; expectedParentRevision: number;
}
const fail = (message: string, status = 409): never => { throw new FinancialRequestError(message, status); };
const draftRow = (r: Record<string, unknown>) => ({
  id: String(r.id), revision: Number(r.revision), design: EditorDesignSchema.parse(r.design),
});
const releaseRow = (r: Record<string, unknown>) => ({
  id: String(r.id), draftId: String(r.draft_id), draftRevision: Number(r.draft_revision),
  design: EditorDesignSchema.parse(r.design), revision: Number(r.draft_revision),
});
export async function editorState(tx: IdentityTx, companyId: number, branchId: number | null) {
  const drafts = (await tx.execute(sql`SELECT * FROM invoice_editor_drafts
    WHERE company_id=${companyId} AND scope_key=${branchId ?? 0} ORDER BY updated_at DESC LIMIT 100`)).rows.map(draftRow);
  const releases = (await tx.execute(sql`SELECT * FROM invoice_editor_releases
    WHERE company_id=${companyId} ORDER BY created_at DESC LIMIT 200`)).rows.map(releaseRow);
  const activations = (await tx.execute(sql`SELECT * FROM invoice_editor_activation WHERE company_id=${companyId}
    AND (scope_key=0 OR scope_key=${branchId ?? 0})`)).rows;
  const parent = activations.find(r => Number(r.scope_key) === 0);
  const scope = branchId == null ? parent : activations.find(r => Number(r.scope_key) === branchId);
  const legacyChild = branchId == null ? undefined : (await tx.execute(sql`SELECT templates->'invoiceDesign' AS design
    FROM app_settings WHERE company_id=${companyId} AND branch_id=${branchId}`)).rows[0]?.design;
  const selected = scope?.release_id ?? ((!legacyChild || scope) ? parent?.release_id : null);
  return { drafts, releases, revision: Number(scope?.revision ?? 0), parentRevision: Number(parent?.revision ?? 0),
    activeId: selected == null ? null : String(selected),
    source: selected ? (branchId != null && scope?.release_id ? "branch" : "company") : "legacy" };
}
/** Writer already owns company FOR UPDATE and the existing authority fence.
 * Replays are returned only after CURRENT authorization, never as an ACL bypass. */
export async function editorMutation<T>(tx: IdentityTx, companyId: number, userId: number,
  operation: string, body: { requestId: string }, run: () => Promise<T>): Promise<T> {
  const hash = authorityFingerprint({ operation, body });
  const receipt = (await tx.execute(sql`SELECT actor_id,body_hash,result FROM invoice_editor_requests
    WHERE company_id=${companyId} AND request_id=${body.requestId}::uuid`)).rows[0];
  if (receipt) {
    if (Number(receipt.actor_id) !== userId || receipt.body_hash !== hash) fail("معرف المحاولة مستخدم لطلب مختلف");
    return receipt.result as T;
  }
  const result = await run();
  await tx.execute(sql`INSERT INTO invoice_editor_requests(company_id,request_id,actor_id,body_hash,result)
    VALUES(${companyId},${body.requestId}::uuid,${userId},${hash},${JSON.stringify(result)}::jsonb)`);
  const input = body as unknown as Record<string, unknown>;
  const saved = result as Record<string, unknown>;
  const audit = { operation, requestId: body.requestId, branchId: input.branchId ?? null,
    draftId: input.id ?? saved.draftId ?? null, releaseId: input.releaseId ?? (operation === "published" ? saved.id : null),
    revision: saved.revision, created: operation === "draft.saved" && saved.revision === 1 };
  await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details)
    VALUES(${companyId},${userId},'مستخدم مخوّل',${`invoice.editor.${operation}`},
    ${`invoice-template:${body.requestId}`},${JSON.stringify(audit)})`);
  return result;
}
export async function saveEditorDraft(tx: IdentityTx, companyId: number, userId: number,
  body: EditorScope & { id: string; expectedRevision: number; design: EditorDesign }) {
  const design = EditorDesignSchema.parse(body.design);
  await validateDesignAssets(tx, companyId, design.base);
  const prior = (await tx.execute(sql`SELECT * FROM invoice_editor_drafts WHERE id=${body.id}::uuid`)).rows[0];
  if (prior && (Number(prior.company_id) !== companyId || Number(prior.scope_key) !== (body.branchId ?? 0)))
    fail("المسودة غير متاحة في هذا النطاق", 404);
  if (Number(prior?.revision ?? 0) !== body.expectedRevision) fail("تغيرت المسودة؛ احتفظ بتعديلاتك وأعد تحميل النسخة");
  if (!prior) {
    const count = (await tx.execute(sql`SELECT count(*) AS n FROM invoice_editor_drafts WHERE company_id=${companyId}`)).rows[0];
    if (Number(count?.n) >= 100) fail("الحد المدعوم مئة مسودة لكل منشأة", 400);
  }
  const { rows } = await tx.execute(sql`INSERT INTO invoice_editor_drafts(id,company_id,scope_key,revision,design,updated_by)
    VALUES(${body.id}::uuid,${companyId},${body.branchId ?? 0},1,${JSON.stringify(design)}::jsonb,${userId})
    ON CONFLICT(id) DO UPDATE SET revision=invoice_editor_drafts.revision+1,design=EXCLUDED.design,
    updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`);
  return draftRow(rows[0]!);
}
async function activationVersions(tx: IdentityTx, companyId: number, body: EditorActivation) {
  const rows = (await tx.execute(sql`SELECT * FROM invoice_editor_activation WHERE company_id=${companyId}
    AND (scope_key=0 OR scope_key=${body.branchId ?? 0})`)).rows;
  const parent = rows.find(r => Number(r.scope_key) === 0);
  const child = body.branchId == null ? parent : rows.find(r => Number(r.scope_key) === body.branchId);
  if (Number(child?.revision ?? 0) !== body.expectedActiveRevision ||
      Number(parent?.revision ?? 0) !== body.expectedParentRevision)
    fail("تغير التصميم الفعّال أو موروث المنشأة؛ أعد تحميل الحالة قبل النشر");
}
async function activate(tx: IdentityTx, companyId: number, body: EditorActivation, releaseId: string | null) {
  await activationVersions(tx, companyId, body);
  const result = (await tx.execute(sql`INSERT INTO invoice_editor_activation(company_id,scope_key,revision,release_id)
    VALUES(${companyId},${body.branchId ?? 0},1,${releaseId}::uuid)
    ON CONFLICT(company_id,scope_key) DO UPDATE SET revision=invoice_editor_activation.revision+1,
    release_id=EXCLUDED.release_id RETURNING revision`)).rows[0]!;
  return { revision: Number(result.revision) };
}
export async function publishEditorDraft(tx: IdentityTx, companyId: number, userId: number,
  body: EditorActivation & { id: string; expectedRevision: number }) {
  await activationVersions(tx, companyId, body);
  const draft = (await tx.execute(sql`SELECT * FROM invoice_editor_drafts WHERE id=${body.id}::uuid
    AND company_id=${companyId} AND scope_key=${body.branchId ?? 0}`)).rows[0];
  if (!draft) fail("المسودة غير متاحة في هذا النطاق", 404);
  if (Number(draft.revision) !== body.expectedRevision) fail("تغيرت المسودة؛ أعد المعاينة");
  const design = EditorDesignSchema.parse(draft.design);
  await validateDesignAssets(tx, companyId, design.base);
  const proofs = (await tx.execute(sql`SELECT sample,width FROM invoice_editor_previews
    WHERE company_id=${companyId} AND scope_key=${body.branchId ?? 0}
    AND design_hash=${authorityFingerprint(design)}`)).rows;
  if (proofs.length !== 4) fail("يلزم معاينة قصيرة وطويلة لكل من A4 و80 مم لهذا التصميم قبل النشر", 400);
  let release = (await tx.execute(sql`SELECT * FROM invoice_editor_releases WHERE company_id=${companyId}
    AND draft_id=${body.id}::uuid AND draft_revision=${body.expectedRevision}`)).rows[0];
  if (!release) release = (await tx.execute(sql`INSERT INTO invoice_editor_releases
    (id,company_id,draft_id,draft_revision,design,created_by) VALUES(${randomUUID()}::uuid,${companyId},
    ${body.id}::uuid,${body.expectedRevision},${JSON.stringify(design)}::jsonb,${userId}) RETURNING *`)).rows[0]!;
  const activated = await activate(tx, companyId, body, String(release.id));
  return { ...releaseRow(release), ...activated };
}
export async function activateEditorRelease(tx: IdentityTx, companyId: number,
  body: EditorActivation & { releaseId: string | null }) {
  if (body.releaseId != null) {
    const release = (await tx.execute(sql`SELECT design FROM invoice_editor_releases
      WHERE company_id=${companyId} AND id=${body.releaseId}::uuid`)).rows[0];
    if (!release) fail("الإصدار غير متاح لهذه المنشأة", 404);
    const design = EditorDesignSchema.parse(release.design);
    await validateDesignAssets(tx, companyId, design.base);
  }
  return activate(tx, companyId, body, body.releaseId);
}
