import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { GetInvoiceEditorStateBody, SaveInvoiceEditorDraftBody, PublishInvoiceEditorDraftBody,
  ActivateInvoiceEditorReleaseBody, PreviewInvoiceEditorDraftBody } from "@workspace/api-zod";
import { authorizeSettingsScope } from "../lib/scoped-app-settings";
import { lockApprovalAuthority, authorityFingerprint } from "../lib/approval-authority";
import { FinancialRequestError } from "../lib/financial-transaction";
import { handleRouteError } from "../lib/handle-error";
import { EditorDesignSchema } from "../lib/invoice-editor-schema";
import { validateDesignAssets } from "../lib/invoice-design";
import { editorState, editorMutation, saveEditorDraft, publishEditorDraft, activateEditorRelease } from "../lib/invoice-editor-store";
import type { IdentityTx } from "../lib/document-identity";
import { demoInvoicePdf } from "./invoice-templates";
const router = Router();
const scope = z.object({ expectedCompanyId: z.number().int().positive(), branchId: z.number().int().positive().nullable() });
const requestFields = { requestId: z.string().uuid() };
const draftSchema = scope.extend({ ...requestFields, id: z.string().uuid(), expectedRevision: z.number().int().min(0), design: EditorDesignSchema }).strict();
const activationFields = { ...requestFields, expectedActiveRevision: z.number().int().min(0), expectedParentRevision: z.number().int().min(0) };
const publishSchema = scope.extend({ ...activationFields, id: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();
const activateSchema = scope.extend({ ...activationFields, releaseId: z.string().uuid().nullable() }).strict();
const previewSchema = scope.extend({ design: EditorDesignSchema, sample: z.enum(["short", "long"]), width: z.enum(["a4", "80"]) }).strict();

/** Same settings authority and company writer fence as accepted issuance.
 * Recheck after waiting, before reading receipts or applying any mutation. */
async function scoped<T>(req: Request, body: z.infer<typeof scope>,
  run: (tx: IdentityTx, companyId: number, userId: number) => Promise<T>) {
  return db.transaction(async tx => {
    await lockApprovalAuthority(tx);
    const actor = await authorizeSettingsScope(req, tx, body.branchId, true);
    if (actor.companyId !== body.expectedCompanyId) throw new FinancialRequestError("تغيرت المنشأة؛ أعد فتح المحرر", 409);
    await tx.execute(sql`SELECT id FROM companies WHERE id=${actor.companyId} FOR UPDATE`);
    await authorizeSettingsScope(req, tx, body.branchId, true);
    return run(tx, actor.companyId, actor.userId);
  });
}
router.post("/print/editor/state", async (req, res) => {
  try {
    GetInvoiceEditorStateBody.parse(req.body);
    const body = scope.strict().parse(req.body);
    res.json(await scoped(req, body, (tx, companyId) => editorState(tx, companyId, body.branchId)));
  } catch (e) { handleRouteError(e, res); }
});
router.post("/print/editor/draft", async (req, res) => {
  try {
    SaveInvoiceEditorDraftBody.parse(req.body);
    const body = draftSchema.parse(req.body);
    res.json(await scoped(req, body, (tx, companyId, userId) => editorMutation(tx, companyId, userId,
      "draft.saved", body, () => saveEditorDraft(tx, companyId, userId, body))));
  } catch (e) { handleRouteError(e, res); }
});
router.post("/print/editor/publish", async (req, res) => {
  try {
    PublishInvoiceEditorDraftBody.parse(req.body);
    const body = publishSchema.parse(req.body);
    res.json(await scoped(req, body, (tx, companyId, userId) => editorMutation(tx, companyId, userId,
      "published", body, () => publishEditorDraft(tx, companyId, userId, body))));
  } catch (e) { handleRouteError(e, res); }
});
router.post("/print/editor/activate", async (req, res) => {
  try {
    ActivateInvoiceEditorReleaseBody.parse(req.body);
    const body = activateSchema.parse(req.body);
    res.json(await scoped(req, body, (tx, companyId, userId) => editorMutation(tx, companyId, userId,
      "activated", body, () => activateEditorRelease(tx, companyId, body))));
  } catch (e) { handleRouteError(e, res); }
});
router.post("/print/editor/preview", async (req, res) => {
  try {
    PreviewInvoiceEditorDraftBody.parse(req.body);
    const body = previewSchema.parse(req.body);
    const pdf = await scoped(req, body, async (tx, companyId) => {
      await validateDesignAssets(tx, companyId, body.design.base);
      const pdf = await demoInvoicePdf(tx, companyId, body.design.base, body.sample, body.width, body.design);
      await tx.execute(sql`INSERT INTO invoice_editor_previews(company_id,scope_key,design_hash,sample,width)
        VALUES(${companyId},${body.branchId ?? 0},${authorityFingerprint(body.design)},${body.sample},${body.width})
        ON CONFLICT DO NOTHING`);
      return pdf;
    });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="invoice-editor-demo.pdf"',
      "Cache-Control": "no-store" }).send(pdf);
  } catch (e) { handleRouteError(e, res); }
});
export default router;
